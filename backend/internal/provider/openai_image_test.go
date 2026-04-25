package provider

import (
	"encoding/base64"
	"encoding/json"
	"image-gen-service/internal/model"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const tinyPNGBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="

func TestResolveOpenAIImageSize(t *testing.T) {
	tests := []struct {
		name   string
		model  string
		params map[string]interface{}
		want   string
	}{
		{
			name:  "explicit size wins",
			model: "gpt-image-2-all",
			params: map[string]interface{}{
				"size":        "1024x1536",
				"aspectRatio": "16:9",
				"imageSize":   "2K",
			},
			want: "1024x1536",
		},
		{
			name:  "gpt image 2 uses dynamic 16:9 2K",
			model: "gpt-image-2-all",
			params: map[string]interface{}{
				"aspectRatio": "16:9",
				"imageSize":   "2K",
			},
			want: "2048x1152",
		},
		{
			name:  "standard gpt image uses supported landscape size",
			model: "gpt-image-1",
			params: map[string]interface{}{
				"aspectRatio": "16:9",
				"imageSize":   "2K",
			},
			want: "1536x1024",
		},
		{
			name:  "dalle 3 maps portrait",
			model: "dall-e-3",
			params: map[string]interface{}{
				"aspectRatio": "9:16",
			},
			want: "1024x1792",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := resolveOpenAIImageSize(tt.model, tt.params); got != tt.want {
				t.Fatalf("resolveOpenAIImageSize() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestOpenAIImageProviderGenerateUsesGenerations(t *testing.T) {
	var seenPath string
	var seenAuth string
	var seenBody openAIImagesGenerationRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenPath = r.URL.Path
		seenAuth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&seenBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"data": []map[string]string{{"b64_json": tinyPNGBase64}},
		})
	}))
	defer server.Close()

	p, err := NewOpenAIImageProvider(&model.ProviderConfig{
		ProviderName:   "openai-image",
		APIBase:        server.URL,
		APIKey:         "test-key",
		TimeoutSeconds: 5,
	})
	if err != nil {
		t.Fatalf("NewOpenAIImageProvider: %v", err)
	}

	result, err := p.Generate(t.Context(), map[string]interface{}{
		"prompt":      "test prompt",
		"model_id":    "gpt-image-2-all",
		"aspectRatio": "16:9",
		"imageSize":   "2K",
		"count":       1,
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if seenPath != "/v1/images/generations" {
		t.Fatalf("path = %q, want /v1/images/generations", seenPath)
	}
	if seenAuth != "Bearer test-key" {
		t.Fatalf("Authorization = %q", seenAuth)
	}
	if seenBody.Model != "gpt-image-2-all" || seenBody.Size != "2048x1152" || seenBody.Prompt != "test prompt" {
		t.Fatalf("unexpected body: %+v", seenBody)
	}
	if len(result.Images) != 1 {
		t.Fatalf("image count = %d, want 1", len(result.Images))
	}
}

func TestOpenAIImageProviderGenerateWithReferenceUsesEdits(t *testing.T) {
	refBytes, err := base64.StdEncoding.DecodeString(tinyPNGBase64)
	if err != nil {
		t.Fatalf("decode ref: %v", err)
	}

	var seenPath string
	var seenFields = map[string]string{}
	var seenFileCount int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenPath = r.URL.Path
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
			t.Fatalf("Content-Type = %q", r.Header.Get("Content-Type"))
		}
		if err := r.ParseMultipartForm(2 << 20); err != nil {
			t.Fatalf("ParseMultipartForm: %v", err)
		}
		for key, values := range r.MultipartForm.Value {
			if len(values) > 0 {
				seenFields[key] = values[0]
			}
		}
		seenFileCount = len(r.MultipartForm.File["image"])
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"data": []map[string]string{{"b64_json": tinyPNGBase64}},
		})
	}))
	defer server.Close()

	p, err := NewOpenAIImageProvider(&model.ProviderConfig{
		ProviderName:   "openai-image",
		APIBase:        server.URL,
		APIKey:         "test-key",
		TimeoutSeconds: 5,
	})
	if err != nil {
		t.Fatalf("NewOpenAIImageProvider: %v", err)
	}

	result, err := p.Generate(t.Context(), map[string]interface{}{
		"prompt":           "edit prompt",
		"model_id":         "gpt-image-2-all",
		"aspect_ratio":     "1:1",
		"resolution_level": "1K",
		"count":            1,
		"reference_images": []interface{}{refBytes},
		"input_fidelity":   "high",
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if seenPath != "/v1/images/edits" {
		t.Fatalf("path = %q, want /v1/images/edits", seenPath)
	}
	if seenFields["model"] != "gpt-image-2-all" || seenFields["prompt"] != "edit prompt" || seenFields["size"] != "1280x1280" {
		t.Fatalf("unexpected fields: %+v", seenFields)
	}
	if seenFields["input_fidelity"] != "high" {
		t.Fatalf("input_fidelity = %q, want high", seenFields["input_fidelity"])
	}
	if seenFileCount != 1 {
		t.Fatalf("file count = %d, want 1", seenFileCount)
	}
	if len(result.Images) != 1 {
		t.Fatalf("image count = %d, want 1", len(result.Images))
	}
}
