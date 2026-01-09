package provider

import (
	"encoding/json"
	"image-gen-service/internal/model"
	"strings"
)

type ModelPurpose string

const (
	PurposeImage ModelPurpose = "image"
	PurposeChat  ModelPurpose = "chat"
)

type ModelResolveOptions struct {
	ProviderName string
	Purpose      ModelPurpose
	RequestModel string
	Params       map[string]interface{}
	Config       *model.ProviderConfig
}

type ModelResolveResult struct {
	ID     string
	Source string
}

func ResolveModelID(opts ModelResolveOptions) ModelResolveResult {
	if trimmed := strings.TrimSpace(opts.RequestModel); trimmed != "" {
		return ModelResolveResult{ID: trimmed, Source: "request"}
	}

	if opts.Params != nil {
		if v, ok := opts.Params["model_id"].(string); ok {
			if trimmed := strings.TrimSpace(v); trimmed != "" {
				return ModelResolveResult{ID: trimmed, Source: "params"}
			}
		}
		if v, ok := opts.Params["model"].(string); ok {
			if trimmed := strings.TrimSpace(v); trimmed != "" {
				return ModelResolveResult{ID: trimmed, Source: "params"}
			}
		}
	}

	if opts.Config != nil {
		if id := pickModelFromModels(opts.Config.Models); id != "" {
			return ModelResolveResult{ID: id, Source: "config"}
		}
	}

	if id := defaultModelForProvider(opts.ProviderName, opts.Purpose); id != "" {
		return ModelResolveResult{ID: id, Source: "default"}
	}

	return ModelResolveResult{}
}

func pickModelFromModels(models string) string {
	models = strings.TrimSpace(models)
	if models == "" {
		return ""
	}
	var parsed []struct {
		ID      string `json:"id"`
		Default bool   `json:"default"`
	}
	if err := json.Unmarshal([]byte(models), &parsed); err != nil {
		return ""
	}
	for _, item := range parsed {
		if item.Default && strings.TrimSpace(item.ID) != "" {
			return item.ID
		}
	}
	for _, item := range parsed {
		if strings.TrimSpace(item.ID) != "" {
			return item.ID
		}
	}
	return ""
}

func defaultModelForProvider(providerName string, purpose ModelPurpose) string {
	name := strings.ToLower(strings.TrimSpace(providerName))
	if purpose == PurposeChat || name == "openai-chat" {
		return "gemini-3-flash-preview"
	}
	return "gemini-3-pro-image-preview"
}
