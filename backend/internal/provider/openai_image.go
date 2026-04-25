package provider

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image-gen-service/internal/diagnostic"
	"image-gen-service/internal/model"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type OpenAIImageProvider struct {
	*OpenAIProvider
}

type openAIImagesGenerationRequest struct {
	Model         string `json:"model"`
	Prompt        string `json:"prompt"`
	Size          string `json:"size"`
	Quality       string `json:"quality,omitempty"`
	N             int    `json:"n,omitempty"`
	InputFidelity string `json:"input_fidelity,omitempty"`
	Background    string `json:"background,omitempty"`
	OutputFormat  string `json:"output_format,omitempty"`
	Moderation    string `json:"moderation,omitempty"`
}

type openAIImageReference struct {
	Name    string
	Content []byte
	MIME    string
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

	count, ok := toInt(params["count"])
	if !ok {
		count = 1
	}
	if count < 1 || count > 10 {
		return fmt.Errorf("count/n 必须介于 1 和 10 之间")
	}

	size, _ := params["size"].(string)
	if !isValidOpenAIImageSize(size) {
		return fmt.Errorf("size 仅支持 auto 或 宽x高 格式")
	}

	quality, _ := params["quality"].(string)
	switch strings.TrimSpace(strings.ToLower(quality)) {
	case "", "auto", "low", "medium", "high":
	default:
		return fmt.Errorf("quality 仅支持 auto、low、medium、high")
	}

	inputFidelity, _ := params["input_fidelity"].(string)
	switch strings.TrimSpace(strings.ToLower(inputFidelity)) {
	case "", "low", "high":
	default:
		return fmt.Errorf("input_fidelity 仅支持 low、high")
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
	refImages, err := collectOpenAIImageReferences(params["reference_images"])
	if err != nil {
		return nil, err
	}

	diagnostic.Logf(params, "request_prepare",
		"provider=%s model=%s size=%q quality=%q count=%d ref_image_count=%d prompt_hash=%s prompt_preview=%q",
		p.Name(),
		modelID,
		reqBody.Size,
		reqBody.Quality,
		reqBody.N,
		len(refImages),
		diagnostic.PromptHash(promptPreview),
		diagnostic.Preview(promptPreview, 160),
	)

	var respBytes []byte
	var headers http.Header
	if len(refImages) > 0 {
		respBytes, headers, err = p.doImagesEditRequest(ctx, reqBody, refImages, params)
		if err != nil {
			return nil, err
		}
	} else {
		respBytes, headers, err = p.doImagesGenerationRequest(ctx, reqBody, params)
		if err != nil {
			return nil, err
		}
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
		Size:   resolveOpenAIImageSize(modelID, params),
		N:      1,
	}
	if quality, _ := params["quality"].(string); strings.TrimSpace(quality) != "" {
		body.Quality = strings.TrimSpace(strings.ToLower(quality))
	}
	if inputFidelity, _ := params["input_fidelity"].(string); strings.TrimSpace(inputFidelity) != "" {
		body.InputFidelity = strings.TrimSpace(strings.ToLower(inputFidelity))
	}
	if background, _ := params["background"].(string); strings.TrimSpace(background) != "" {
		body.Background = strings.TrimSpace(strings.ToLower(background))
	}
	if outputFormat, _ := params["output_format"].(string); strings.TrimSpace(outputFormat) != "" {
		body.OutputFormat = strings.TrimSpace(strings.ToLower(outputFormat))
	}
	if moderation, _ := params["moderation"].(string); strings.TrimSpace(moderation) != "" {
		body.Moderation = strings.TrimSpace(strings.ToLower(moderation))
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

func (p *OpenAIImageProvider) doImagesEditRequest(ctx context.Context, body *openAIImagesGenerationRequest, refs []openAIImageReference, params map[string]interface{}) ([]byte, http.Header, error) {
	var payload bytes.Buffer
	writer := multipart.NewWriter(&payload)

	fields := map[string]string{
		"model":  body.Model,
		"prompt": body.Prompt,
		"size":   body.Size,
		"n":      strconv.Itoa(body.N),
	}
	if body.Quality != "" {
		fields["quality"] = body.Quality
	}
	if body.InputFidelity != "" {
		fields["input_fidelity"] = body.InputFidelity
	}
	if body.Background != "" {
		fields["background"] = body.Background
	}
	if body.OutputFormat != "" {
		fields["output_format"] = body.OutputFormat
	}
	if body.Moderation != "" {
		fields["moderation"] = body.Moderation
	}
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			return nil, nil, fmt.Errorf("构建 OpenAI Images Edit 字段失败: %w", err)
		}
	}

	for _, ref := range refs {
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="image"; filename="%s"`, escapeMultipartFilename(ref.Name)))
		header.Set("Content-Type", ref.MIME)
		part, err := writer.CreatePart(header)
		if err != nil {
			return nil, nil, fmt.Errorf("构建 OpenAI Images Edit 图片字段失败: %w", err)
		}
		if _, err := part.Write(ref.Content); err != nil {
			return nil, nil, fmt.Errorf("写入 OpenAI Images Edit 图片字段失败: %w", err)
		}
	}

	if err := writer.Close(); err != nil {
		return nil, nil, fmt.Errorf("结束 OpenAI Images Edit multipart 失败: %w", err)
	}

	requestURL := strings.TrimRight(strings.TrimSpace(p.apiBase), "/") + "/images/edits"
	diagnostic.Logf(params, "request_payload",
		"url=%s content_type=%q fields=%d image_count=%d body_bytes=%d",
		diagnostic.RedactSensitive(requestURL),
		writer.FormDataContentType(),
		len(fields),
		len(refs),
		payload.Len(),
	)

	maxRetries := providerMaxRetries(p.config)
	var elapsed time.Duration
	resp, _, err := doRequestWithRetry(ctx, params, p.Name(), maxRetries, func(attempt int) (*http.Response, error) {
		req, buildErr := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(payload.Bytes()))
		if buildErr != nil {
			return nil, fmt.Errorf("构建 OpenAI Images Edit 请求失败: %w", buildErr)
		}

		req.Header.Set("Content-Type", writer.FormDataContentType())
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
		return nil, resp.Header.Clone(), fmt.Errorf("读取 OpenAI Images Edit 响应失败: %w", err)
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

func collectOpenAIImageReferences(raw interface{}) ([]openAIImageReference, error) {
	refImgs, ok := raw.([]interface{})
	if !ok || len(refImgs) == 0 {
		return nil, nil
	}

	refs := make([]openAIImageReference, 0, len(refImgs))
	for idx, ref := range refImgs {
		var imgBytes []byte
		switch v := ref.(type) {
		case string:
			base64Data := v
			if strings.Contains(base64Data, ",") {
				base64Data = strings.SplitN(base64Data, ",", 2)[1]
			}
			decoded, err := base64.StdEncoding.DecodeString(base64Data)
			if err != nil {
				return nil, fmt.Errorf("解码第 %d 张参考图失败: %w", idx+1, err)
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
			return nil, fmt.Errorf("第 %d 张参考图不是有效图片", idx+1)
		}
		refs = append(refs, openAIImageReference{
			Name:    fmt.Sprintf("reference-%d%s", idx+1, imageExtForMIME(mimeType)),
			Content: imgBytes,
			MIME:    mimeType,
		})
	}

	return refs, nil
}

func imageExtForMIME(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ".png"
	}
}

func escapeMultipartFilename(name string) string {
	return strings.NewReplacer("\\", "\\\\", `"`, "\\\"").Replace(name)
}

func isValidOpenAIImageSize(size string) bool {
	size = strings.TrimSpace(strings.ToLower(size))
	if size == "" || size == "auto" {
		return true
	}
	return regexp.MustCompile(`^[1-9][0-9]{1,4}x[1-9][0-9]{1,4}$`).MatchString(size)
}

func resolveOpenAIImageSize(modelID string, params map[string]interface{}) string {
	if size, _ := params["size"].(string); strings.TrimSpace(size) != "" {
		return strings.TrimSpace(strings.ToLower(size))
	}

	aspectRatio := firstStringParam(params, "aspect_ratio", "aspectRatio", "aspect")
	resolution := firstStringParam(params, "resolution_level", "imageSize", "image_size", "resolution")
	model := strings.ToLower(strings.TrimSpace(modelID))

	if strings.Contains(model, "dall-e-3") {
		return resolveDalle3Size(aspectRatio)
	}
	if strings.Contains(model, "dall-e-2") {
		return "1024x1024"
	}
	if strings.Contains(model, "gpt-image-2") {
		return computeDynamicOpenAIImageSize(aspectRatio, resolution)
	}
	return resolveStandardGPTImageSize(aspectRatio)
}

func firstStringParam(params map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if val, ok := params[key].(string); ok && strings.TrimSpace(val) != "" {
			return strings.TrimSpace(val)
		}
	}
	return ""
}

func resolveDalle3Size(aspectRatio string) string {
	w, h, ok := parseAspectRatio(aspectRatio)
	if !ok {
		return "1024x1024"
	}
	if w == h {
		return "1024x1024"
	}
	if w > h {
		return "1792x1024"
	}
	return "1024x1792"
}

func resolveStandardGPTImageSize(aspectRatio string) string {
	w, h, ok := parseAspectRatio(aspectRatio)
	if !ok {
		return "auto"
	}
	if w == h {
		return "1024x1024"
	}
	if w > h {
		return "1536x1024"
	}
	return "1024x1536"
}

func computeDynamicOpenAIImageSize(aspectRatio, resolution string) string {
	wRatio, hRatio, ok := parseAspectRatio(aspectRatio)
	if !ok {
		return "auto"
	}

	longEdge := 2048
	switch strings.ToUpper(strings.TrimSpace(resolution)) {
	case "1K":
		longEdge = 1280
	case "2K", "":
		longEdge = 2048
	case "4K":
		longEdge = 3840
	}

	width := longEdge
	height := int(float64(width) * float64(hRatio) / float64(wRatio))
	if hRatio > wRatio {
		height = longEdge
		width = int(float64(height) * float64(wRatio) / float64(hRatio))
	}

	width = roundDownToMultiple(width, 16)
	height = roundDownToMultiple(height, 16)

	const maxPixels = 8294400
	if width*height > maxPixels {
		scale := math.Sqrt(float64(maxPixels) / float64(width*height))
		width = roundDownToMultiple(int(float64(width)*scale), 16)
		height = roundDownToMultiple(int(float64(height)*scale), 16)
	}

	if width < 16 || height < 16 {
		return "auto"
	}
	return fmt.Sprintf("%dx%d", width, height)
}

func parseAspectRatio(value string) (int, int, bool) {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 2 {
		return 0, 0, false
	}
	w, errW := strconv.Atoi(strings.TrimSpace(parts[0]))
	h, errH := strconv.Atoi(strings.TrimSpace(parts[1]))
	if errW != nil || errH != nil || w <= 0 || h <= 0 {
		return 0, 0, false
	}
	return w, h, true
}

func roundDownToMultiple(value, multiple int) int {
	if multiple <= 0 {
		return value
	}
	rounded := (value / multiple) * multiple
	if rounded < multiple {
		return multiple
	}
	return rounded
}
