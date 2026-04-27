package provider

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image-gen-service/internal/diagnostic"
	"image-gen-service/internal/model"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"regexp"
	"strconv"
	"strings"
	"time"

	_ "golang.org/x/image/webp"
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

	refImages, err := collectOpenAIImageReferences(params["reference_images"])
	if err != nil {
		return nil, err
	}
	reqBody, promptPreview, err := p.buildImagesGenerationRequestBody(modelID, params, refImages)
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

func (p *OpenAIImageProvider) buildImagesGenerationRequestBody(modelID string, params map[string]interface{}, refs []openAIImageReference) (*openAIImagesGenerationRequest, string, error) {
	prompt, _ := params["prompt"].(string)
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return nil, "", fmt.Errorf("缺少 prompt 参数")
	}

	body := &openAIImagesGenerationRequest{
		Model:  modelID,
		Prompt: prompt,
		Size:   resolveOpenAIImageSize(modelID, params, refs),
		N:      1,
	}
	if quality, _ := params["quality"].(string); strings.TrimSpace(quality) != "" {
		body.Quality = strings.TrimSpace(strings.ToLower(quality))
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
	bodySummary := diagnostic.ResponseBodySummary(respBody, 1200)
	diagnostic.Logf(params, "response_body",
		"status=%s elapsed=%s request_id=%s body_length=%d body_preview=%q",
		resp.Status,
		elapsed,
		requestID,
		bodySummary.Length,
		bodySummary.Preview,
	)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyPreview := openAIErrorBodyPreview(respBody, 1200)
		if requestID == "" {
			requestID = diagnostic.ExtractRequestID(string(respBody))
		}
		return nil, resp.Header.Clone(), fmt.Errorf("OpenAI HTTP %d request_id=%s %s", resp.StatusCode, requestID, bodyPreview)
	}

	if len(respBody) == 0 {
		return nil, resp.Header.Clone(), fmt.Errorf("接口未返回内容")
	}

	return respBody, resp.Header.Clone(), nil
}

func (p *OpenAIImageProvider) doImagesEditRequest(ctx context.Context, body *openAIImagesGenerationRequest, refs []openAIImageReference, params map[string]interface{}) ([]byte, http.Header, error) {
	requestURL := strings.TrimRight(strings.TrimSpace(p.apiBase), "/") + "/images/edits"
	fields := openAIImageEditFields(body)
	imageFieldCount := len(refs)
	if imageFieldCount > 2 {
		imageFieldCount = 2
	}
	diagnostic.Logf(params, "request_payload",
		"url=%s fields=%d image_count=%d",
		diagnostic.RedactSensitive(requestURL),
		len(fields),
		imageFieldCount,
	)

	maxRetries := providerMaxRetries(p.config)
	var elapsed time.Duration
	resp, _, err := doRequestWithRetry(ctx, params, p.Name(), maxRetries, func(attempt int) (*http.Response, error) {
		reader, contentType := openAIImageEditBody(fields, refs)
		req, buildErr := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, reader)
		if buildErr != nil {
			return nil, fmt.Errorf("构建 OpenAI Images Edit 请求失败: %w", buildErr)
		}

		req.Header.Set("Content-Type", contentType)
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(p.config.APIKey))
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
	bodySummary := diagnostic.ResponseBodySummary(respBody, 1200)
	diagnostic.Logf(params, "response_body",
		"status=%s elapsed=%s request_id=%s body_length=%d body_preview=%q",
		resp.Status,
		elapsed,
		requestID,
		bodySummary.Length,
		bodySummary.Preview,
	)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyPreview := openAIErrorBodyPreview(respBody, 1200)
		if requestID == "" {
			requestID = diagnostic.ExtractRequestID(string(respBody))
		}
		return nil, resp.Header.Clone(), fmt.Errorf("OpenAI HTTP %d request_id=%s %s", resp.StatusCode, requestID, bodyPreview)
	}

	if len(respBody) == 0 {
		return nil, resp.Header.Clone(), fmt.Errorf("接口未返回内容")
	}

	return respBody, resp.Header.Clone(), nil
}

func openAIImageEditFields(body *openAIImagesGenerationRequest) map[string]string {
	fields := map[string]string{
		"model":  body.Model,
		"prompt": body.Prompt,
		"size":   body.Size,
		"n":      strconv.Itoa(body.N),
	}
	// Edits 只发送官方通用字段，避免代理或官方接口因未知字段返回 400。
	if body.Quality != "" {
		fields["quality"] = body.Quality
	}
	return fields
}

func openAIImageEditBody(fields map[string]string, refs []openAIImageReference) (io.Reader, string) {
	reader, writer := io.Pipe()
	multipartWriter := multipart.NewWriter(writer)
	contentType := multipartWriter.FormDataContentType()

	go func() {
		err := writeOpenAIImageEditMultipart(multipartWriter, fields, refs)
		if closeErr := multipartWriter.Close(); err == nil {
			err = closeErr
		}
		_ = writer.CloseWithError(err)
	}()

	return reader, contentType
}

func writeOpenAIImageEditMultipart(writer *multipart.Writer, fields map[string]string, refs []openAIImageReference) error {
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			return fmt.Errorf("构建 OpenAI Images Edit 字段失败: %w", err)
		}
	}

	for idx, ref := range refs {
		fieldName := "image"
		if idx == 1 {
			fieldName = "mask"
		} else if idx > 1 {
			break
		}

		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, fieldName, escapeMultipartFilename(ref.Name)))
		header.Set("Content-Type", ref.MIME)
		part, err := writer.CreatePart(header)
		if err != nil {
			return fmt.Errorf("构建 OpenAI Images Edit 图片字段失败: %w", err)
		}
		if _, err := part.Write(ref.Content); err != nil {
			return fmt.Errorf("写入 OpenAI Images Edit 图片字段失败: %w", err)
		}
	}

	return nil
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
		pngBytes, err := normalizeOpenAIReferenceImagePNG(imgBytes)
		if err != nil {
			return nil, fmt.Errorf("第 %d 张参考图不是有效图片: %w", idx+1, err)
		}
		refs = append(refs, openAIImageReference{
			Name:    fmt.Sprintf("reference-%d.png", idx+1),
			Content: pngBytes,
			MIME:    "image/png",
		})
	}

	return refs, nil
}

func normalizeOpenAIReferenceImagePNG(imgBytes []byte) ([]byte, error) {
	if http.DetectContentType(imgBytes) == "image/png" {
		return imgBytes, nil
	}
	img, _, err := image.Decode(bytes.NewReader(imgBytes))
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
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

func resolveOpenAIImageSize(modelID string, params map[string]interface{}, refs ...[]openAIImageReference) string {
	aspectRatio := firstStringParam(params, "aspect_ratio", "aspectRatio", "aspect")
	resolution := firstStringParam(params, "resolution_level", "imageSize", "image_size", "resolution")
	refImages := firstOpenAIImageReferenceSlice(refs)
	model := strings.ToLower(strings.TrimSpace(modelID))
	if size, _ := params["size"].(string); strings.TrimSpace(size) != "" {
		return normalizeExplicitOpenAIImageSize(model, strings.TrimSpace(strings.ToLower(size)), aspectRatio, resolution, refImages)
	}

	if strings.Contains(model, "dall-e-3") {
		return resolveDalle3Size(aspectRatio)
	}
	if strings.Contains(model, "dall-e-2") {
		return "1024x1024"
	}
	if strings.Contains(model, "gpt-image-2") {
		if isAutoAspectRatio(aspectRatio) {
			return computeDynamicOpenAIImageSizeFromReference(refImages, resolution)
		}
		return computeDynamicOpenAIImageSize(aspectRatio, resolution)
	}
	return resolveStandardGPTImageSize(aspectRatio)
}

func normalizeExplicitOpenAIImageSize(model, size, aspectRatio, resolution string, refs []openAIImageReference) string {
	if strings.Contains(model, "dall-e-3") {
		switch size {
		case "1024x1024", "1792x1024", "1024x1792":
			return size
		default:
			return resolveDalle3Size(aspectRatio)
		}
	}

	if strings.Contains(model, "dall-e-2") {
		switch size {
		case "256x256", "512x512", "1024x1024":
			return size
		default:
			return "1024x1024"
		}
	}

	if strings.Contains(model, "gpt-image-2") {
		if size == "auto" {
			if isAutoAspectRatio(aspectRatio) {
				return computeDynamicOpenAIImageSizeFromReference(refs, resolution)
			}
			return computeDynamicOpenAIImageSize(aspectRatio, resolution)
		}
		return size
	}

	switch size {
	case "1024x1024", "1536x1024", "1024x1536":
		return size
	default:
		return resolveStandardGPTImageSize(aspectRatio)
	}
}

func firstOpenAIImageReferenceSlice(refs [][]openAIImageReference) []openAIImageReference {
	if len(refs) == 0 {
		return nil
	}
	return refs[0]
}

func isAutoAspectRatio(aspectRatio string) bool {
	return strings.EqualFold(strings.TrimSpace(aspectRatio), "auto")
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

// 根据用户选择的宽高比和分辨率档位，为 gpt-image-2 代理计算实际 WxH。
// 计算流程：先确定长边，再按宽高比推导短边，最后做 16 像素对齐和总像素上限保护。
func computeDynamicOpenAIImageSize(aspectRatio, resolution string) string {
	if isAutoAspectRatio(aspectRatio) {
		return "auto"
	}

	wRatio, hRatio, ok := parseAspectRatio(aspectRatio)
	if !ok {
		return "auto"
	}
	return computeDynamicOpenAIImageSizeFromRatio(wRatio, hRatio, resolution)
}

func computeDynamicOpenAIImageSizeFromReference(refs []openAIImageReference, resolution string) string {
	if len(refs) == 0 || len(refs[0].Content) == 0 {
		return "auto"
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(refs[0].Content))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
		return "auto"
	}
	return computeDynamicOpenAIImageSizeFromRatio(cfg.Width, cfg.Height, resolution)
}

func computeDynamicOpenAIImageSizeFromRatio(wRatio, hRatio int, resolution string) string {
	// gpt-image-2 代理支持更灵活的 WxH。这里用用户选择的分辨率作为长边，
	// 再按比例计算短边，并统一向下取 16 的倍数，避免上游拒绝非对齐尺寸。
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

	// 按 banana-slides 的经验保留官方/代理常见的像素上限保护：
	// 超过约 8.29MP 时等比缩小，再次对齐到 16 的倍数。
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
