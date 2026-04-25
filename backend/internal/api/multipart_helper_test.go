package api

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestParseGenerateRequestFromMultipartIncludesQuality(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fields := map[string]string{
		"provider":    "openai-image",
		"model_id":    "gpt-image-2",
		"prompt":      "edit prompt",
		"aspectRatio": "1:1",
		"imageSize":   "2K",
		"quality":     "high",
		"count":       "1",
	}
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatalf("WriteField %s: %v", key, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("Close multipart writer: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/generate-with-images", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = request

	req, err := ParseGenerateRequestFromMultipart(c)
	if err != nil {
		t.Fatalf("ParseGenerateRequestFromMultipart: %v", err)
	}
	if req.Quality != "high" {
		t.Fatalf("Quality = %q, want high", req.Quality)
	}
}
