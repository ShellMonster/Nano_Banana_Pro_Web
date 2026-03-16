package promptopt

import (
	"testing"

	"image-gen-service/internal/model"
)

func TestExtractModeDefaultsToOff(t *testing.T) {
	if got := ExtractMode(nil); got != ModeOff {
		t.Fatalf("ExtractMode(nil) = %q, want %q", got, ModeOff)
	}

	if got := ExtractMode(map[string]interface{}{}); got != ModeOff {
		t.Fatalf("ExtractMode(empty) = %q, want %q", got, ModeOff)
	}

	if got := ExtractMode(map[string]interface{}{"prompt_optimize_mode": ""}); got != ModeOff {
		t.Fatalf("ExtractMode(blank) = %q, want %q", got, ModeOff)
	}

	if got := ExtractMode(map[string]interface{}{"prompt_optimize_mode": "json_object"}); got != ModeJSON {
		t.Fatalf("ExtractMode(json_object) = %q, want %q", got, ModeJSON)
	}
}

func TestBuildCacheKeyNormalizesValues(t *testing.T) {
	cfgA := &model.ProviderConfig{
		APIBase:        "https://api.openai.com/v1/",
		APIKey:         "secret-key",
		TimeoutSeconds: 150,
		MaxRetries:     1,
	}
	cfgB := &model.ProviderConfig{
		APIBase:        "https://api.openai.com/v1",
		APIKey:         "secret-key",
		TimeoutSeconds: 150,
		MaxRetries:     1,
	}
	keyA := buildCacheKey("OpenAI", " gpt-4.1 ", "json_object", " test prompt ", cfgA, " system prompt ")
	keyB := buildCacheKey("openai-chat", "gpt-4.1", "json", "test prompt", cfgB, "system prompt")
	if keyA != keyB {
		t.Fatalf("buildCacheKey should normalize values, got %q != %q", keyA, keyB)
	}
}

func TestBuildCacheKeyChangesWhenProviderConfigChanges(t *testing.T) {
	baseCfg := &model.ProviderConfig{
		APIBase:        "https://gateway-a.example/v1",
		APIKey:         "secret-a",
		TimeoutSeconds: 150,
		MaxRetries:     1,
	}
	changedCfg := &model.ProviderConfig{
		APIBase:        "https://gateway-b.example/v1",
		APIKey:         "secret-a",
		TimeoutSeconds: 150,
		MaxRetries:     1,
	}

	keyA := buildCacheKey("openai-chat", "gpt-4.1", "text", "prompt", baseCfg, "system prompt")
	keyB := buildCacheKey("openai-chat", "gpt-4.1", "text", "prompt", changedCfg, "system prompt")
	if keyA == keyB {
		t.Fatalf("cache key should change when provider config changes")
	}
}
