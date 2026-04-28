package provider

import (
	"encoding/json"
	"image-gen-service/internal/model"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenAIProviderErrorPreviewRedactsAndBoundsBody(t *testing.T) {
	longBase64 := "iVBORw0KGgo" + strings.Repeat("A", 1600)
	secret := "secret-openai-key"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"api_key":"` + secret + `","b64_json":"` + longBase64 + `","request_id":"req-openai"}`))
	}))
	defer server.Close()

	p, err := NewOpenAIProvider(&model.ProviderConfig{
		ProviderName:   "openai",
		APIBase:        server.URL,
		APIKey:         "test-key",
		TimeoutSeconds: 5,
		MaxRetries:     0,
	})
	if err != nil {
		t.Fatalf("NewOpenAIProvider: %v", err)
	}

	_, _, err = p.doChatRequest(t.Context(), map[string]interface{}{
		"model":    "gpt-4o",
		"messages": []map[string]string{{"role": "user", "content": "test"}},
	}, nil)
	if err == nil {
		t.Fatalf("doChatRequest error = nil, want HTTP error")
	}
	assertSafeProviderError(t, err.Error(), secret, longBase64)
	if !strings.Contains(err.Error(), "body_length=") {
		t.Fatalf("error = %q, want body_length for troubleshooting", err.Error())
	}
}

func TestOpenAIImageProviderErrorPreviewRedactsAndBoundsBody(t *testing.T) {
	longBase64 := "iVBORw0KGgo" + strings.Repeat("B", 1600)
	secret := "secret-image-token"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"error": map[string]interface{}{
				"message": `upstream failed api_key="` + secret + `" b64_json="` + longBase64 + `"`,
			},
		})
	}))
	defer server.Close()

	p, err := NewOpenAIImageProvider(&model.ProviderConfig{
		ProviderName:   "openai-image",
		APIBase:        server.URL,
		APIKey:         "test-key",
		TimeoutSeconds: 5,
		MaxRetries:     0,
	})
	if err != nil {
		t.Fatalf("NewOpenAIImageProvider: %v", err)
	}

	_, _, err = p.doImagesGenerationRequest(t.Context(), &openAIImagesGenerationRequest{
		Model:  "gpt-image-2",
		Prompt: "test",
		Size:   "auto",
		N:      1,
	}, nil)
	if err == nil {
		t.Fatalf("doImagesGenerationRequest error = nil, want HTTP error")
	}
	assertSafeProviderError(t, err.Error(), secret, longBase64)
}

func TestGeminiProviderHTTPErrorPreviewRedactsAndBoundsBody(t *testing.T) {
	longBase64 := "iVBORw0KGgo" + strings.Repeat("C", 1600)
	secret := "secret-gemini-key"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"api_key":"` + secret + `","inlineData":{"data":"` + longBase64 + `"},"request_id":"req-gemini"}`))
	}))
	defer server.Close()

	p := &GeminiProvider{config: &model.ProviderConfig{
		ProviderName:   "gemini",
		APIBase:        server.URL,
		APIKey:         "test-key",
		TimeoutSeconds: 5,
		MaxRetries:     0,
	}}

	_, _, err := p.doGenerateContent(t.Context(), "gemini-test", &geminiGenerateRequest{
		Contents: []geminiContent{{Role: "user", Parts: []geminiPart{{Text: "test"}}}},
	}, nil)
	if err == nil {
		t.Fatalf("doGenerateContent error = nil, want HTTP error")
	}
	assertSafeProviderError(t, err.Error(), secret, longBase64)
	if !strings.Contains(err.Error(), "body_length=") {
		t.Fatalf("error = %q, want body_length for troubleshooting", err.Error())
	}
}

func TestGeminiProviderJSONParseErrorPreviewRedactsAndBoundsBody(t *testing.T) {
	longBase64 := "iVBORw0KGgo" + strings.Repeat("D", 1600)
	secret := "secret-json-key"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"api_key":"` + secret + `","inlineData":{"data":"` + longBase64 + `"}`))
	}))
	defer server.Close()

	p := &GeminiProvider{config: &model.ProviderConfig{
		ProviderName:   "gemini",
		APIBase:        server.URL,
		APIKey:         "test-key",
		TimeoutSeconds: 5,
		MaxRetries:     0,
	}}

	_, _, err := p.doGenerateContent(t.Context(), "gemini-test", &geminiGenerateRequest{
		Contents: []geminiContent{{Role: "user", Parts: []geminiPart{{Text: "test"}}}},
	}, nil)
	if err == nil {
		t.Fatalf("doGenerateContent error = nil, want parse error")
	}
	assertSafeProviderError(t, err.Error(), secret, longBase64)
}

func assertSafeProviderError(t *testing.T, message, secret, fullBase64 string) {
	t.Helper()
	if strings.Contains(message, secret) {
		t.Fatalf("error = %q, want secret redacted", message)
	}
	if strings.Contains(message, fullBase64) {
		t.Fatalf("error contains full base64 payload")
	}
	if len([]rune(message)) > 1500 {
		t.Fatalf("error length = %d, want bounded message", len([]rune(message)))
	}
}
