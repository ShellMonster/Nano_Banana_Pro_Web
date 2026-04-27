package provider

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image-gen-service/internal/model"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
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
			name:  "gpt image 2 supports auto aspect ratio",
			model: "gpt-image-2",
			params: map[string]interface{}{
				"aspectRatio": "auto",
				"imageSize":   "4K",
			},
			want: "auto",
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
		{
			name:  "dalle 3 normalizes explicit auto",
			model: "dall-e-3",
			params: map[string]interface{}{
				"size":        "auto",
				"aspectRatio": "16:9",
			},
			want: "1792x1024",
		},
		{
			name:  "dalle 2 normalizes unsupported explicit size",
			model: "dall-e-2",
			params: map[string]interface{}{
				"size": "1536x1024",
			},
			want: "1024x1024",
		},
		{
			name:  "standard gpt image normalizes unsupported explicit size",
			model: "gpt-image-1",
			params: map[string]interface{}{
				"size":        "2048x1152",
				"aspectRatio": "16:9",
			},
			want: "1536x1024",
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
	var seenImageFileCount int
	var seenMaskFileCount int
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
		seenImageFileCount = len(r.MultipartForm.File["image"])
		seenMaskFileCount = len(r.MultipartForm.File["mask"])
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
		"quality":          "high",
		"count":            1,
		"reference_images": []interface{}{refBytes, refBytes, refBytes},
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
	if seenFields["quality"] != "high" {
		t.Fatalf("quality = %q, want high", seenFields["quality"])
	}
	if _, ok := seenFields["input_fidelity"]; ok {
		t.Fatalf("input_fidelity should not be sent to edits: %+v", seenFields)
	}
	if seenImageFileCount != 1 {
		t.Fatalf("image file count = %d, want 1", seenImageFileCount)
	}
	if seenMaskFileCount != 1 {
		t.Fatalf("mask file count = %d, want 1", seenMaskFileCount)
	}
	if len(result.Images) != 1 {
		t.Fatalf("image count = %d, want 1", len(result.Images))
	}
}

func TestOpenAIImageProviderAutoAspectRatioUsesReferenceDimensions(t *testing.T) {
	var ref bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 100, 200))
	img.Set(0, 0, color.White)
	if err := png.Encode(&ref, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}

	seenFields := map[string]string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(2 << 20); err != nil {
			t.Fatalf("ParseMultipartForm: %v", err)
		}
		for key, values := range r.MultipartForm.Value {
			if len(values) > 0 {
				seenFields[key] = values[0]
			}
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

	_, err = p.Generate(t.Context(), map[string]interface{}{
		"prompt":           "edit prompt",
		"model_id":         "gpt-image-2",
		"aspect_ratio":     "auto",
		"resolution_level": "2K",
		"count":            1,
		"reference_images": []interface{}{ref.Bytes()},
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if seenFields["size"] != "1024x2048" {
		t.Fatalf("size = %q, want 1024x2048; fields=%+v", seenFields["size"], seenFields)
	}
}

func TestOpenAIImageProviderConvertsJPEGReferenceToPNG(t *testing.T) {
	var jpegRef bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.Set(0, 0, color.White)
	if err := jpeg.Encode(&jpegRef, img, nil); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}

	var seenImageContentType string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(2 << 20); err != nil {
			t.Fatalf("ParseMultipartForm: %v", err)
		}
		files := r.MultipartForm.File["image"]
		if len(files) != 1 {
			t.Fatalf("image files = %d, want 1", len(files))
		}
		seenImageContentType = files[0].Header.Get("Content-Type")
		file, err := files[0].Open()
		if err != nil {
			t.Fatalf("open image part: %v", err)
		}
		defer file.Close()
		content, err := io.ReadAll(file)
		if err != nil {
			t.Fatalf("read image part: %v", err)
		}
		if http.DetectContentType(content) != "image/png" {
			t.Fatalf("uploaded content type = %q, want image/png", http.DetectContentType(content))
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

	_, err = p.Generate(t.Context(), map[string]interface{}{
		"prompt":           "edit prompt",
		"model_id":         "gpt-image-2-all",
		"aspect_ratio":     "1:1",
		"resolution_level": "1K",
		"count":            1,
		"reference_images": []interface{}{jpegRef.Bytes()},
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if seenImageContentType != "image/png" {
		t.Fatalf("image part Content-Type = %q, want image/png", seenImageContentType)
	}
}

func TestOpenAIImageProviderRejectsInvalidReference(t *testing.T) {
	_, err := collectOpenAIImageReferences([]interface{}{[]byte("not an image")})
	if err == nil || !strings.Contains(err.Error(), "不是有效图片") {
		t.Fatalf("collectOpenAIImageReferences error = %v, want invalid image error", err)
	}
}
