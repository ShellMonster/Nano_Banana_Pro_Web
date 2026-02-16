package api

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
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

func defaultTimeoutSecondsForProvider(providerName string) int {
	switch providerName {
	case "gemini", "openai":
		return 500
	default:
		return 150
	}
}

// ProviderConfigRequest 设置 Provider 配置请求
type ProviderConfigRequest struct {
	ProviderName string `json:"provider_name" binding:"required"`
	DisplayName  string `json:"display_name"`
	APIBase      string `json:"api_base" binding:"required"`
	APIKey       string `json:"api_key" binding:"required"`
	Enabled      bool   `json:"enabled"`
	ModelID      string `json:"model_id"`
	TimeoutSecs  *int   `json:"timeout_seconds"`
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
		timeoutSeconds := defaultTimeoutSecondsForProvider(req.ProviderName)
		if req.TimeoutSecs != nil && *req.TimeoutSecs > 0 {
			timeoutSeconds = *req.TimeoutSecs
		}

		configData = model.ProviderConfig{
			ProviderName:   req.ProviderName,
			DisplayName:    req.DisplayName,
			APIBase:        req.APIBase,
			APIKey:         req.APIKey,
			Models:         modelsJSON,
			Enabled:        req.Enabled,
			TimeoutSeconds: timeoutSeconds,
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
		if req.TimeoutSecs != nil {
			if *req.TimeoutSecs > 0 {
				updates["timeout_seconds"] = *req.TimeoutSecs
			} else {
				updates["timeout_seconds"] = defaultTimeoutSecondsForProvider(req.ProviderName)
			}
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
	pageSizeStr := strings.TrimSpace(c.Query("page_size"))
	if pageSizeStr == "" {
		pageSizeStr = strings.TrimSpace(c.Query("pageSize"))
	}
	if pageSizeStr == "" {
		pageSizeStr = "20"
	}
	pageSize, _ := strconv.Atoi(pageSizeStr)
	if pageSize <= 0 {
		pageSize = 20
	} else if pageSize > 100 {
		pageSize = 100
	}
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
	// 优先使用数据库中存储的实际路径，兼容旧数据则尝试各种格式
	if task.LocalPath != "" {
		// 使用实际存储的文件名
		fileName := filepath.Base(task.LocalPath)
		if err := storage.GlobalStorage.Delete(fileName); err != nil {
			fmt.Printf("警告: 删除物理文件失败 %s: %v\n", fileName, err)
		}
	} else {
		// 兼容旧数据：尝试各种格式
		for _, ext := range []string{".png", ".jpg", ".gif", ".webp"} {
			fileName := task.TaskID + ext
			storage.GlobalStorage.Delete(fileName)
		}
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

	// 根据实际文件扩展名设置下载文件名
	ext := filepath.Ext(task.LocalPath)
	if ext == "" {
		ext = ".png" // 默认使用 .png
	}
	fileName := fmt.Sprintf("%s%s", task.TaskID, ext)
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
		timeout = 150 * time.Second
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
		timeout = 150 * time.Second
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

// ImageToPromptRequest 图片逆向提示词请求
type ImageToPromptRequest struct {
	Provider string `form:"provider"`
	Model    string `form:"model"`
}

// 图片上传大小限制常量
const maxImageUploadSize = 20 * 1024 * 1024 // 20MB

// ImageToPromptHandler 图片逆向提示词处理函数
// 用户上传图片，后端分析图片内容并生成提示词
func ImageToPromptHandler(c *gin.Context) {
	log.Printf("[API] 收到图片逆向提示词请求\n")

	// 限制请求体大小，防止 DoS 攻击
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxImageUploadSize)

	// 1. 解析请求参数
	providerName := strings.TrimSpace(strings.ToLower(c.PostForm("provider")))
	if providerName == "" {
		providerName = "gemini-chat"
	}
	if providerName == "openai" {
		providerName = "openai-chat"
	}
	if providerName == "gemini" {
		providerName = "gemini-chat"
	}

	// 2. 获取 Provider 配置
	var cfg model.ProviderConfig
	if err := model.DB.Where("provider_name = ?", providerName).First(&cfg).Error; err != nil {
		Error(c, http.StatusBadRequest, 400, "未找到指定的 Provider: "+providerName)
		return
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		Error(c, http.StatusBadRequest, 400, "Provider API Key 未配置")
		return
	}

	// 3. 解析模型名称
	modelName := provider.ResolveModelID(provider.ModelResolveOptions{
		ProviderName: providerName,
		Purpose:      provider.PurposeChat,
		RequestModel: c.PostForm("model"),
		Config:       &cfg,
	}).ID
	if modelName == "" {
		Error(c, http.StatusBadRequest, 400, "未找到可用的模型")
		return
	}

	// 4. 获取图片数据（支持 multipart 文件上传或本地路径）
	var imageData []byte

	// 方式1: 从 multipart 文件上传获取
	file, header, err := c.Request.FormFile("image")
	if err == nil && file != nil {
		defer file.Close()
		// 限制读取大小，使用 LimitReader 防止读取超过限制的数据
		limitedReader := io.LimitReader(file, maxImageUploadSize+1)
		imageData, err = io.ReadAll(limitedReader)
		if err != nil {
			Error(c, http.StatusBadRequest, 400, "读取上传图片失败")
			return
		}
		if len(imageData) > maxImageUploadSize {
			Error(c, http.StatusBadRequest, 400, "图片大小超过 20MB 限制")
			return
		}
		log.Printf("[API] 从文件上传获取图片: %s, 大小: %d bytes\n", header.Filename, len(imageData))
	}

	// 方式2: 从本地路径获取（Tauri 桌面端优化）
	if len(imageData) == 0 {
		localPath := c.PostForm("image_path")
		if localPath != "" {
			// 安全校验：检查路径是否合法，防止路径遍历攻击
			cleanPath := filepath.Clean(localPath)
			// 检查路径中是否包含可疑的遍历字符
			if strings.Contains(cleanPath, "..") || strings.Contains(localPath, "..") {
				Error(c, http.StatusBadRequest, 400, "非法的图片路径")
				return
			}
			// 检查文件是否存在且可读
			info, err := os.Stat(cleanPath)
			if err != nil {
				Error(c, http.StatusBadRequest, 400, "读取本地图片失败")
				return
			}
			// 检查文件大小
			if info.Size() > maxImageUploadSize {
				Error(c, http.StatusBadRequest, 400, "图片大小超过 20MB 限制")
				return
			}
			imageData, err = os.ReadFile(cleanPath)
			if err != nil {
				Error(c, http.StatusBadRequest, 400, "读取本地图片失败")
				return
			}
			log.Printf("[API] 从本地路径获取图片: 大小: %d bytes\n", len(imageData))
		}
	}

	if len(imageData) == 0 {
		Error(c, http.StatusBadRequest, 400, "请提供图片（通过 image 文件上传或 image_path 参数）")
		return
	}

	// 5. 获取系统提示词
	systemPrompt := strings.TrimSpace(config.GlobalConfig.Prompts.ImageToPromptSystem)
	if systemPrompt == "" {
		systemPrompt = config.DefaultImageToPromptSystem
	}

	// 6. 获取用户语言偏好，动态替换语言指令占位符
	language := c.PostForm("language")
	log.Printf("[API] 图片逆向提示词语言参数: %s\n", language)
	outputLangInstruction := getImageToPromptLanguageInstruction(language)
	log.Printf("[API] 图片逆向提示词语言指令: %s\n", outputLangInstruction)
	// 替换占位符 {{LANGUAGE_INSTRUCTION}} 为实际的语言要求
	systemPrompt = strings.Replace(systemPrompt, "{{LANGUAGE_INSTRUCTION}}", outputLangInstruction, 1)

	// 7. 调用 AI 模型分析图片
	var result string
	if providerName == "gemini-chat" {
		result, err = callGeminiImageToPrompt(c.Request.Context(), &cfg, modelName, imageData, systemPrompt)
	} else {
		result, err = callOpenAIImageToPrompt(c.Request.Context(), &cfg, modelName, imageData, systemPrompt)
	}

	if err != nil {
		Error(c, http.StatusBadRequest, 400, "分析图片失败: "+err.Error())
		return
	}

	log.Printf("[API] 图片逆向提示词成功, 结果长度: %d\n", len(result))
	Success(c, gin.H{"prompt": result})
}

// callGeminiImageToPrompt 使用 Gemini 分析图片生成提示词
func callGeminiImageToPrompt(ctx context.Context, cfg *model.ProviderConfig, modelName string, imageData []byte, systemPrompt string) (string, error) {
	log.Printf("[ImageToPrompt] 开始调用 Gemini API, 模型: %s, API Base: %s", modelName, cfg.APIBase)

	timeout := time.Duration(cfg.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 150 * time.Second
	}
	log.Printf("[ImageToPrompt] 超时设置: %v", timeout)

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
		log.Printf("[ImageToPrompt] 使用自定义 API Base: %s", apiBase)
	}

	log.Printf("[ImageToPrompt] 正在创建 Gemini 客户端...")
	client, err := genai.NewClient(ctx, clientConfig)
	if err != nil {
		log.Printf("[ImageToPrompt] 创建 Gemini 客户端失败: %v", err)
		return "", fmt.Errorf("创建 Gemini 客户端失败: %w", err)
	}
	log.Printf("[ImageToPrompt] Gemini 客户端创建成功")

	// 自动检测 MIME Type
	mimeType := http.DetectContentType(imageData)
	if !strings.HasPrefix(mimeType, "image/") {
		mimeType = "image/jpeg"
	}
	log.Printf("[ImageToPrompt] 图片 MIME Type: %s, 数据大小: %d bytes", mimeType, len(imageData))

	// 构建请求：图片 + 系统提示词
	contents := []*genai.Content{
		{
			Role: "user",
			Parts: []*genai.Part{
				{
					InlineData: &genai.Blob{
						MIMEType: mimeType,
						Data:     imageData,
					},
				},
				{Text: "请分析这张图片并生成提示词描述。"},
			},
		},
	}

	genConfig := &genai.GenerateContentConfig{
		SystemInstruction: &genai.Content{
			Parts: []*genai.Part{{Text: systemPrompt}},
		},
	}

	log.Printf("[ImageToPrompt] 正在调用 Gemini API GenerateContent...")
	startTime := time.Now()
	resp, err := client.Models.GenerateContent(ctx, modelName, contents, genConfig)
	elapsed := time.Since(startTime)
	log.Printf("[ImageToPrompt] Gemini API 调用完成, 耗时: %v", elapsed)

	if err != nil {
		log.Printf("[ImageToPrompt] Gemini API 请求失败: %v", err)
		return "", fmt.Errorf("请求失败: %w", err)
	}

	result := strings.TrimSpace(resp.Text())
	log.Printf("[ImageToPrompt] Gemini API 返回结果长度: %d", len(result))
	if result == "" {
		log.Printf("[ImageToPrompt] Gemini API 返回空结果")
		return "", fmt.Errorf("未返回分析结果")
	}
	log.Printf("[ImageToPrompt] 成功获取提示词, 前100字符: %s", truncateString(result, 100))
	return result, nil
}

// truncateString 截断字符串用于日志显示
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

// getImageToPromptLanguageInstruction 根据用户语言返回逆向提示词的输出语言指令
// 返回完整的语言输出要求，用于替换系统提示词中的 {{LANGUAGE_INSTRUCTION}} 占位符
func getImageToPromptLanguageInstruction(language string) string {
	// 统一小写处理
	lang := strings.ToLower(strings.TrimSpace(language))
	if lang == "" {
		// 默认英文
		return "用英文输出提示词"
	}

	// 语言映射表：语言代码 -> 输出语言指令
	languageInstructions := map[string]string{
		// 中文
		"zh-cn": "用中文输出提示词",
		"zh-tw": "用繁體中文輸出提示詞",
		"zh-hk": "用繁體中文輸出提示詞",
		"zh":    "用中文输出提示词",
		// 日语
		"ja":    "日本語でプロンプトを出力してください",
		"ja-jp": "日本語でプロンプトを出力してください",
		// 韩语
		"ko":    "한국어로 프롬프트를 출력하세요",
		"ko-kr": "한국어로 프롬프트를 출력하세요",
		// 法语
		"fr":    "Générez le prompt en français",
		"fr-fr": "Générez le prompt en français",
		// 德语
		"de":    "Geben Sie den Prompt auf Deutsch aus",
		"de-de": "Geben Sie den Prompt auf Deutsch aus",
		// 西班牙语
		"es":    "Genere el prompt en español",
		"es-es": "Genere el prompt en español",
		// 意大利语
		"it":    "Restituisci il prompt in italiano",
		"it-it": "Restituisci il prompt in italiano",
		// 葡萄牙语
		"pt":    "Gere o prompt em português",
		"pt-br": "Gere o prompt em português",
		"pt-pt": "Gere o prompt em português",
		// 俄语
		"ru":    "Выведите промпт на русском языке",
		"ru-ru": "Выведите промпт на русском языке",
		// 阿拉伯语
		"ar":    "أخرج الموجه باللغة العربية",
		"ar-sa": "أخرج الموجه باللغة العربية",
		// 印地语
		"hi":    "प्रॉम्प्ट हिंदी में आउटपुट करें",
		"hi-in": "प्रॉम्प्ट हिंदी में आउटपुट करें",
		// 泰语
		"th":    "ส่งออกพรอมต์เป็นภาษาไทย",
		"th-th": "ส่งออกพรอมต์เป็นภาษาไทย",
		// 越南语
		"vi":    "Xuất lời nhắc bằng tiếng Việt",
		"vi-vn": "Xuất lời nhắc bằng tiếng Việt",
		// 印尼语
		"id":    "Keluarkan prompt dalam bahasa Indonesia",
		"id-id": "Keluarkan prompt dalam bahasa Indonesia",
		// 马来语
		"ms":    "Keluaran prompt dalam bahasa Melayu",
		"ms-my": "Keluaran prompt dalam bahasa Melayu",
		// 荷兰语
		"nl":    "Geef de prompt in het Nederlands",
		"nl-nl": "Geef de prompt in het Nederlands",
		// 波兰语
		"pl":    "Wyświetl monit w języku polskim",
		"pl-pl": "Wyświetl monit w języku polskim",
		// 土耳其语
		"tr":    "İstemi Türkçe olarak çıktılayın",
		"tr-tr": "İstemi Türkçe olarak çıktılayın",
		// 乌克兰语
		"uk":    "Виведіть підказку українською мовою",
		"uk-ua": "Виведіть підказку українською мовою",
	}

	// 先尝试完整匹配
	if instruction, ok := languageInstructions[lang]; ok {
		return instruction
	}

	// 尝试匹配语言主代码（如 zh-CN -> zh）
	if idx := strings.Index(lang, "-"); idx > 0 {
		mainLang := lang[:idx]
		if instruction, ok := languageInstructions[mainLang]; ok {
			return instruction
		}
	}

	// 默认返回英文要求
	return "用英文输出提示词"
}

// callOpenAIImageToPrompt 使用 OpenAI Vision 分析图片生成提示词
func callOpenAIImageToPrompt(ctx context.Context, cfg *model.ProviderConfig, modelName string, imageData []byte, systemPrompt string) (string, error) {
	log.Printf("[ImageToPrompt] 开始调用 OpenAI Vision API, 模型: %s, API Base: %s", modelName, cfg.APIBase)

	timeout := time.Duration(cfg.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 150 * time.Second
	}
	log.Printf("[ImageToPrompt] 超时设置: %v", timeout)

	httpClient := &http.Client{Timeout: timeout}
	apiBase := provider.NormalizeOpenAIBaseURL(cfg.APIBase)
	opts := []option.RequestOption{
		option.WithAPIKey(cfg.APIKey),
		option.WithHTTPClient(httpClient),
	}
	if apiBase != "" {
		opts = append(opts, option.WithBaseURL(apiBase))
		log.Printf("[ImageToPrompt] 使用自定义 API Base: %s", apiBase)
	}
	client := openai.NewClient(opts...)

	// 构建 base64 图片数据
	mimeType := http.DetectContentType(imageData)
	if !strings.HasPrefix(mimeType, "image/") {
		mimeType = "image/jpeg"
	}
	log.Printf("[ImageToPrompt] 图片 MIME Type: %s, 数据大小: %d bytes", mimeType, len(imageData))

	base64Image := base64.StdEncoding.EncodeToString(imageData)
	dataURL := fmt.Sprintf("data:%s;base64,%s", mimeType, base64Image)

	// 构建请求
	payload := map[string]interface{}{
		"model": modelName,
		"messages": []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(systemPrompt),
			openai.UserMessage([]openai.ChatCompletionContentPartUnionParam{
				openai.ImageContentPart(openai.ChatCompletionContentPartImageImageURLParam{
					URL: dataURL,
				}),
				openai.TextContentPart("请分析这张图片并生成提示词描述。"),
			}),
		},
	}

	log.Printf("[ImageToPrompt] 正在调用 OpenAI API /chat/completions...")
	startTime := time.Now()
	var respBytes []byte
	if err := client.Post(ctx, "/chat/completions", payload, &respBytes); err != nil {
		elapsed := time.Since(startTime)
		log.Printf("[ImageToPrompt] OpenAI API 请求失败, 耗时: %v, 错误: %v", elapsed, err)
		return "", fmt.Errorf("请求失败: %s", formatOpenAIClientError(err))
	}
	elapsed := time.Since(startTime)
	log.Printf("[ImageToPrompt] OpenAI API 调用完成, 耗时: %v, 响应长度: %d", elapsed, len(respBytes))

	result, err := extractChatMessage(respBytes)
	if err != nil {
		log.Printf("[ImageToPrompt] 解析响应失败: %v, 原始响应: %s", err, truncateString(string(respBytes), 500))
		return "", err
	}

	result = strings.TrimSpace(result)
	log.Printf("[ImageToPrompt] OpenAI API 返回结果长度: %d", len(result))
	if result == "" {
		log.Printf("[ImageToPrompt] OpenAI API 返回空结果")
		return "", fmt.Errorf("未返回分析结果")
	}
	log.Printf("[ImageToPrompt] 成功获取提示词, 前100字符: %s", truncateString(result, 100))
	return result, nil
}
