package promptopt

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"image-gen-service/internal/config"
	"image-gen-service/internal/model"
	"image-gen-service/internal/provider"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"google.golang.org/genai"
)

const (
	ModeOff  = "off"
	ModeText = "text"
	ModeJSON = "json"
)

type Request struct {
	Provider string
	Model    string
	Prompt   string
	Mode     string
}

type Result struct {
	Provider string
	Model    string
	Prompt   string
	Mode     string
}

func NormalizeMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "", ModeOff:
		return ModeOff
	case ModeJSON, "json_object", "application/json":
		return ModeJSON
	default:
		return ModeText
	}
}

func Enabled(mode string) bool {
	return NormalizeMode(mode) != ModeOff
}

func NormalizeProviderName(providerName string) string {
	name := strings.TrimSpace(strings.ToLower(providerName))
	if name == "" {
		return "openai-chat"
	}
	if name == "openai" {
		return "openai-chat"
	}
	if name == "gemini" {
		return "gemini-chat"
	}
	return name
}

func OptimizePrompt(ctx context.Context, req Request) (*Result, error) {
	rawPrompt := strings.TrimSpace(req.Prompt)
	if rawPrompt == "" {
		return nil, fmt.Errorf("prompt 不能为空")
	}

	mode := NormalizeMode(req.Mode)
	if mode == ModeOff {
		return &Result{
			Provider: NormalizeProviderName(req.Provider),
			Model:    strings.TrimSpace(req.Model),
			Prompt:   rawPrompt,
			Mode:     ModeOff,
		}, nil
	}

	if model.DB == nil {
		return nil, fmt.Errorf("数据库未初始化")
	}

	providerName := NormalizeProviderName(req.Provider)
	var cfg model.ProviderConfig
	if err := model.DB.Where("provider_name = ?", providerName).First(&cfg).Error; err != nil {
		return nil, fmt.Errorf("未找到指定的 Provider: %s", providerName)
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, fmt.Errorf("Provider API Key 未配置")
	}

	modelName := provider.ResolveModelID(provider.ModelResolveOptions{
		ProviderName: providerName,
		Purpose:      provider.PurposeChat,
		RequestModel: strings.TrimSpace(req.Model),
		Config:       &cfg,
	}).ID
	if modelName == "" {
		return nil, fmt.Errorf("未找到可用的模型")
	}

	forceJSON := mode == ModeJSON
	var optimized string
	var err error
	if providerName == "gemini-chat" {
		optimized, err = callGeminiOptimize(ctx, &cfg, modelName, rawPrompt, forceJSON)
	} else {
		optimized, err = callOpenAIOptimize(ctx, &cfg, modelName, rawPrompt, forceJSON)
	}
	if err != nil {
		return nil, err
	}

	return &Result{
		Provider: providerName,
		Model:    modelName,
		Prompt:   optimized,
		Mode:     mode,
	}, nil
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
		Transport: provider.NewRetryableTransport(&http.Transport{
			DisableKeepAlives:   true,
			ForceAttemptHTTP2:   false,
			MaxIdleConns:        0,
			MaxIdleConnsPerHost: 0,
			TLSClientConfig: &tls.Config{
				MinVersion: tls.VersionTLS12,
			},
		}, "gemini-chat", cfg.MaxRetries),
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
	httpClient := &http.Client{
		Timeout: timeout,
		Transport: provider.NewRetryableTransport(&http.Transport{
			DisableKeepAlives:   true,
			ForceAttemptHTTP2:   false,
			MaxIdleConns:        0,
			MaxIdleConnsPerHost: 0,
			TLSClientConfig: &tls.Config{
				MinVersion: tls.VersionTLS12,
			},
		}, "openai-chat", cfg.MaxRetries),
	}
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

func BuildPromptHints(rawPrompt, mode, providerName, modelName string) map[string]interface{} {
	mode = NormalizeMode(mode)
	if mode == ModeOff {
		return map[string]interface{}{}
	}
	return map[string]interface{}{
		"prompt_optimize_mode":     mode,
		"prompt_optimize_provider": NormalizeProviderName(providerName),
		"prompt_optimize_model":    strings.TrimSpace(modelName),
		"prompt_original":          strings.TrimSpace(rawPrompt),
	}
}

func ApplyPromptHints(params map[string]interface{}, rawPrompt, mode, providerName, modelName string) {
	if params == nil {
		return
	}
	for key, value := range BuildPromptHints(rawPrompt, mode, providerName, modelName) {
		params[key] = value
	}
}

func ExtractMode(params map[string]interface{}) string {
	if params == nil {
		return ModeOff
	}
	if value, ok := params["prompt_optimize_mode"].(string); ok {
		return NormalizeMode(value)
	}
	return ModeOff
}

func ExtractProvider(params map[string]interface{}) string {
	if params == nil {
		return ""
	}
	if value, ok := params["prompt_optimize_provider"].(string); ok {
		return NormalizeProviderName(value)
	}
	return ""
}

func ExtractModel(params map[string]interface{}) string {
	if params == nil {
		return ""
	}
	if value, ok := params["prompt_optimize_model"].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}

func ExtractOriginalPrompt(params map[string]interface{}) string {
	if params == nil {
		return ""
	}
	if value, ok := params["prompt_original"].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}

func ExtractPrompt(params map[string]interface{}) string {
	if params == nil {
		return ""
	}
	if value, ok := params["prompt"].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}

func WithUpdatedPrompt(params map[string]interface{}, prompt string) map[string]interface{} {
	if params == nil {
		params = map[string]interface{}{}
	}
	params["prompt"] = prompt
	return params
}
