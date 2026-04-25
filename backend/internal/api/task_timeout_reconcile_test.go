package api

import (
	"testing"
	"time"
)

func TestTaskTimeoutForProviderKeepsOpenAIImageConfig(t *testing.T) {
	timeoutMap := map[string]time.Duration{
		"openai":       150 * time.Second,
		"openai-image": 500 * time.Second,
	}

	if got := normalizeProviderForTimeout("openai-image"); got != "openai-image" {
		t.Fatalf("normalizeProviderForTimeout(openai-image) = %q, want openai-image", got)
	}
	if got := taskTimeoutForProvider("openai-image", timeoutMap); got != 500*time.Second {
		t.Fatalf("openai-image timeout = %s, want 500s", got)
	}
	if got := taskTimeoutForProvider("openai-chat", timeoutMap); got != 150*time.Second {
		t.Fatalf("openai-chat timeout = %s, want 150s", got)
	}
}
