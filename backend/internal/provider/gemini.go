package provider

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"image-gen-service/internal/model"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"google.golang.org/genai"
)

// defaultGeminiAPIBase 是 Google Gemini API 的默认基础 URL
const defaultGeminiAPIBase = "https://generativelanguage.googleapis.com"

type GeminiProvider struct {
	config *model.ProviderConfig
	// 不再持有 client，每次请求时新建，避免连接空闲失效导致 EOF
}

// NewGeminiProvider 初始化一个新的 Gemini Provider 实例。
// 它只保存配置，不创建 API client；实际的 client 在每次 Generate() 调用时
// 按需创建并在请求结束后丢弃，以避免连接空闲失效（EOF）问题。
func NewGeminiProvider(config *model.ProviderConfig) (*GeminiProvider, error) {
	// nil 检查必须放在最前面，否则后续访问 config 字段会 panic
	if config == nil {
		return nil, fmt.Errorf("config 不能为空")
	}
	// 复制配置，避免调用方循环变量复用导致所有实例共享同一指针
	cfgCopy := *config
	log.Printf("[Gemini] 正在初始化 Provider: BaseURL=%s, KeyLen=%d\n", cfgCopy.APIBase, len(cfgCopy.APIKey))
	log.Printf("[Gemini] Provider 初始化成功\n")
	return &GeminiProvider{config: &cfgCopy}, nil
}

// newClient 为每次请求创建全新的 genai.Client，避免连接复用导致 EOF
func (p *GeminiProvider) newClient(ctx context.Context) (*genai.Client, error) {
	timeout := time.Duration(p.config.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = time.Duration(defaultTimeoutSeconds(p.Name())) * time.Second
	}

	httpClient := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			DisableKeepAlives:   true,
			ForceAttemptHTTP2:   false,
			MaxIdleConns:        0,
			MaxIdleConnsPerHost: 0,
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: false,
				MinVersion:         tls.VersionTLS12,
			},
		},
	}

	clientConfig := &genai.ClientConfig{
		APIKey:     p.config.APIKey,
		Backend:    genai.BackendGeminiAPI,
		HTTPClient: httpClient,
	}

	if p.config.APIBase != "" && p.config.APIBase != defaultGeminiAPIBase {
		apiBase := strings.TrimRight(p.config.APIBase, "/")
		clientConfig.HTTPOptions = genai.HTTPOptions{
			BaseURL: apiBase,
		}
	}

	client, err := genai.NewClient(ctx, clientConfig)
	if err != nil {
		return nil, fmt.Errorf("创建 Gemini 客户端失败: %w", err)
	}

	log.Printf("[Gemini] 新建 client 用于本次请求\n")
	return client, nil
}

func (p *GeminiProvider) Name() string {
	return "gemini"
}

// Generate 使用 Gemini API 生成图片。
// 每次调用都会创建新的 API client，以解决上游服务空闲连接超时问题。

func (p *GeminiProvider) Generate(ctx context.Context, params map[string]interface{}) (*ProviderResult, error) {
	// 每次请求创建新的 client，避免连接空闲失效导致 EOF
	client, err := p.newClient(ctx)
	if err != nil {
		return nil, err
	}
	// 记录日志时排除大数据字段
	logParams := make(map[string]interface{})
	for k, v := range params {
		if k == "reference_images" {
			if list, ok := v.([]interface{}); ok {
				logParams[k] = fmt.Sprintf("[%d images]", len(list))
			} else {
				logParams[k] = v
			}
		} else {
			logParams[k] = v
		}
	}
	log.Printf("[Gemini] Generate 被调用, Params: %+v\n", logParams)
	prompt, _ := params["prompt"].(string)
	if prompt == "" {
		return nil, fmt.Errorf("缺少 prompt 参数")
	}

	modelID := ResolveModelID(ModelResolveOptions{
		ProviderName: p.Name(),
		Purpose:      PurposeImage,
		Params:       params,
		Config:       p.config,
	}).ID
	if modelID == "" {
		return nil, fmt.Errorf("缺少 model_id 参数")
	}

	// 准备生成配置 (使用 GenerateContentConfig 适配 Gemini 3)
	// 对于 Imagen 3 模型，建议包含 "TEXT" 和 "IMAGE" 以获得更完整的响应
	// 如果只设置 "IMAGE"，某些中转或代理可能会处理不当
	genConfig := &genai.GenerateContentConfig{
		ResponseModalities: []string{"TEXT", "IMAGE"},
	}

	// 1. 处理比例 (Aspect Ratio)
	ar, ok := params["aspect_ratio"].(string)
	if !ok {
		ar, ok = params["aspectRatio"].(string)
	}
	if ok {
		if genConfig.ImageConfig == nil {
			genConfig.ImageConfig = &genai.ImageConfig{}
		}
		// 确保比例格式正确 (例如 16:9)
		genConfig.ImageConfig.AspectRatio = strings.TrimSpace(ar)
	}

	// 2. 处理分辨率级别 (1K, 2K, 4K)
	quality, ok := params["resolution_level"].(string)
	if !ok {
		quality, ok = params["imageSize"].(string)
	}
	if !ok {
		quality, ok = params["image_size"].(string)
	}
	if ok {
		if genConfig.ImageConfig == nil {
			genConfig.ImageConfig = &genai.ImageConfig{}
		}
		// 确保分辨率为大写 (1K, 2K, 4K)
		genConfig.ImageConfig.ImageSize = strings.ToUpper(strings.TrimSpace(quality))
	}

	// 3. 安全设置 (避免由于安全过滤导致的空响应)
	genConfig.SafetySettings = []*genai.SafetySetting{
		{Category: genai.HarmCategoryHateSpeech, Threshold: genai.HarmBlockThresholdBlockNone},
		{Category: genai.HarmCategoryDangerousContent, Threshold: genai.HarmBlockThresholdBlockNone},
		{Category: genai.HarmCategoryHarassment, Threshold: genai.HarmBlockThresholdBlockNone},
		{Category: genai.HarmCategorySexuallyExplicit, Threshold: genai.HarmBlockThresholdBlockNone},
	}

	// 4. 处理数量 (CandidateCount)
	count, ok := params["count"].(int)
	if !ok {
		// 尝试从 float64 转换 (JSON 解析可能变成 float64)
		if f, ok := params["count"].(float64); ok {
			count = int(f)
		} else {
			count = 1
		}
	}
	if count > 0 {
		genConfig.CandidateCount = int32(count)
	}

	// 判断是否为图生图 (Image-to-Image)
	// 如果 params 中包含 reference_images (base64 列表)
	if refImgs, ok := params["reference_images"].([]interface{}); ok && len(refImgs) > 0 {
		return p.generateWithReferences(ctx, client, modelID, prompt, refImgs, genConfig)
	}

	// 默认为文生图 (Text-to-Image)
	return p.generateViaContent(ctx, client, modelID, prompt, genConfig)
}

// removeMarkdownImages 从提示词中移除 Markdown 图片语法 ![alt](url)，只保留 alt 文字
func (p *GeminiProvider) removeMarkdownImages(text string) string {
	// 匹配 ![alt](url)
	re := regexp.MustCompile(`!\[(.*?)\]\([^\)]+\)`)
	return re.ReplaceAllStringFunc(text, func(match string) string {
		submatch := re.FindStringSubmatch(match)
		if len(submatch) > 1 {
			return strings.TrimSpace(submatch[1])
		}
		return ""
	})
}

func (p *GeminiProvider) generateWithReferences(ctx context.Context, client *genai.Client, modelID, prompt string, refImgs []interface{}, config *genai.GenerateContentConfig) (*ProviderResult, error) {
	// 清理提示词，移除可能存在的 Markdown 图片链接
	cleanedPrompt := p.removeMarkdownImages(prompt)

	// 准备 Parts
	parts := []*genai.Part{}

	// 1. 先添加参考图片 (按照 Python 版和官方最佳实践，图片在前)
	for i, ref := range refImgs {
		var imgBytes []byte
		var mimeType string
		var err error

		switch v := ref.(type) {
		case string:
			base64Data := v
			// 处理带前缀的 base64 (data:image/jpeg;base64,...)
			if strings.Contains(base64Data, ",") {
				partsSplit := strings.Split(base64Data, ",")
				base64Data = partsSplit[1]
			}
			imgBytes, err = base64.StdEncoding.DecodeString(base64Data)
			if err != nil {
				return nil, fmt.Errorf("解码第 %d 张参考图失败: %w", i, err)
			}
		case []byte:
			imgBytes = v
		default:
			continue
		}

		// 自动检测 MIME Type
		mimeType = http.DetectContentType(imgBytes)
		// 确保是图片类型，如果检测失败默认用 image/jpeg
		if !strings.HasPrefix(mimeType, "image/") {
			mimeType = "image/jpeg"
		}

		// 将图片作为 InlineData 添加到 Parts 中
		parts = append(parts, &genai.Part{
			InlineData: &genai.Blob{
				MIMEType: mimeType,
				Data:     imgBytes,
			},
		})
	}

	// 2. 再添加文本提示词
	parts = append(parts, &genai.Part{Text: cleanedPrompt})

	// 安全读取 ImageConfig 字段，避免 nil pointer panic
	var aspectRatio, imageSize string
	if config.ImageConfig != nil {
		aspectRatio = config.ImageConfig.AspectRatio
		imageSize = config.ImageConfig.ImageSize
	}
	// 调用 GenerateContent 接口
	log.Printf("[Gemini] 开始调用 GenerateContent, Model: %s, Parts: %d, AspectRatio: %s, ImageSize: %s\n",
		modelID, len(parts), aspectRatio, imageSize)

	resp, err := client.Models.GenerateContent(ctx, modelID, []*genai.Content{
		{
			Role:  "user",
			Parts: parts,
		},
	}, config)
	if err != nil {
		return nil, fmt.Errorf("图生图 GenerateContent 调用失败: %w", err)
	}

	if len(resp.Candidates) == 0 || resp.Candidates[0].Content == nil {
		return nil, fmt.Errorf("API 未返回有效内容 (可能触发了安全过滤或配额限制)")
	}

	candidate := resp.Candidates[0]

	// 解析返回的图片数据
	var images [][]byte
	for _, part := range candidate.Content.Parts {
		if part.InlineData != nil && len(part.InlineData.Data) > 0 {
			images = append(images, part.InlineData.Data)
		}
	}

	if len(images) == 0 {
		// 构造详细的错误信息
		var reason strings.Builder
		reason.WriteString(fmt.Sprintf("未在响应中找到图片数据 (FinishReason: %s)", candidate.FinishReason))

		for _, part := range candidate.Content.Parts {
			if part.Text != "" {
				reason.WriteString(fmt.Sprintf(" | 文本响应: %s", part.Text))
			}
		}

		if len(candidate.SafetyRatings) > 0 {
			for _, rating := range candidate.SafetyRatings {
				if rating.Probability != "NEGLIGIBLE" && rating.Probability != "" {
					reason.WriteString(fmt.Sprintf(" | 安全警告: %s(%s)", rating.Category, rating.Probability))
				}
			}
		}
		return nil, errors.New(reason.String())
	}

	return &ProviderResult{
		Images: images,
		Metadata: map[string]interface{}{
			"provider":      "gemini",
			"model":         modelID,
			"finish_reason": candidate.FinishReason,
			"type":          "image-to-image",
		},
	}, nil
}

// generateViaContent 尝试通过 GenerateContent 接口发送请求 (适配某些中转 API)
func (p *GeminiProvider) generateViaContent(ctx context.Context, client *genai.Client, modelID, prompt string, config *genai.GenerateContentConfig) (*ProviderResult, error) {
	// 清理提示词
	cleanedPrompt := p.removeMarkdownImages(prompt)

	// 将 prompt 包装成 contents 结构
	content := &genai.Content{
		Role: "user",
		Parts: []*genai.Part{
			{Text: cleanedPrompt},
		},
	}

	// 安全读取 ImageConfig 字段，避免 nil pointer panic
	var aspectRatio, imageSize string
	if config.ImageConfig != nil {
		aspectRatio = config.ImageConfig.AspectRatio
		imageSize = config.ImageConfig.ImageSize
	}
	log.Printf("[Gemini] 开始调用 GenerateContent (Text-to-Image), Model: %s, AspectRatio: %s, ImageSize: %s\n",
		modelID, aspectRatio, imageSize)

	resp, err := client.Models.GenerateContent(ctx, modelID, []*genai.Content{content}, config)
	if err != nil {
		return nil, fmt.Errorf("通过 GenerateContent 调用失败: %w", err)
	}

	if len(resp.Candidates) == 0 || resp.Candidates[0].Content == nil {
		return nil, fmt.Errorf("通过 GenerateContent 调用未返回有效内容 (可能是由于安全过滤或配额限制)")
	}

	candidate := resp.Candidates[0]

	// 解析返回的图片数据
	var images [][]byte
	for _, part := range candidate.Content.Parts {
		if part.InlineData != nil && len(part.InlineData.Data) > 0 {
			images = append(images, part.InlineData.Data)
		}
	}

	if len(images) == 0 {
		var reason strings.Builder
		reason.WriteString(fmt.Sprintf("未在响应中找到图片数据 (FinishReason: %s)", candidate.FinishReason))

		for _, part := range candidate.Content.Parts {
			if part.Text != "" {
				reason.WriteString(fmt.Sprintf(" | 文本响应: %s", part.Text))
			}
		}

		if len(candidate.SafetyRatings) > 0 {
			for _, rating := range candidate.SafetyRatings {
				if rating.Probability != "NEGLIGIBLE" && rating.Probability != "" {
					reason.WriteString(fmt.Sprintf(" | 安全警告: %s(%s)", rating.Category, rating.Probability))
				}
			}
		}
		return nil, errors.New(reason.String())
	}

	return &ProviderResult{
		Images: images,
		Metadata: map[string]interface{}{
			"provider":      "gemini",
			"model":         modelID,
			"finish_reason": candidate.FinishReason,
			"type":          "text-to-image",
		},
	}, nil
}

func (p *GeminiProvider) ValidateParams(params map[string]interface{}) error {
	prompt, _ := params["prompt"].(string)
	if prompt == "" {
		return fmt.Errorf("prompt 不能为空")
	}

	// 1. 校验比例 (Aspect Ratio)
	ar, ok := params["aspect_ratio"].(string)
	if !ok {
		ar, _ = params["aspectRatio"].(string)
	}
	if ar != "" {
		validARs := map[string]bool{
			"1:1": true, "2:3": true, "3:2": true, "3:4": true, "4:3": true,
			"4:5": true, "5:4": true, "9:16": true, "16:9": true, "21:9": true,
		}
		if !validARs[ar] {
			return fmt.Errorf("不支持的比例: %s，可选值: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9", ar)
		}
	}

	// 2. 校验分辨率级别 (1K, 2K, 4K)
	rl, ok := params["resolution_level"].(string)
	if !ok {
		rl, _ = params["imageSize"].(string)
	}
	if !ok {
		rl, _ = params["image_size"].(string)
	}
	if rl != "" {
		validRLs := map[string]bool{"1K": true, "2K": true, "4K": true}
		if !validRLs[rl] {
			return fmt.Errorf("不支持的分辨率级别: %s，请使用: 1K, 2K, 4K", rl)
		}
	}

	return nil
}
