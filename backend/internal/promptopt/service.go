package promptopt

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	"image-gen-service/internal/config"
	"image-gen-service/internal/model"
	"image-gen-service/internal/provider"

	"golang.org/x/sync/singleflight"
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

type cacheEntry struct {
	result    Result
	expiresAt time.Time
}

var (
	optimizeCacheTTL = 10 * time.Minute
	optimizeGroup    singleflight.Group
	optimizeCacheMu  sync.RWMutex
	optimizeCache    = map[string]cacheEntry{}
)

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

	systemPrompt := getOptimizeSystemPrompt(mode == ModeJSON)
	cacheKey := buildCacheKey(providerName, modelName, mode, rawPrompt, &cfg, systemPrompt)
	if cached, ok := getCachedResult(cacheKey); ok {
		return &cached, nil
	}

	value, err, _ := optimizeGroup.Do(cacheKey, func() (interface{}, error) {
		if cached, ok := getCachedResult(cacheKey); ok {
			return cached, nil
		}

		forceJSON := mode == ModeJSON
		var optimized string
		var optimizeErr error
		if providerName == "gemini-chat" {
			optimized, optimizeErr = callGeminiOptimize(ctx, &cfg, modelName, rawPrompt, forceJSON)
		} else {
			optimized, optimizeErr = callOpenAIOptimize(ctx, &cfg, modelName, rawPrompt, forceJSON)
		}
		if optimizeErr != nil {
			return nil, optimizeErr
		}

		result := Result{
			Provider: providerName,
			Model:    modelName,
			Prompt:   optimized,
			Mode:     mode,
		}
		cacheResult(cacheKey, result)
		return result, nil
	})
	if err != nil {
		return nil, err
	}

	result, ok := value.(Result)
	if !ok {
		return nil, fmt.Errorf("优化结果类型异常")
	}
	return &result, nil
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
	return provider.GeminiOptimizeText(ctx, cfg, modelName, getOptimizeSystemPrompt(forceJSON), prompt, forceJSON)
}

func callOpenAIOptimize(ctx context.Context, cfg *model.ProviderConfig, modelName, prompt string, forceJSON bool) (string, error) {
	return provider.OpenAIOptimizeText(ctx, cfg, modelName, getOptimizeSystemPrompt(forceJSON), prompt, forceJSON)
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

func buildCacheKey(providerName, modelName, mode, prompt string, cfg *model.ProviderConfig, systemPrompt string) string {
	apiBase := ""
	apiKeyHash := ""
	timeoutSeconds := "0"
	maxRetries := "0"
	if cfg != nil {
		apiBase = normalizedAPIBaseForCache(providerName, cfg.APIBase)
		apiKeyHash = shortHash(strings.TrimSpace(cfg.APIKey))
		timeoutSeconds = fmt.Sprintf("%d", cfg.TimeoutSeconds)
		maxRetries = fmt.Sprintf("%d", cfg.MaxRetries)
	}
	return strings.Join([]string{
		NormalizeProviderName(providerName),
		strings.TrimSpace(modelName),
		NormalizeMode(mode),
		apiBase,
		apiKeyHash,
		timeoutSeconds,
		maxRetries,
		shortHash(strings.TrimSpace(systemPrompt)),
		strings.TrimSpace(prompt),
	}, "\n")
}

func normalizedAPIBaseForCache(providerName, apiBase string) string {
	name := NormalizeProviderName(providerName)
	base := strings.TrimSpace(apiBase)
	if base == "" {
		return ""
	}
	if name == "openai-chat" {
		return provider.NormalizeOpenAIBaseURL(base)
	}
	return strings.TrimRight(base, "/")
}

func shortHash(value string) string {
	if strings.TrimSpace(value) == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:8])
}

func getCachedResult(cacheKey string) (Result, bool) {
	optimizeCacheMu.RLock()
	entry, ok := optimizeCache[cacheKey]
	optimizeCacheMu.RUnlock()
	if !ok {
		return Result{}, false
	}
	if time.Now().After(entry.expiresAt) {
		optimizeCacheMu.Lock()
		delete(optimizeCache, cacheKey)
		optimizeCacheMu.Unlock()
		return Result{}, false
	}
	return entry.result, true
}

func cacheResult(cacheKey string, result Result) {
	optimizeCacheMu.Lock()
	defer optimizeCacheMu.Unlock()
	optimizeCache[cacheKey] = cacheEntry{
		result:    result,
		expiresAt: time.Now().Add(optimizeCacheTTL),
	}
}
