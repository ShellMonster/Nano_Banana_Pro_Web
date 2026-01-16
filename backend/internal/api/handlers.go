package api

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"image-gen-service/internal/config"
	"image-gen-service/internal/model"
	"image-gen-service/internal/provider"
	"image-gen-service/internal/storage"
	"image-gen-service/internal/worker"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"google.golang.org/genai"
)

// Response 统一 API 响应结构
type Response struct {
	Code    int         `json:"code"`    // 业务状态码: 200 为成功，其他为失败
	Message string      `json:"message"` // 提示信息
	Data    interface{} `json:"data"`    // 返回数据
}

// Success 成功响应
func Success(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Response{
		Code:    200,
		Message: "success",
		Data:    data,
	})
}

// Error 错误响应
func Error(c *gin.Context, httpStatus int, code int, message string) {
	c.JSON(httpStatus, Response{
		Code:    code,
		Message: message,
		Data:    nil,
	})
}

// GenerateRequest 生成图片请求参数
type GenerateRequest struct {
	Provider string                 `json:"provider" binding:"required"`
	ModelID  string                 `json:"model_id"`
	Params   map[string]interface{} `json:"params"`
}

func buildConfigSnapshot(providerName, modelID string, params map[string]interface{}) string {
	if params == nil {
		params = map[string]interface{}{}
	}

	snapshot := map[string]interface{}{
		"provider": providerName,
	}
	if modelID != "" {
		snapshot["model_id"] = modelID
	}

	// 兼容多种 key 命名（前端/后端/历史版本）
	if v, ok := params["aspectRatio"].(string); ok && v != "" {
		snapshot["aspectRatio"] = v
	} else if v, ok := params["aspect_ratio"].(string); ok && v != "" {
		snapshot["aspectRatio"] = v
	} else if v, ok := params["aspect"].(string); ok && v != "" {
		snapshot["aspectRatio"] = v
	}

	if v, ok := params["imageSize"].(string); ok && v != "" {
		snapshot["imageSize"] = v
	} else if v, ok := params["resolution_level"].(string); ok && v != "" {
		snapshot["imageSize"] = v
	} else if v, ok := params["image_size"].(string); ok && v != "" {
		snapshot["imageSize"] = v
	}

	// count 可能是 float64（JSON 解析）或 int（服务内部）
	if v, ok := params["count"].(int); ok && v > 0 {
		snapshot["count"] = v
	} else if v, ok := params["count"].(float64); ok && v > 0 {
		snapshot["count"] = int(v)
	}

	b, err := json.Marshal(snapshot)
	if err != nil {
		return ""
	}
	return string(b)
}

func fetchProviderConfig(providerName string) *model.ProviderConfig {
	if model.DB == nil {
		return nil
	}
	var cfg model.ProviderConfig
	if err := model.DB.Where("provider_name = ?", providerName).First(&cfg).Error; err != nil {
		return nil
	}
	return &cfg
}

// ProviderConfigRequest 设置 Provider 配置请求
type ProviderConfigRequest struct {
	ProviderName string `json:"provider_name" binding:"required"`
	DisplayName  string `json:"display_name"`
	APIBase      string `json:"api_base" binding:"required"`
	APIKey       string `json:"api_key" binding:"required"`
	Enabled      bool   `json:"enabled"`
	ModelID      string `json:"model_id"`
}

// UpdateProviderConfigHandler 更新 Provider 配置
func UpdateProviderConfigHandler(c *gin.Context) {
	var req ProviderConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("[API] UpdateProviderConfig 参数绑定失败: %v\n", err)
		// 返回更具体的绑定错误信息
		Error(c, http.StatusBadRequest, 400, "参数验证失败: "+err.Error())
		return
	}

	log.Printf("[API] 收到配置更新请求: Provider=%s, Base=%s, KeyLen=%d\n",
		req.ProviderName, req.APIBase, len(req.APIKey))

	if model.DB == nil {
		log.Printf("[API] 数据库未初始化\n")
		Error(c, http.StatusInternalServerError, 500, "数据库未初始化")
		return
	}

	var configData model.ProviderConfig
	err := model.DB.Where("provider_name = ?", req.ProviderName).First(&configData).Error
	if err != nil {
		log.Printf("[API] 配置不存在，准备创建: %s\n", req.ProviderName)
		// 不存在则创建
		modelsJSON := buildModelsJSON(req.ProviderName, req.ModelID, "")
		configData = model.ProviderConfig{
			ProviderName: req.ProviderName,
			DisplayName:  req.DisplayName,
			APIBase:      req.APIBase,
			APIKey:       req.APIKey,
			Models:       modelsJSON,
			Enabled:      req.Enabled,
		}
		if err := model.DB.Create(&configData).Error; err != nil {
			log.Printf("[API] 创建配置失败: %v\n", err)
			Error(c, http.StatusInternalServerError, 500, "保存配置到数据库失败: "+err.Error())
			return
		}
	} else {
		log.Printf("[API] 配置已存在，准备更新: %s\n", req.ProviderName)
		// 存在则更新
		updates := map[string]interface{}{
			"api_base": req.APIBase,
			"api_key":  req.APIKey,
			"enabled":  req.Enabled,
		}
		if req.DisplayName != "" {
			updates["display_name"] = req.DisplayName
		}
		if modelsJSON := buildModelsJSON(req.ProviderName, req.ModelID, configData.Models); modelsJSON != "" {
			updates["models"] = modelsJSON
		}
		if err := model.DB.Model(&configData).Updates(updates).Error; err != nil {
			log.Printf("[API] 更新配置失败: %v\n", err)
			Error(c, http.StatusInternalServerError, 500, "更新配置到数据库失败: "+err.Error())
			return
		}
	}

	// 重新初始化 Provider 注册表
	log.Printf("[API] 重新初始化 Provider 注册表...\n")
	if err := provider.InitProviders(); err != nil {
		log.Printf("[API] 重新加载 Provider 失败: %v\n", err)
		// 虽然加载失败，但配置已经保存了，所以这里我们可以选择返回成功或警告
		// 为了严谨，我们返回一个 500
		Error(c, http.StatusInternalServerError, 500, "配置已保存但加载失败: "+err.Error())
		return
	}

	log.Printf("[API] 配置更新成功\n")
	Success(c, "配置已更新并生效")
}

// ListProvidersHandler 获取所有 Provider 配置
func ListProvidersHandler(c *gin.Context) {
	var configs []model.ProviderConfig
	if err := model.DB.Find(&configs).Error; err != nil {
		Error(c, http.StatusInternalServerError, 500, "获取配置失败")
		return
	}
	Success(c, configs)
}

// PromptOptimizeRequest 提示词优化请求
type PromptOptimizeRequest struct {
	Provider       string `json:"provider"`
	Model          string `json:"model"`
	Prompt         string `json:"prompt" binding:"required"`
	ResponseFormat string `json:"response_format"`
}

// OptimizePromptHandler 使用 OpenAI 标准接口优化提示词
func OptimizePromptHandler(c *gin.Context) {
	var req PromptOptimizeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, 400, err.Error())
		return
	}

	providerName := strings.TrimSpace(strings.ToLower(req.Provider))
	if providerName == "" {
		providerName = "openai-chat"
	}
	if providerName == "openai" {
		providerName = "openai-chat"
	}
	if providerName == "gemini" {
		providerName = "gemini-chat"
	}
	req.Provider = providerName
	if strings.TrimSpace(req.Prompt) == "" {
		Error(c, http.StatusBadRequest, 400, "prompt 不能为空")
		return
	}

	var cfg model.ProviderConfig
	if err := model.DB.Where("provider_name = ?", req.Provider).First(&cfg).Error; err != nil {
		Error(c, http.StatusBadRequest, 400, "未找到指定的 Provider: "+req.Provider)
		return
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		Error(c, http.StatusBadRequest, 400, "Provider API Key 未配置")
		return
	}

	modelName := provider.ResolveModelID(provider.ModelResolveOptions{
		ProviderName: req.Provider,
		Purpose:      provider.PurposeChat,
		RequestModel: req.Model,
		Config:       &cfg,
	}).ID
	if modelName == "" {
		Error(c, http.StatusBadRequest, 400, "未找到可用的模型")
		return
	}

	responseFormat := strings.ToLower(strings.TrimSpace(req.ResponseFormat))
	forceJSON := responseFormat == "json" || responseFormat == "json_object" || responseFormat == "application/json"

	var optimized string
	var err error
	if req.Provider == "gemini-chat" {
		optimized, err = callGeminiOptimize(c.Request.Context(), &cfg, modelName, req.Prompt, forceJSON)
	} else {
		optimized, err = callOpenAIOptimize(c.Request.Context(), &cfg, modelName, req.Prompt, forceJSON)
	}
	if err != nil {
		Error(c, http.StatusBadRequest, 400, err.Error())
		return
	}

	Success(c, gin.H{"prompt": optimized})
}

// GenerateHandler 处理图片生成请求
func GenerateHandler(c *gin.Context) {
	var req GenerateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, 400, err.Error())
		return
	}

	// 1. 获取并校验 Provider
	p := provider.GetProvider(req.Provider)
	if p == nil {
		Error(c, http.StatusBadRequest, 400, "未找到指定的 Provider: "+req.Provider)
		return
	}

	if req.Params == nil {
		req.Params = map[string]interface{}{}
	}
	modelID := provider.ResolveModelID(provider.ModelResolveOptions{
		ProviderName: req.Provider,
		Purpose:      provider.PurposeImage,
		RequestModel: req.ModelID,
		Params:       req.Params,
		Config:       fetchProviderConfig(req.Provider),
	}).ID
	if modelID != "" {
		req.Params["model_id"] = modelID
	}

	// 2. 校验参数（包含你提到的比例和分辨率）
	if err := p.ValidateParams(req.Params); err != nil {
		Error(c, http.StatusBadRequest, 400, err.Error())
		return
	}

	taskID := uuid.New().String()
	prompt, _ := req.Params["prompt"].(string)
	if prompt == "" {
		Error(c, http.StatusBadRequest, 400, "params.prompt 不能为空")
		return
	}

	taskModel := &model.Task{
		TaskID:         taskID,
		Prompt:         prompt,
		ProviderName:   req.Provider,
		ModelID:        modelID,
		TotalCount:     1, // 目前单次请求只生成一张，后续可扩展
		Status:         "pending",
		ConfigSnapshot: buildConfigSnapshot(req.Provider, modelID, req.Params),
	}

	if count, ok := req.Params["count"].(float64); ok {
		taskModel.TotalCount = int(count)
	} else if count, ok := req.Params["count"].(int); ok {
		taskModel.TotalCount = count
	}

	if err := model.DB.Create(taskModel).Error; err != nil {
		Error(c, http.StatusInternalServerError, 500, "创建任务失败")
		return
	}

	// 提交到 Worker 池
	task := &worker.Task{
		TaskModel: taskModel,
		Params:    req.Params,
	}

	if !worker.Pool.Submit(task) {
		model.DB.Model(taskModel).Updates(map[string]interface{}{
			"status":        "failed",
			"error_message": "任务队列已满，请稍后再试",
		})
		Error(c, http.StatusServiceUnavailable, 503, "服务器繁忙，请稍后再试")
		return
	}

	Success(c, taskModel)
}

// GenerateWithImagesHandler 处理带图片的生成请求
func GenerateWithImagesHandler(c *gin.Context) {
	log.Printf("[API] 收到图生图请求\n")
	// 1. 解析 multipart 请求
	req, err := ParseGenerateRequestFromMultipart(c)
	if err != nil {
		log.Printf("[API] 解析 multipart 请求失败: %v\n", err)
		Error(c, http.StatusBadRequest, 400, "解析请求失败: "+err.Error())
		return
	}
	log.Printf("[API] 请求解析成功: Prompt=%s, Provider=%s, Images=%d\n", req.Prompt, req.Provider, len(req.RefImages))

	// 2. 校验 Provider
	p := provider.GetProvider(req.Provider)
	if p == nil {
		Error(c, http.StatusBadRequest, 400, "未找到指定的 Provider: "+req.Provider)
		return
	}

	// 2. 准备任务参数
	// 将 MultipartFile 转换为 []byte，或者从 RefPaths 读取文件
	var refImageBytes []interface{}
	for _, file := range req.RefImages {
		if len(file.Content) > 0 {
			refImageBytes = append(refImageBytes, file.Content)
		}
	}

	// 处理本地路径请求 (Tauri 优化)
	for _, path := range req.RefPaths {
		if path != "" {
			content, err := os.ReadFile(path)
			if err != nil {
				log.Printf("[API] 读取本地参考图失败: %s, err: %v\n", path, err)
				continue
			}
			refImageBytes = append(refImageBytes, content)
		}
	}

	modelID := provider.ResolveModelID(provider.ModelResolveOptions{
		ProviderName: req.Provider,
		Purpose:      provider.PurposeImage,
		RequestModel: req.ModelID,
		Config:       fetchProviderConfig(req.Provider),
	}).ID
	taskParams := map[string]interface{}{
		"prompt":           req.Prompt,
		"provider":         req.Provider,
		"model_id":         modelID,
		"aspect_ratio":     req.AspectRatio,
		"resolution_level": req.ImageSize,
		"count":            req.Count,
		"reference_images": refImageBytes, // 传递 interface 列表，方便 Provider 类型断言
	}

	log.Printf("[API] 提交任务: Prompt=%s, Images=%d\n", req.Prompt, len(refImageBytes))

	// 3. 校验参数
	if err := p.ValidateParams(taskParams); err != nil {
		Error(c, http.StatusBadRequest, 400, err.Error())
		return
	}

	taskID := uuid.New().String()
	taskModel := &model.Task{
		TaskID:         taskID,
		Prompt:         req.Prompt,
		ProviderName:   req.Provider,
		ModelID:        modelID,
		TotalCount:     req.Count,
		Status:         "pending",
		ConfigSnapshot: buildConfigSnapshot(req.Provider, modelID, taskParams),
	}

	if err := model.DB.Create(taskModel).Error; err != nil {
		Error(c, http.StatusInternalServerError, 500, "创建任务失败")
		return
	}

	// 4. 提交到 Worker 池
	task := &worker.Task{
		TaskModel: taskModel,
		Params:    taskParams,
	}

	if !worker.Pool.Submit(task) {
		model.DB.Model(taskModel).Updates(map[string]interface{}{
			"status":        "failed",
			"error_message": "任务队列已满，请稍后再试",
		})
		Error(c, http.StatusServiceUnavailable, 503, "服务器繁忙，请稍后再试")
		return
	}

	Success(c, taskModel)
}

// GetTaskHandler 获取任务状态
func GetTaskHandler(c *gin.Context) {
	taskID := c.Param("task_id")
	var task model.Task
	if err := model.DB.Where("task_id = ?", taskID).First(&task).Error; err != nil {
		Error(c, http.StatusNotFound, 404, "任务未找到")
		return
	}

	Success(c, task)
}

// ListImagesHandler 获取图片列表（含搜索）
func ListImagesHandler(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	keyword := c.Query("keyword")

	var tasks []model.Task
	query := model.DB.Model(&model.Task{})

	if keyword != "" {
		query = query.Where("prompt LIKE ?", "%"+keyword+"%")
	}

	var total int64
	query.Count(&total)

	offset := (page - 1) * pageSize
	if err := query.Order("status='processing' DESC, status='pending' DESC, created_at DESC").Offset(offset).Limit(pageSize).Find(&tasks).Error; err != nil {
		Error(c, http.StatusInternalServerError, 500, "查询失败")
		return
	}

	Success(c, gin.H{
		"total": total,
		"list":  tasks,
	})
}

// DeleteImageHandler 删除图片
func DeleteImageHandler(c *gin.Context) {
	id := c.Param("id")
	var task model.Task
	if err := model.DB.Where("task_id = ?", id).First(&task).Error; err != nil {
		Error(c, http.StatusNotFound, 404, "图片不存在")
		return
	}

	// 删除物理文件/OSS 文件
	fileName := fmt.Sprintf("%s.jpg", task.TaskID)
	if err := storage.GlobalStorage.Delete(fileName); err != nil {
		// 记录日志但继续删除数据库记录，避免因为文件不存在导致记录无法删除
		fmt.Printf("警告: 删除物理文件失败 %s: %v\n", fileName, err)
	}

	if err := model.DB.Delete(&task).Error; err != nil {
		Error(c, http.StatusInternalServerError, 500, "删除数据库记录失败")
		return
	}

	Success(c, "删除成功")
}

// DownloadImageHandler 下载高清原图
func DownloadImageHandler(c *gin.Context) {
	id := c.Param("id")
	var task model.Task
	if err := model.DB.Where("task_id = ?", id).First(&task).Error; err != nil {
		Error(c, http.StatusNotFound, 404, "图片不存在")
		return
	}

	if task.LocalPath == "" {
		Error(c, http.StatusNotFound, 404, "本地文件路径为空")
		return
	}

	// 检查文件是否存在
	if _, err := os.Stat(task.LocalPath); os.IsNotExist(err) {
		Error(c, http.StatusNotFound, 404, "本地文件不存在")
		return
	}

	// 设置下载头
	fileName := fmt.Sprintf("%s.jpg", task.TaskID)
	c.Header("Content-Description", "File Transfer")
	c.Header("Content-Transfer-Encoding", "binary")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", fileName))
	c.Header("Content-Type", "application/octet-stream")
	c.File(task.LocalPath)
}

func getOptimizeSystemPrompt(forceJSON bool) string {
	if forceJSON {
		prompt := strings.TrimSpace(config.GlobalConfig.Prompts.OptimizeSystemJSON)
		if prompt == "" {
			return config.DefaultOptimizeSystemJSONPrompt
		}
		return prompt
	}
	prompt := strings.TrimSpace(config.GlobalConfig.Prompts.OptimizeSystem)
	if prompt == "" {
		return config.DefaultOptimizeSystemPrompt
	}
	return prompt
}

func callGeminiOptimize(ctx context.Context, cfg *model.ProviderConfig, modelName, prompt string, forceJSON bool) (string, error) {
	timeout := time.Duration(cfg.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 60 * time.Second
	}

	httpClient := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			DisableKeepAlives:   true,
			ForceAttemptHTTP2:   false,
			MaxIdleConns:        0,
			MaxIdleConnsPerHost: 0,
			TLSClientConfig: &tls.Config{
				MinVersion: tls.VersionTLS12,
			},
		},
	}

	clientConfig := &genai.ClientConfig{
		APIKey:     cfg.APIKey,
		Backend:    genai.BackendGeminiAPI,
		HTTPClient: httpClient,
	}

	if apiBase := strings.TrimRight(strings.TrimSpace(cfg.APIBase), "/"); apiBase != "" && apiBase != "https://generativelanguage.googleapis.com" {
		clientConfig.HTTPOptions = genai.HTTPOptions{BaseURL: apiBase}
	}

	client, err := genai.NewClient(ctx, clientConfig)
	if err != nil {
		return "", fmt.Errorf("创建 Gemini 客户端失败: %w", err)
	}

	systemPrompt := getOptimizeSystemPrompt(forceJSON)
	config := &genai.GenerateContentConfig{
		SystemInstruction: &genai.Content{
			Parts: []*genai.Part{{Text: systemPrompt}},
		},
	}
	if forceJSON {
		config.ResponseMIMEType = "application/json"
	}
	contents := []*genai.Content{
		{
			Role:  "user",
			Parts: []*genai.Part{{Text: prompt}},
		},
	}

	resp, err := client.Models.GenerateContent(ctx, modelName, contents, config)
	if err != nil {
		return "", fmt.Errorf("请求失败: %w", err)
	}

	optimized := strings.TrimSpace(resp.Text())
	if optimized == "" {
		return "", fmt.Errorf("未返回优化结果")
	}
	return optimized, nil
}

func callOpenAIOptimize(ctx context.Context, cfg *model.ProviderConfig, modelName, prompt string, forceJSON bool) (string, error) {
	timeout := time.Duration(cfg.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	httpClient := &http.Client{Timeout: timeout}
	apiBase := provider.NormalizeOpenAIBaseURL(cfg.APIBase)
	opts := []option.RequestOption{
		option.WithAPIKey(cfg.APIKey),
		option.WithHTTPClient(httpClient),
	}
	if apiBase != "" {
		opts = append(opts, option.WithBaseURL(apiBase))
	}
	client := openai.NewClient(opts...)

	systemPrompt := getOptimizeSystemPrompt(forceJSON)
	payload := map[string]interface{}{
		"model": modelName,
		"messages": []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(systemPrompt),
			openai.UserMessage(prompt),
		},
	}
	if forceJSON {
		payload["response_format"] = map[string]interface{}{"type": "json_object"}
	}

	var respBytes []byte
	if err := client.Post(ctx, "/chat/completions", payload, &respBytes); err != nil {
		return "", fmt.Errorf("请求失败: %s", formatOpenAIClientError(err))
	}

	optimized, err := extractChatMessage(respBytes)
	if err != nil {
		return "", err
	}
	optimized = strings.TrimSpace(optimized)
	if optimized == "" {
		return "", fmt.Errorf("未返回优化结果")
	}
	return optimized, nil
}

func buildModelsJSON(_ string, modelID, _ string) string {
	modelID = strings.TrimSpace(modelID)
	if modelID == "" {
		return ""
	}
	payload := []map[string]interface{}{
		{
			"id":      modelID,
			"name":    modelID,
			"default": true,
		},
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	return string(data)
}

func formatOpenAIClientError(err error) string {
	var apiErr *openai.Error
	if errors.As(err, &apiErr) {
		msg := strings.TrimSpace(apiErr.Message)
		if msg == "" {
			msg = strings.TrimSpace(apiErr.RawJSON())
		}
		if msg != "" {
			return msg
		}
	}
	return err.Error()
}

func extractChatMessage(resp []byte) (string, error) {
	var payload map[string]interface{}
	if err := json.Unmarshal(resp, &payload); err != nil {
		return "", fmt.Errorf("解析响应失败: %w", err)
	}
	choices, ok := payload["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return "", fmt.Errorf("响应中未找到 choices")
	}
	choice, ok := choices[0].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("响应格式错误")
	}
	msg, ok := choice["message"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("响应中未找到 message")
	}
	return extractTextFromContent(msg["content"]), nil
}

func extractTextFromContent(content interface{}) string {
	switch value := content.(type) {
	case string:
		return value
	case []interface{}:
		var parts []string
		for _, item := range value {
			part, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			if t, _ := part["type"].(string); t == "text" {
				if text, _ := part["text"].(string); text != "" {
					parts = append(parts, text)
				}
			}
		}
		return strings.Join(parts, "\n")
	case map[string]interface{}:
		if text, _ := value["text"].(string); text != "" {
			return text
		}
	}
	return ""
}
