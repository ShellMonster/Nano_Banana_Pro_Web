package provider

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image-gen-service/internal/model"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
)

type OpenAIProvider struct {
	config     *model.ProviderConfig
	client     *openai.Client
	httpClient *http.Client
	apiBase    string
	userAgent  string
}

func NewOpenAIProvider(config *model.ProviderConfig) (*OpenAIProvider, error) {
	timeout := time.Duration(config.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 60 * time.Second
	}

	apiBase := NormalizeOpenAIBaseURL(config.APIBase)
	httpClient := &http.Client{Timeout: timeout}
	userAgent := "image-gen-service/1.0"
	opts := []option.RequestOption{
		option.WithAPIKey(config.APIKey),
		option.WithHTTPClient(httpClient),
	}
	if apiBase != "" {
		opts = append(opts, option.WithBaseURL(apiBase))
	}
	if userAgent != "" {
		opts = append(opts, option.WithHeader("User-Agent", userAgent))
	}
	client := openai.NewClient(opts...)

	return &OpenAIProvider{
		config:     config,
		client:     &client,
		httpClient: httpClient,
		apiBase:    apiBase,
		userAgent:  userAgent,
	}, nil
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

	rawMessages, hasMessages := params["messages"]
	reqBody := map[string]interface{}{
		"model": modelID,
	}

	if hasMessages {
		reqBody["messages"] = rawMessages
	} else {
		prompt, _ := params["prompt"].(string)
		if prompt == "" {
			return nil, fmt.Errorf("缺少 prompt 参数")
		}

		prompt = appendPromptHints(prompt, params)

		refParts, err := buildImageParts(params["reference_images"])
		if err != nil {
			return nil, err
		}

		if len(refParts) == 0 {
			reqBody["messages"] = []openai.ChatCompletionMessageParamUnion{
				openai.UserMessage(prompt),
			}
		} else {
			content := append(refParts, openai.TextContentPart(prompt))
			reqBody["messages"] = []openai.ChatCompletionMessageParamUnion{
				openai.UserMessage(content),
			}
		}
	}

	if count, ok := toInt(params["count"]); ok && count > 1 {
		reqBody["n"] = count
	}
	if _, ok := reqBody["modalities"]; !ok {
		reqBody["modalities"] = []string{"text", "image"}
	}
	applyOpenAIOptions(reqBody, params)

	respBytes, err := p.doChatRequest(ctx, reqBody)
	if err != nil {
		return nil, err
	}

	images, err := p.extractImages(ctx, respBytes)
	if err != nil {
		return nil, err
	}

	return &ProviderResult{
		Images: images,
		Metadata: map[string]interface{}{
			"provider": "openai",
			"model":    modelID,
			"type":     "image",
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

func (p *OpenAIProvider) doChatRequest(ctx context.Context, body map[string]interface{}) ([]byte, error) {
	var respBytes []byte
	err := p.client.Post(ctx, "/chat/completions", body, &respBytes)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %s", formatOpenAIClientError(err))
	}
	if len(respBytes) == 0 {
		return nil, fmt.Errorf("接口未返回内容")
	}
	return respBytes, nil
}

func (p *OpenAIProvider) extractImages(ctx context.Context, respBytes []byte) ([][]byte, error) {
	var raw map[string]interface{}
	if err := json.Unmarshal(respBytes, &raw); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	if data, ok := raw["data"].([]interface{}); ok && len(data) > 0 {
		images, err := p.extractImagesFromData(ctx, data)
		if err == nil && len(images) > 0 {
			return images, nil
		}
	}

	choices, ok := raw["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return nil, fmt.Errorf("响应中未找到 choices")
	}

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

	if len(images) == 0 {
		extra := strings.TrimSpace(strings.Join(textSnippets, " | "))
		if extra != "" {
			return nil, fmt.Errorf("未在响应中找到图片数据: %s", extra)
		}
		return nil, fmt.Errorf("未在响应中找到图片数据")
	}

	return images, nil
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
			if err == nil {
				images = append(images, imgBytes)
			}
			continue
		}
		if url, ok := obj["url"].(string); ok && url != "" {
			imgBytes, err := p.fetchImage(ctx, url)
			if err == nil {
				images = append(images, imgBytes)
			}
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
						if err == nil {
							images = append(images, imgBytes)
						}
					}
				}
			}
		}
	case map[string]interface{}:
		if partType, _ := v["type"].(string); partType == "image_url" {
			if imgMap, ok := v["image_url"].(map[string]interface{}); ok {
				if url, _ := imgMap["url"].(string); url != "" {
					imgBytes, err := p.decodeImageURL(ctx, url)
					if err == nil {
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
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("下载图片失败: %s", resp.Status)
	}
	return io.ReadAll(resp.Body)
}

func buildImageParts(raw interface{}) ([]openai.ChatCompletionContentPartUnionParam, error) {
	refImgs, ok := raw.([]interface{})
	if !ok || len(refImgs) == 0 {
		return nil, nil
	}

	var parts []openai.ChatCompletionContentPartUnionParam
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
		parts = append(parts, openai.ImageContentPart(openai.ChatCompletionContentPartImageImageURLParam{
			URL: dataURL,
		}))
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
