package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image-gen-service/internal/diagnostic"
	"image-gen-service/internal/model"
	"io"
	"net/http"
	"strings"
	"time"
)

type OpenAIImageProvider struct {
	*OpenAIProvider
}

type openAIImagesGenerationRequest struct {
	Model   string `json:"model"`
	Prompt  string `json:"prompt"`
	Size    string `json:"size"`
	Quality string `json:"quality,omitempty"`
	N       int    `json:"n,omitempty"`
}

func NewOpenAIImageProvider(config *model.ProviderConfig) (*OpenAIImageProvider, error) {
	base, err := NewOpenAIProvider(config)
	if err != nil {
		return nil, err
	}
	return &OpenAIImageProvider{OpenAIProvider: base}, nil
}

func (p *OpenAIImageProvider) Name() string {
	return "openai-image"
}

func (p *OpenAIImageProvider) ValidateParams(params map[string]interface{}) error {
	prompt, _ := params["prompt"].(string)
	if strings.TrimSpace(prompt) == "" {
		return fmt.Errorf("prompt 不能为空")
	}
	if raw, ok := params["reference_images"].([]interface{}); ok && len(raw) > 0 {
		return fmt.Errorf("OpenAI Images 当前仅支持文本生图")
	}

	count, ok := toInt(params["count"])
	if !ok {
		count = 1
	}
	if count < 1 || count > 10 {
		return fmt.Errorf("count/n 必须介于 1 和 10 之间")
	}

	size, _ := params["size"].(string)
	switch strings.TrimSpace(strings.ToLower(size)) {
	case "", "auto", "1024x1024", "1024x1536", "1536x1024":
	default:
		return fmt.Errorf("size 仅支持 auto、1024x1024、1024x1536、1536x1024")
	}

	return nil
}

func (p *OpenAIImageProvider) Generate(ctx context.Context, params map[string]interface{}) (*ProviderResult, error) {
	modelID := ResolveModelID(ModelResolveOptions{
		ProviderName: p.Name(),
		Purpose:      PurposeImage,
		Params:       params,
		Config:       p.config,
	}).ID
	if modelID == "" {
		return nil, fmt.Errorf("缺少 model_id 参数")
	}

	reqBody, promptPreview, err := p.buildImagesGenerationRequestBody(modelID, params)
	if err != nil {
		return nil, err
	}

	diagnostic.Logf(params, "request_prepare",
		"provider=%s model=%s size=%q quality=%q count=%d prompt_hash=%s prompt_preview=%q",
		p.Name(),
		modelID,
		reqBody.Size,
		reqBody.Quality,
		reqBody.N,
		diagnostic.PromptHash(promptPreview),
		diagnostic.Preview(promptPreview, 160),
	)

	respBytes, headers, err := p.doImagesGenerationRequest(ctx, reqBody, params)
	if err != nil {
		return nil, err
	}

	images, summary, err := p.extractImages(ctx, respBytes)
	if err != nil {
		return nil, err
	}

	requestID := extractRequestIDFromHeaders(headers)
	diagnostic.Logf(params, "response_summary",
		"provider=%s model=%s data_count=%d choice_count=%d image_count=%d request_id=%s",
		p.Name(),
		modelID,
		summary.DataCount,
		summary.ChoiceCount,
		len(images),
		requestID,
	)

	return &ProviderResult{
		Images: images,
		Metadata: map[string]interface{}{
			"provider":       p.Name(),
			"model":          modelID,
			"type":           "image",
			"request_id":     requestID,
			"oneapi_request": strings.TrimSpace(headers.Get("X-Oneapi-Request-Id")),
		},
	}, nil
}

func (p *OpenAIImageProvider) buildImagesGenerationRequestBody(modelID string, params map[string]interface{}) (*openAIImagesGenerationRequest, string, error) {
	prompt, _ := params["prompt"].(string)
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return nil, "", fmt.Errorf("缺少 prompt 参数")
	}

	body := &openAIImagesGenerationRequest{
		Model:  modelID,
		Prompt: prompt,
		Size:   "auto",
		N:      1,
	}
	if size, _ := params["size"].(string); strings.TrimSpace(size) != "" {
		body.Size = strings.TrimSpace(strings.ToLower(size))
	}
	if count, ok := toInt(params["count"]); ok && count >= 1 && count <= 10 {
		body.N = count
	}

	return body, prompt, nil
}

func (p *OpenAIImageProvider) doImagesGenerationRequest(ctx context.Context, body *openAIImagesGenerationRequest, params map[string]interface{}) ([]byte, http.Header, error) {
	payloadBytes, err := json.Marshal(body)
	if err != nil {
		return nil, nil, fmt.Errorf("序列化 OpenAI Images 请求失败: %w", err)
	}

	requestURL := strings.TrimRight(strings.TrimSpace(p.apiBase), "/") + "/images/generations"
	diagnostic.Logf(params, "request_payload",
		"url=%s body=%q",
		diagnostic.RedactSensitive(requestURL),
		diagnostic.RedactSensitive(string(payloadBytes)),
	)

	maxRetries := providerMaxRetries(p.config)
	var elapsed time.Duration
	resp, _, err := doRequestWithRetry(ctx, params, p.Name(), maxRetries, func(attempt int) (*http.Response, error) {
		req, buildErr := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(payloadBytes))
		if buildErr != nil {
			return nil, fmt.Errorf("构建 OpenAI Images 请求失败: %w", buildErr)
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(p.config.APIKey))
		req.Header.Set("Connection", "close")
		if strings.TrimSpace(p.userAgent) != "" {
			req.Header.Set("User-Agent", p.userAgent)
		}

		startedAt := time.Now()
		resp, doErr := p.httpClient.Do(req)
		elapsed = time.Since(startedAt)
		return resp, doErr
	})
	if err != nil {
		return nil, nil, fmt.Errorf("doRequest: error sending request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.Header.Clone(), fmt.Errorf("读取 OpenAI Images 响应失败: %w", err)
	}

	requestID := extractRequestIDFromHeaders(resp.Header)
	diagnostic.Logf(params, "response_headers",
		"status=%s elapsed=%s request_id=%s headers=%q",
		resp.Status,
		elapsed,
		requestID,
		diagnostic.Preview(strings.Join(headerLines(resp.Header), " | "), 1000),
	)
	diagnostic.Logf(params, "response_body",
		"status=%s elapsed=%s request_id=%s body=%q",
		resp.Status,
		elapsed,
		requestID,
		diagnostic.RedactSensitive(string(respBody)),
	)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyPreview := diagnostic.Preview(parseOpenAIError(respBody), 1200)
		if requestID == "" {
			requestID = diagnostic.ExtractRequestID(string(respBody))
		}
		return nil, resp.Header.Clone(), fmt.Errorf("OpenAI HTTP %d request_id=%s body=%s", resp.StatusCode, requestID, bodyPreview)
	}

	if len(respBody) == 0 {
		return nil, resp.Header.Clone(), fmt.Errorf("接口未返回内容")
	}

	return respBody, resp.Header.Clone(), nil
}
