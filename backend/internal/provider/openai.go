package provider

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image-gen-service/internal/diagnostic"
	"image-gen-service/internal/model"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type OpenAIProvider struct {
	config     *model.ProviderConfig
	httpClient *http.Client
	apiBase    string
	userAgent  string
}

func NewOpenAIProvider(config *model.ProviderConfig) (*OpenAIProvider, error) {
	if config == nil {
		return nil, fmt.Errorf("config 不能为空")
	}

	timeout := time.Duration(config.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 500 * time.Second
	}

	apiBase := NormalizeOpenAIBaseURL(config.APIBase)
	userAgent := "image-gen-service/1.0"

	return &OpenAIProvider{
		config:     config,
		httpClient: newOpenAIHTTPClient(timeout),
		apiBase:    apiBase,
		userAgent:  userAgent,
	}, nil
}

func newOpenAIHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
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
}

func (p *OpenAIProvider) Name() string {
	return "openai"
}

func (p *OpenAIProvider) Generate(ctx context.Context, params map[string]interface{}) (*ProviderResult, error) {
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
	log.Printf("[OpenAI] Generate 被调用, Params: %+v\n", logParams)

	modelID := ResolveModelID(ModelResolveOptions{
		ProviderName: p.Name(),
		Purpose:      PurposeImage,
		Params:       params,
		Config:       p.config,
	}).ID
	if modelID == "" {
		return nil, fmt.Errorf("缺少 model_id 参数")
	}

	reqBody, refCount, promptPreview, err := p.buildChatRequestBody(modelID, params)
	if err != nil {
		return nil, err
	}

	diagnostic.Logf(params, "request_prepare",
		"provider=%s model=%s count=%v modalities=%v ref_image_count=%d prompt_hash=%s prompt_preview=%q",
		p.Name(),
		modelID,
		reqBody["n"],
		reqBody["modalities"],
		refCount,
		diagnostic.PromptHash(promptPreview),
		diagnostic.Preview(promptPreview, 160),
	)

	respBytes, headers, err := p.doChatRequest(ctx, reqBody, params)
	if err != nil {
		return nil, err
	}

	images, summary, err := p.extractImages(ctx, respBytes)
	if err != nil {
		return nil, err
	}

	requestID := extractRequestIDFromHeaders(headers)
	diagnostic.Logf(params, "response_summary",
		"provider=%s model=%s data_count=%d choice_count=%d image_count=%d text_preview=%q request_id=%s",
		p.Name(),
		modelID,
		summary.DataCount,
		summary.ChoiceCount,
		len(images),
		summary.TextPreview,
		requestID,
	)

	return &ProviderResult{
		Images: images,
		Metadata: map[string]interface{}{
			"provider":       "openai",
			"model":          modelID,
			"type":           "image",
			"request_id":     requestID,
			"oneapi_request": strings.TrimSpace(headers.Get("X-Oneapi-Request-Id")),
		},
	}, nil
}

func (p *OpenAIProvider) ValidateParams(params map[string]interface{}) error {
	if _, ok := params["messages"]; ok {
		return nil
	}
	prompt, _ := params["prompt"].(string)
	if prompt == "" {
		return fmt.Errorf("prompt 不能为空")
	}
	return nil
}

func (p *OpenAIProvider) buildChatRequestBody(modelID string, params map[string]interface{}) (map[string]interface{}, int, string, error) {
	rawMessages, hasMessages := params["messages"]
	reqBody := map[string]interface{}{
		"model": modelID,
	}

	promptPreview := ""
	refCount := 0

	if hasMessages {
		reqBody["messages"] = rawMessages
		promptPreview = "[custom messages]"
	} else {
		prompt, _ := params["prompt"].(string)
		if prompt == "" {
			return nil, 0, "", fmt.Errorf("缺少 prompt 参数")
		}

		prompt = appendPromptHints(prompt, params)
		promptPreview = prompt

		refParts, err := buildImageParts(params["reference_images"])
		if err != nil {
			return nil, 0, "", err
		}
		refCount = len(refParts)

		if len(refParts) == 0 {
			reqBody["messages"] = []map[string]interface{}{
				{
					"role":    "user",
					"content": prompt,
				},
			}
		} else {
			content := make([]map[string]interface{}, 0, len(refParts)+1)
			content = append(content, refParts...)
			content = append(content, map[string]interface{}{
				"type": "text",
				"text": prompt,
			})
			reqBody["messages"] = []map[string]interface{}{
				{
					"role":    "user",
					"content": content,
				},
			}
		}
	}

	if count, ok := toInt(params["count"]); ok && count > 1 {
		reqBody["n"] = count
	} else {
		reqBody["n"] = 1
	}
	if _, ok := reqBody["modalities"]; !ok {
		reqBody["modalities"] = []string{"text", "image"}
	}
	applyOpenAIOptions(reqBody, params)

	return reqBody, refCount, promptPreview, nil
}

func (p *OpenAIProvider) doChatRequest(ctx context.Context, body map[string]interface{}, params map[string]interface{}) ([]byte, http.Header, error) {
	payloadBytes, err := json.Marshal(body)
	if err != nil {
		return nil, nil, fmt.Errorf("序列化 OpenAI 请求失败: %w", err)
	}

	requestURL := strings.TrimRight(strings.TrimSpace(p.apiBase), "/") + "/chat/completions"
	maxRetries := providerMaxRetries(p.config)
	var elapsed time.Duration
	resp, _, err := doRequestWithRetry(ctx, params, p.Name(), maxRetries, func(attempt int) (*http.Response, error) {
		req, buildErr := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(payloadBytes))
		if buildErr != nil {
			return nil, fmt.Errorf("构建 OpenAI 请求失败: %w", buildErr)
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
		return nil, resp.Header.Clone(), fmt.Errorf("读取 OpenAI 响应失败: %w", err)
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

type openAIResponseSummary struct {
	DataCount   int
	ChoiceCount int
	TextPreview string
}

func (p *OpenAIProvider) extractImages(ctx context.Context, respBytes []byte) ([][]byte, openAIResponseSummary, error) {
	var raw map[string]interface{}
	if err := json.Unmarshal(respBytes, &raw); err != nil {
		return nil, openAIResponseSummary{}, fmt.Errorf("解析响应失败: %w", err)
	}

	summary := openAIResponseSummary{}

	if data, ok := raw["data"].([]interface{}); ok && len(data) > 0 {
		summary.DataCount = len(data)
		images, err := p.extractImagesFromData(ctx, data)
		if err == nil && len(images) > 0 {
			return images, summary, nil
		}
	}

	choices, ok := raw["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return nil, summary, fmt.Errorf("响应中未找到 choices")
	}
	summary.ChoiceCount = len(choices)

	var images [][]byte
	var textSnippets []string
	for _, choice := range choices {
		choiceMap, ok := choice.(map[string]interface{})
		if !ok {
			continue
		}
		message, ok := choiceMap["message"].(map[string]interface{})
		if !ok {
			continue
		}
		content := message["content"]
		imgs, texts := p.extractImagesFromContent(ctx, content)
		images = append(images, imgs...)
		textSnippets = append(textSnippets, texts...)
	}
	summary.TextPreview = diagnostic.Preview(strings.TrimSpace(strings.Join(textSnippets, " | ")), 240)

	if len(images) == 0 {
		extra := strings.TrimSpace(strings.Join(textSnippets, " | "))
		if extra != "" {
			return nil, summary, fmt.Errorf("未在响应中找到图片数据: %s", extra)
		}
		return nil, summary, fmt.Errorf("未在响应中找到图片数据")
	}

	return images, summary, nil
}

func (p *OpenAIProvider) extractImagesFromData(ctx context.Context, data []interface{}) ([][]byte, error) {
	var images [][]byte
	for _, item := range data {
		obj, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		if b64, ok := obj["b64_json"].(string); ok && b64 != "" {
			imgBytes, err := base64.StdEncoding.DecodeString(b64)
			if err != nil {
				log.Printf("[OpenAI] base64解码失败，跳过此图: err=%v", err)
				continue
			}
			images = append(images, imgBytes)
			continue
		}
		if url, ok := obj["url"].(string); ok && url != "" {
			imgBytes, err := p.fetchImage(ctx, url)
			if err != nil {
				log.Printf("[OpenAI] 下载图片失败，跳过此图: url=%s, err=%v", url, err)
				continue
			}
			images = append(images, imgBytes)
		}
	}
	return images, nil
}

func (p *OpenAIProvider) extractImagesFromContent(ctx context.Context, content interface{}) ([][]byte, []string) {
	var images [][]byte
	var texts []string

	switch v := content.(type) {
	case string:
		texts = append(texts, v)
		images = append(images, extractImagesFromText(v)...)
	case []interface{}:
		for _, part := range v {
			partMap, ok := part.(map[string]interface{})
			if !ok {
				continue
			}
			if partType, _ := partMap["type"].(string); partType == "text" {
				if text, _ := partMap["text"].(string); text != "" {
					texts = append(texts, text)
				}
			}
			if partType, _ := partMap["type"].(string); partType == "image_url" {
				if imgMap, ok := partMap["image_url"].(map[string]interface{}); ok {
					if url, _ := imgMap["url"].(string); url != "" {
						imgBytes, err := p.decodeImageURL(ctx, url)
						if err != nil {
							log.Printf("[OpenAI] choices路径下载图片失败，跳过此图: url=%s, err=%v", url, err)
							continue
						}
						images = append(images, imgBytes)
					}
				}
			}
		}
	case map[string]interface{}:
		if partType, _ := v["type"].(string); partType == "image_url" {
			if imgMap, ok := v["image_url"].(map[string]interface{}); ok {
				if url, _ := imgMap["url"].(string); url != "" {
					imgBytes, err := p.decodeImageURL(ctx, url)
					if err != nil {
						log.Printf("[OpenAI] choices路径下载图片失败: url=%s, err=%v", url, err)
					} else {
						images = append(images, imgBytes)
					}
				}
			}
		}
		if partType, _ := v["type"].(string); partType == "text" {
			if text, _ := v["text"].(string); text != "" {
				texts = append(texts, text)
			}
		}
	}

	return images, texts
}

func (p *OpenAIProvider) decodeImageURL(ctx context.Context, url string) ([]byte, error) {
	if strings.HasPrefix(url, "data:image/") {
		return decodeDataURL(url)
	}
	return p.fetchImage(ctx, url)
}

func (p *OpenAIProvider) fetchImage(ctx context.Context, url string) ([]byte, error) {
	const maxRetries = 3
	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		resp, err := p.httpClient.Do(req)
		if err != nil {
			lastErr = err
			log.Printf("[OpenAI] fetchImage 第%d次尝试失败, url=%s, err=%v", attempt, url, err)
			if attempt < maxRetries {
				time.Sleep(time.Second)
			}
			continue
		}
		defer resp.Body.Close()
		if resp.StatusCode == 429 || resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("下载图片失败: %s", resp.Status)
			log.Printf("[OpenAI] fetchImage 第%d次尝试失败, url=%s, status=%s", attempt, url, resp.Status)
			if attempt < maxRetries {
				time.Sleep(time.Second)
			}
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("下载图片失败: %s", resp.Status)
		}
		return io.ReadAll(resp.Body)
	}
	return nil, fmt.Errorf("下载图片失败（重试%d次）: %w", maxRetries, lastErr)
}

func buildImageParts(raw interface{}) ([]map[string]interface{}, error) {
	refImgs, ok := raw.([]interface{})
	if !ok || len(refImgs) == 0 {
		return nil, nil
	}

	var parts []map[string]interface{}
	for idx, ref := range refImgs {
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
				return nil, fmt.Errorf("解码第 %d 张参考图失败: %w", idx, err)
			}
			imgBytes = decoded
		case []byte:
			imgBytes = v
		default:
			continue
		}

		mimeType := http.DetectContentType(imgBytes)
		if !strings.HasPrefix(mimeType, "image/") {
			mimeType = "image/png"
		}
		dataURL := fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(imgBytes))
		parts = append(parts, map[string]interface{}{
			"type": "image_url",
			"image_url": map[string]interface{}{
				"url": dataURL,
			},
		})
	}
	return parts, nil
}

func appendPromptHints(prompt string, params map[string]interface{}) string {
	ar, _ := params["aspect_ratio"].(string)
	if ar == "" {
		ar, _ = params["aspectRatio"].(string)
	}
	size, _ := params["resolution_level"].(string)
	if size == "" {
		size, _ = params["imageSize"].(string)
	}
	if size == "" {
		size, _ = params["image_size"].(string)
	}

	if ar == "" && size == "" {
		return prompt
	}

	var hintParts []string
	if ar != "" {
		hintParts = append(hintParts, "画面比例: "+ar)
	}
	if size != "" {
		hintParts = append(hintParts, "分辨率: "+strings.ToUpper(strings.TrimSpace(size)))
	}

	return fmt.Sprintf("%s\n\n%s", prompt, strings.Join(hintParts, "，"))
}

func applyOpenAIOptions(body map[string]interface{}, params map[string]interface{}) {
	keys := []string{
		"temperature",
		"top_p",
		"max_tokens",
		"presence_penalty",
		"frequency_penalty",
		"response_format",
		"modalities",
		"stream",
		"stop",
		"user",
		"tools",
		"tool_choice",
	}
	for _, key := range keys {
		if val, ok := params[key]; ok {
			body[key] = val
		}
	}
}

func NormalizeOpenAIBaseURL(apiBase string) string {
	base := strings.TrimSpace(apiBase)
	if base == "" {
		return "https://api.openai.com/v1"
	}

	base = strings.TrimRight(base, "/")
	if strings.Contains(base, "/chat/completions") {
		base = strings.Split(base, "/chat/completions")[0]
		base = strings.TrimRight(base, "/")
	}
	if strings.Contains(base, "/v1/") {
		base = strings.Split(base, "/v1/")[0] + "/v1"
		return base
	}
	if strings.HasSuffix(base, "/v1") {
		return base
	}
	return base + "/v1"
}

func parseOpenAIError(resp []byte) string {
	var payload map[string]interface{}
	if err := json.Unmarshal(resp, &payload); err != nil {
		return string(resp)
	}
	if errObj, ok := payload["error"].(map[string]interface{}); ok {
		if msg, ok := errObj["message"].(string); ok && msg != "" {
			return msg
		}
	}
	if msg, ok := payload["message"].(string); ok && msg != "" {
		return msg
	}
	return string(resp)
}

func decodeDataURL(dataURL string) ([]byte, error) {
	parts := strings.SplitN(dataURL, ",", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("无效的 data URL")
	}
	return base64.StdEncoding.DecodeString(parts[1])
}

func extractImagesFromText(text string) [][]byte {
	re := regexp.MustCompile(`data:image/[^;]+;base64,[A-Za-z0-9+/=]+`)
	matches := re.FindAllString(text, -1)
	var images [][]byte
	for _, match := range matches {
		img, err := decodeDataURL(match)
		if err == nil {
			images = append(images, img)
		}
	}
	return images
}

func toInt(v interface{}) (int, bool) {
	switch value := v.(type) {
	case int:
		return value, true
	case int32:
		return int(value), true
	case int64:
		return int(value), true
	case float64:
		return int(value), true
	case float32:
		return int(value), true
	default:
		return 0, false
	}
}
