package provider

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image-gen-service/internal/diagnostic"
	"image-gen-service/internal/model"
	"io"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

// defaultGeminiAPIBase 是 Google Gemini API 的默认基础 URL
const defaultGeminiAPIBase = "https://generativelanguage.googleapis.com"

type GeminiProvider struct {
	config *model.ProviderConfig
}

type geminiGenerateRequest struct {
	Contents          []geminiContent       `json:"contents"`
	SystemInstruction *geminiContent        `json:"systemInstruction,omitempty"`
	GenerationConfig  *geminiGenerateConfig `json:"generationConfig,omitempty"`
	SafetySettings    []geminiSafetySetting `json:"safetySettings,omitempty"`
}

type geminiGenerateConfig struct {
	ResponseModalities []string           `json:"responseModalities,omitempty"`
	CandidateCount     int                `json:"candidateCount,omitempty"`
	ImageConfig        *geminiImageConfig `json:"imageConfig,omitempty"`
	ResponseMIMEType   string             `json:"responseMimeType,omitempty"`
}

type geminiImageConfig struct {
	AspectRatio string `json:"aspectRatio,omitempty"`
	ImageSize   string `json:"imageSize,omitempty"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts,omitempty"`
}

type geminiPart struct {
	Text       string      `json:"text,omitempty"`
	InlineData *geminiBlob `json:"inlineData,omitempty"`
}

type geminiBlob struct {
	MIMEType string `json:"mimeType,omitempty"`
	Data     string `json:"data,omitempty"`
}

type geminiSafetySetting struct {
	Category  string `json:"category"`
	Threshold string `json:"threshold"`
}

type geminiGenerateResponse struct {
	Candidates []geminiCandidate `json:"candidates"`
}

type geminiCandidate struct {
	Content       *geminiContent       `json:"content"`
	FinishReason  string               `json:"finishReason"`
	SafetyRatings []geminiSafetyRating `json:"safetyRatings"`
}

type geminiSafetyRating struct {
	Category    string `json:"category"`
	Probability string `json:"probability"`
}

// NewGeminiProvider 初始化一个新的 Gemini Provider 实例。
func NewGeminiProvider(config *model.ProviderConfig) (*GeminiProvider, error) {
	if config == nil {
		return nil, fmt.Errorf("config 不能为空")
	}
	cfgCopy := *config
	log.Printf("[Gemini] 正在初始化 Provider: BaseURL=%s, KeyLen=%d\n", cfgCopy.APIBase, len(cfgCopy.APIKey))
	log.Printf("[Gemini] Provider 初始化成功\n")
	return &GeminiProvider{config: &cfgCopy}, nil
}

func (p *GeminiProvider) newHTTPClient() *http.Client {
	return &http.Client{
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
}

func (p *GeminiProvider) Name() string {
	return "gemini"
}

func supportedAspectRatiosForGeminiModel(modelID string) []string {
	normalized := strings.TrimSpace(strings.ToLower(modelID))
	switch normalized {
	case "gemini-3.1-flash-image-preview":
		return []string{
			"1:1", "1:4", "1:8",
			"2:3", "3:2", "3:4",
			"4:1", "4:3", "4:5",
			"5:4", "8:1",
			"9:16", "16:9", "21:9",
		}
	default:
		return []string{
			"1:1", "2:3", "3:2", "3:4", "4:3",
			"4:5", "5:4", "9:16", "16:9", "21:9",
		}
	}
}

func responseModalities(config *geminiGenerateConfig) []string {
	if config == nil || len(config.ResponseModalities) == 0 {
		return []string{}
	}
	return append([]string(nil), config.ResponseModalities...)
}

func summarizeGeminiResponse(resp *geminiGenerateResponse) map[string]interface{} {
	summary := map[string]interface{}{
		"candidate_count": 0,
		"finish_reason":   "",
		"part_count":      0,
		"text_parts":      0,
		"image_parts":     0,
		"text_preview":    "",
		"safety_hits":     0,
	}
	if resp == nil {
		return summary
	}

	summary["candidate_count"] = len(resp.Candidates)
	if len(resp.Candidates) == 0 {
		return summary
	}

	candidate := resp.Candidates[0]
	summary["finish_reason"] = strings.TrimSpace(candidate.FinishReason)

	if candidate.Content != nil {
		summary["part_count"] = len(candidate.Content.Parts)
		textParts := make([]string, 0)
		imageParts := 0
		for _, part := range candidate.Content.Parts {
			if strings.TrimSpace(part.Text) != "" {
				textParts = append(textParts, strings.TrimSpace(part.Text))
			}
			if part.InlineData != nil && strings.TrimSpace(part.InlineData.Data) != "" {
				imageParts++
			}
		}
		summary["text_parts"] = len(textParts)
		summary["image_parts"] = imageParts
		summary["text_preview"] = diagnostic.Preview(strings.Join(textParts, " | "), 240)
	}

	safetyHits := 0
	for _, rating := range candidate.SafetyRatings {
		probability := strings.TrimSpace(rating.Probability)
		if probability != "" && probability != "NEGLIGIBLE" {
			safetyHits++
		}
	}
	summary["safety_hits"] = safetyHits
	return summary
}

func headerLines(header http.Header) []string {
	lines := make([]string, 0, len(header))
	keys := make([]string, 0, len(header))
	for key := range header {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		lines = append(lines, fmt.Sprintf("%s: %s", key, strings.Join(header.Values(key), ", ")))
	}
	return lines
}

func extractRequestIDFromHeaders(header http.Header) string {
	candidates := []string{
		"x-api-request-id",
		"x-oneapi-request-id",
		"x-request-id",
		"request-id",
		"x-gateway-request-id",
		"x-amzn-requestid",
		"x-trace-id",
		"trace-id",
	}
	for _, key := range candidates {
		if value := strings.TrimSpace(header.Get(key)); value != "" {
			return value
		}
	}
	return ""
}

func (p *GeminiProvider) buildGenerateConfig(params map[string]interface{}) *geminiGenerateConfig {
	config := &geminiGenerateConfig{
		ResponseModalities: []string{"TEXT", "IMAGE"},
		CandidateCount:     1,
	}

	if count, ok := params["count"].(int); ok && count > 0 {
		config.CandidateCount = count
	} else if count, ok := params["count"].(float64); ok && count > 0 {
		config.CandidateCount = int(count)
	}

	ar, ok := params["aspect_ratio"].(string)
	if !ok {
		ar, _ = params["aspectRatio"].(string)
	}
	imageSize, ok := params["resolution_level"].(string)
	if !ok {
		imageSize, ok = params["imageSize"].(string)
	}
	if !ok {
		imageSize, _ = params["image_size"].(string)
	}

	if strings.TrimSpace(ar) != "" || strings.TrimSpace(imageSize) != "" {
		config.ImageConfig = &geminiImageConfig{
			AspectRatio: strings.TrimSpace(ar),
			ImageSize:   strings.TrimSpace(strings.ToUpper(imageSize)),
		}
	}

	return config
}

func defaultSafetySettings() []geminiSafetySetting {
	return []geminiSafetySetting{
		{Category: "HARM_CATEGORY_HATE_SPEECH", Threshold: "BLOCK_NONE"},
		{Category: "HARM_CATEGORY_DANGEROUS_CONTENT", Threshold: "BLOCK_NONE"},
		{Category: "HARM_CATEGORY_HARASSMENT", Threshold: "BLOCK_NONE"},
		{Category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", Threshold: "BLOCK_NONE"},
	}
}

func (p *GeminiProvider) buildRequestPayload(prompt string, refImgs []interface{}, config *geminiGenerateConfig) (*geminiGenerateRequest, error) {
	parts := make([]geminiPart, 0, len(refImgs)+1)

	for i, ref := range refImgs {
		var imgBytes []byte
		switch v := ref.(type) {
		case string:
			base64Data := v
			if strings.Contains(base64Data, ",") {
				partsSplit := strings.Split(base64Data, ",")
				base64Data = partsSplit[len(partsSplit)-1]
			}
			decoded, err := base64.StdEncoding.DecodeString(base64Data)
			if err != nil {
				return nil, fmt.Errorf("解码第 %d 张参考图失败: %w", i, err)
			}
			imgBytes = decoded
		case []byte:
			imgBytes = v
		default:
			continue
		}
		if len(imgBytes) == 0 {
			continue
		}

		mimeType := http.DetectContentType(imgBytes)
		if !strings.HasPrefix(mimeType, "image/") {
			mimeType = "image/jpeg"
		}

		parts = append(parts, geminiPart{
			InlineData: &geminiBlob{
				MIMEType: mimeType,
				Data:     base64.StdEncoding.EncodeToString(imgBytes),
			},
		})
	}

	parts = append(parts, geminiPart{Text: p.removeMarkdownImages(prompt)})

	return &geminiGenerateRequest{
		Contents: []geminiContent{
			{
				Role:  "user",
				Parts: parts,
			},
		},
		GenerationConfig: config,
		SafetySettings:   defaultSafetySettings(),
	}, nil
}

func (p *GeminiProvider) doGenerateContent(ctx context.Context, modelID string, payload *geminiGenerateRequest, params map[string]interface{}) (*geminiGenerateResponse, http.Header, error) {
	if payload == nil {
		return nil, nil, fmt.Errorf("payload 不能为空")
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, nil, fmt.Errorf("序列化 Gemini 请求失败: %w", err)
	}

	baseURL := strings.TrimRight(strings.TrimSpace(p.config.APIBase), "/")
	if baseURL == "" {
		baseURL = defaultGeminiAPIBase
	}
	requestURL := fmt.Sprintf("%s/v1beta/models/%s:generateContent", baseURL, modelID)
	diagnostic.Logf(params, "request_payload",
		"url=%s body=%q",
		requestURL,
		diagnostic.Preview(string(payloadBytes), 2000),
	)

	maxRetries := providerMaxRetries(p.config)
	var elapsed time.Duration
	resp, _, err := doRequestWithRetry(ctx, params, p.Name(), maxRetries, func(attempt int) (*http.Response, error) {
		req, buildErr := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(payloadBytes))
		if buildErr != nil {
			return nil, fmt.Errorf("构建 Gemini 请求失败: %w", buildErr)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		req.Header.Set("X-Goog-Api-Key", p.config.APIKey)
		req.Header.Set("Connection", "close")

		client := p.newHTTPClient()
		startedAt := time.Now()
		resp, doErr := client.Do(req)
		elapsed = time.Since(startedAt)
		return resp, doErr
	})
	if err != nil {
		return nil, nil, fmt.Errorf("doRequest: error sending request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.Header.Clone(), fmt.Errorf("读取 Gemini 响应失败: %w", err)
	}

	requestID := extractRequestIDFromHeaders(resp.Header)
	diagnostic.Logf(params, "response_headers",
		"status=%s elapsed=%s request_id=%s headers=%q",
		resp.Status,
		elapsed,
		requestID,
		diagnostic.Preview(strings.Join(headerLines(resp.Header), " | "), 1000),
	)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyPreview := diagnostic.Preview(string(body), 1200)
		if requestID == "" {
			requestID = diagnostic.ExtractRequestID(string(body))
		}
		return nil, resp.Header.Clone(), fmt.Errorf("Gemini HTTP %d request_id=%s body=%s", resp.StatusCode, requestID, bodyPreview)
	}

	var parsed geminiGenerateResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, resp.Header.Clone(), fmt.Errorf("解析 Gemini 响应 JSON 失败: %w body=%s", err, diagnostic.Preview(string(body), 1200))
	}
	return &parsed, resp.Header.Clone(), nil
}

// Generate 使用 Gemini API 生成图片。
func (p *GeminiProvider) Generate(ctx context.Context, params map[string]interface{}) (*ProviderResult, error) {
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

	config := p.buildGenerateConfig(params)

	refImgs := make([]interface{}, 0)
	if raw, ok := params["reference_images"].([]interface{}); ok {
		refImgs = raw
	}
	diagnostic.Logf(params, "request_prepare",
		"provider=%s model=%s candidate_count=%d response_modalities=%v aspect_ratio=%q image_size=%q ref_image_count=%d prompt_hash=%s prompt_preview=%q",
		p.Name(),
		modelID,
		config.CandidateCount,
		responseModalities(config),
		func() string {
			if config.ImageConfig == nil {
				return ""
			}
			return config.ImageConfig.AspectRatio
		}(),
		func() string {
			if config.ImageConfig == nil {
				return ""
			}
			return config.ImageConfig.ImageSize
		}(),
		len(refImgs),
		diagnostic.PromptHash(prompt),
		diagnostic.Preview(prompt, 160),
	)

	payload, err := p.buildRequestPayload(prompt, refImgs, config)
	if err != nil {
		return nil, err
	}

	resp, headers, err := p.doGenerateContent(ctx, modelID, payload, params)
	if err != nil {
		return nil, fmt.Errorf("通过 GenerateContent 调用失败: %w", err)
	}

	if len(resp.Candidates) == 0 || resp.Candidates[0].Content == nil {
		return nil, fmt.Errorf("通过 GenerateContent 调用未返回有效内容 (可能是由于安全过滤或配额限制)")
	}

	summary := summarizeGeminiResponse(resp)
	requestID := extractRequestIDFromHeaders(headers)
	diagnostic.Logf(params, "response_summary",
		"mode=%s candidate_count=%v finish_reason=%v part_count=%v text_parts=%v image_parts=%v safety_hits=%v request_id=%s text_preview=%q",
		func() string {
			if len(refImgs) > 0 {
				return "image_to_image"
			}
			return "text_to_image"
		}(),
		summary["candidate_count"],
		summary["finish_reason"],
		summary["part_count"],
		summary["text_parts"],
		summary["image_parts"],
		summary["safety_hits"],
		requestID,
		summary["text_preview"],
	)

	candidate := resp.Candidates[0]
	images := make([][]byte, 0)
	for _, part := range candidate.Content.Parts {
		if part.InlineData == nil || strings.TrimSpace(part.InlineData.Data) == "" {
			continue
		}
		imageBytes, err := base64.StdEncoding.DecodeString(part.InlineData.Data)
		if err != nil {
			return nil, fmt.Errorf("解析响应图片数据失败: %w", err)
		}
		if len(imageBytes) > 0 {
			images = append(images, imageBytes)
		}
	}

	if len(images) == 0 {
		diagnostic.Logf(params, "response_no_image",
			"mode=%s finish_reason=%v part_count=%v request_id=%s text_preview=%q safety_hits=%v",
			func() string {
				if len(refImgs) > 0 {
					return "image_to_image"
				}
				return "text_to_image"
			}(),
			summary["finish_reason"],
			summary["part_count"],
			requestID,
			summary["text_preview"],
			summary["safety_hits"],
		)

		var reason strings.Builder
		reason.WriteString(fmt.Sprintf("未在响应中找到图片数据 (FinishReason: %s)", candidate.FinishReason))
		if requestID != "" {
			reason.WriteString(fmt.Sprintf(" | Request ID: %s", requestID))
		}
		for _, part := range candidate.Content.Parts {
			if strings.TrimSpace(part.Text) != "" {
				reason.WriteString(fmt.Sprintf(" | 文本响应: %s", part.Text))
			}
		}
		for _, rating := range candidate.SafetyRatings {
			if probability := strings.TrimSpace(rating.Probability); probability != "" && probability != "NEGLIGIBLE" {
				reason.WriteString(fmt.Sprintf(" | 安全警告: %s(%s)", rating.Category, probability))
			}
		}
		return nil, errors.New(reason.String())
	}

	metadata := map[string]interface{}{
		"provider":       "gemini",
		"model":          modelID,
		"finish_reason":  candidate.FinishReason,
		"type":           "text-to-image",
		"request_id":     requestID,
		"oneapi_request": strings.TrimSpace(headers.Get("X-Oneapi-Request-Id")),
	}
	if len(refImgs) > 0 {
		metadata["type"] = "image-to-image"
	}

	return &ProviderResult{
		Images:   images,
		Metadata: metadata,
	}, nil
}

// removeMarkdownImages 从提示词中移除 Markdown 图片语法 ![alt](url)，只保留 alt 文字
func (p *GeminiProvider) removeMarkdownImages(text string) string {
	re := regexp.MustCompile(`!\[(.*?)\]\([^\)]+\)`)
	return re.ReplaceAllStringFunc(text, func(match string) string {
		submatch := re.FindStringSubmatch(match)
		if len(submatch) > 1 {
			return strings.TrimSpace(submatch[1])
		}
		return ""
	})
}

func (p *GeminiProvider) ValidateParams(params map[string]interface{}) error {
	prompt, _ := params["prompt"].(string)
	if prompt == "" {
		return fmt.Errorf("prompt 不能为空")
	}

	modelID := ResolveModelID(ModelResolveOptions{
		ProviderName: p.Name(),
		Purpose:      PurposeImage,
		Params:       params,
		Config:       p.config,
	}).ID
	if modelID == "" {
		return fmt.Errorf("缺少 model_id 参数")
	}

	ar, ok := params["aspect_ratio"].(string)
	if !ok {
		ar, _ = params["aspectRatio"].(string)
	}
	if ar != "" {
		validARs := map[string]bool{}
		allowed := supportedAspectRatiosForGeminiModel(modelID)
		for _, ratio := range allowed {
			validARs[ratio] = true
		}
		if !validARs[ar] {
			return fmt.Errorf("模型 %s 不支持的比例: %s，可选值: %s", modelID, ar, strings.Join(allowed, ", "))
		}
	}

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
