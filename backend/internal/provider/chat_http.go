package provider

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image-gen-service/internal/model"
	"net/http"
	"strings"
	"time"
)

const defaultChatTimeout = 150 * time.Second

func chatTimeout(cfg *model.ProviderConfig) time.Duration {
	if cfg == nil {
		return defaultChatTimeout
	}
	timeout := time.Duration(cfg.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		return defaultChatTimeout
	}
	return timeout
}

func OpenAIOptimizeText(ctx context.Context, cfg *model.ProviderConfig, modelName, systemPrompt, prompt string, forceJSON bool) (string, error) {
	return openAIChatText(ctx, cfg, modelName, systemPrompt, prompt, forceJSON)
}

func OpenAIImageToPrompt(ctx context.Context, cfg *model.ProviderConfig, modelName string, imageData []byte, systemPrompt string) (string, error) {
	mimeType := http.DetectContentType(imageData)
	if !strings.HasPrefix(mimeType, "image/") {
		mimeType = "image/jpeg"
	}
	dataURL := fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(imageData))
	userContent := []map[string]interface{}{
		{
			"type": "image_url",
			"image_url": map[string]interface{}{
				"url": dataURL,
			},
		},
		{
			"type": "text",
			"text": "请分析这张图片并生成提示词描述。",
		},
	}
	return openAIChatText(ctx, cfg, modelName, systemPrompt, userContent, false)
}

func openAIChatText(ctx context.Context, cfg *model.ProviderConfig, modelName, systemPrompt string, userContent interface{}, forceJSON bool) (string, error) {
	providerClient, err := NewOpenAIProvider(cfg)
	if err != nil {
		return "", err
	}

	requestCtx, cancel := context.WithTimeout(ctx, chatTimeout(cfg))
	defer cancel()

	payload := map[string]interface{}{
		"model": strings.TrimSpace(modelName),
		"messages": []map[string]interface{}{
			{
				"role":    "system",
				"content": systemPrompt,
			},
			{
				"role":    "user",
				"content": userContent,
			},
		},
	}
	if forceJSON {
		payload["response_format"] = map[string]interface{}{"type": "json_object"}
	}

	respBytes, _, err := providerClient.doChatRequest(requestCtx, payload, nil)
	if err != nil {
		return "", err
	}

	text, err := extractOpenAIChatMessage(respBytes)
	if err != nil {
		return "", err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return "", fmt.Errorf("未返回优化结果")
	}
	return text, nil
}

func GeminiOptimizeText(ctx context.Context, cfg *model.ProviderConfig, modelName, systemPrompt, prompt string, forceJSON bool) (string, error) {
	parts := []geminiPart{{Text: prompt}}
	return geminiGenerateText(ctx, cfg, modelName, systemPrompt, parts, forceJSON)
}

func GeminiImageToPrompt(ctx context.Context, cfg *model.ProviderConfig, modelName string, imageData []byte, systemPrompt string) (string, error) {
	mimeType := http.DetectContentType(imageData)
	if !strings.HasPrefix(mimeType, "image/") {
		mimeType = "image/jpeg"
	}
	parts := []geminiPart{
		{
			InlineData: &geminiBlob{
				MIMEType: mimeType,
				Data:     base64.StdEncoding.EncodeToString(imageData),
			},
		},
		{Text: "请分析这张图片并生成提示词描述。"},
	}
	return geminiGenerateText(ctx, cfg, modelName, systemPrompt, parts, false)
}

func geminiGenerateText(ctx context.Context, cfg *model.ProviderConfig, modelName, systemPrompt string, parts []geminiPart, forceJSON bool) (string, error) {
	providerClient, err := NewGeminiProvider(cfg)
	if err != nil {
		return "", err
	}

	requestCtx, cancel := context.WithTimeout(ctx, chatTimeout(cfg))
	defer cancel()

	generateConfig := &geminiGenerateConfig{}
	if forceJSON {
		generateConfig.ResponseMIMEType = "application/json"
	}

	payload := &geminiGenerateRequest{
		Contents: []geminiContent{
			{
				Role:  "user",
				Parts: parts,
			},
		},
		GenerationConfig: generateConfig,
		SafetySettings:   defaultSafetySettings(),
	}
	if strings.TrimSpace(systemPrompt) != "" {
		payload.SystemInstruction = &geminiContent{
			Parts: []geminiPart{{Text: systemPrompt}},
		}
	}

	resp, _, err := providerClient.doGenerateContent(requestCtx, strings.TrimSpace(modelName), payload, nil)
	if err != nil {
		return "", err
	}

	text := strings.TrimSpace(extractGeminiText(resp))
	if text == "" {
		return "", fmt.Errorf("未返回优化结果")
	}
	return text, nil
}

func extractGeminiText(resp *geminiGenerateResponse) string {
	if resp == nil {
		return ""
	}
	parts := make([]string, 0)
	for _, candidate := range resp.Candidates {
		if candidate.Content == nil {
			continue
		}
		for _, part := range candidate.Content.Parts {
			if strings.TrimSpace(part.Text) != "" {
				parts = append(parts, strings.TrimSpace(part.Text))
			}
		}
	}
	return strings.Join(parts, "\n")
}

func extractOpenAIChatMessage(resp []byte) (string, error) {
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
	return extractOpenAITextFromContent(msg["content"]), nil
}

func extractOpenAITextFromContent(content interface{}) string {
	switch value := content.(type) {
	case string:
		return value
	case []interface{}:
		var parts []string
		for _, item := range value {
			obj, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			if text, ok := obj["text"].(string); ok && strings.TrimSpace(text) != "" {
				parts = append(parts, strings.TrimSpace(text))
			}
		}
		return strings.Join(parts, "\n")
	default:
		return ""
	}
}
