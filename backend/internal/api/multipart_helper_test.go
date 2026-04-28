package api

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image-gen-service/internal/provider"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

type testReferenceImageProvider struct{}

func (testReferenceImageProvider) Name() string { return "test-reference-provider" }

func (testReferenceImageProvider) Generate(context.Context, map[string]interface{}) (*provider.ProviderResult, error) {
	return nil, nil
}

func (testReferenceImageProvider) ValidateParams(map[string]interface{}) error { return nil }

type closeErrorReferenceImageReader struct {
	*strings.Reader
}

func (r closeErrorReferenceImageReader) Close() error {
	return errors.New("close failed")
}

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

func TestParseGenerateRequestFromMultipartRejectsTooManyReferenceImages(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body, contentType := buildMultipartReferenceImagesRequest(t, []int{1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1})
	c := newMultipartTestContext(body, contentType)

	_, err := ParseGenerateRequestFromMultipart(c)
	if err == nil {
		t.Fatalf("ParseGenerateRequestFromMultipart error = nil, want reference image count limit error")
	}
	if !strings.Contains(err.Error(), "参考图数量") || !strings.Contains(err.Error(), "10") {
		t.Fatalf("error = %q, want count limit context", err.Error())
	}
}

func TestParseGenerateRequestFromMultipartRejectsOversizedReferenceImage(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body, contentType := buildMultipartReferenceImagesRequest(t, []int{20*1024*1024 + 1})
	c := newMultipartTestContext(body, contentType)

	_, err := ParseGenerateRequestFromMultipart(c)
	if err == nil {
		t.Fatalf("ParseGenerateRequestFromMultipart error = nil, want single reference image size limit error")
	}
	if !strings.Contains(err.Error(), "参考图") || !strings.Contains(err.Error(), "20MB") {
		t.Fatalf("error = %q, want single image size limit context", err.Error())
	}
}

func TestParseGenerateRequestFromMultipartRejectsTotalReferenceImageBytes(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body, contentType := buildMultipartReferenceImagesRequest(t, []int{
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
	})
	c := newMultipartTestContext(body, contentType)

	_, err := ParseGenerateRequestFromMultipart(c)
	if err == nil {
		t.Fatalf("ParseGenerateRequestFromMultipart error = nil, want total reference image bytes limit error")
	}
	if !strings.Contains(err.Error(), "参考图总大小") || !strings.Contains(err.Error(), "80MB") {
		t.Fatalf("error = %q, want total size limit context", err.Error())
	}
}

func TestParseWithStandardLibraryRejectsOversizedReferenceImage(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body, contentType := buildMultipartReferenceImagesRequest(t, []int{20*1024*1024 + 1})
	c := newMultipartTestContext(body, contentType)

	_, err := parseWithStandardLibrary(c)
	if err == nil {
		t.Fatalf("parseWithStandardLibrary error = nil, want single reference image size limit error")
	}
	if !strings.Contains(err.Error(), "参考图") || !strings.Contains(err.Error(), "20MB") {
		t.Fatalf("error = %q, want single image size limit context", err.Error())
	}
}

func TestParseWithStandardLibraryRejectsTooManyReferenceImages(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body, contentType := buildMultipartReferenceImagesRequest(t, []int{1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1})
	c := newMultipartTestContext(body, contentType)

	_, err := parseWithStandardLibrary(c)
	if err == nil {
		t.Fatalf("parseWithStandardLibrary error = nil, want reference image count limit error")
	}
	if !strings.Contains(err.Error(), "参考图数量") || !strings.Contains(err.Error(), "10") {
		t.Fatalf("error = %q, want count limit context", err.Error())
	}
}

func TestParseWithStandardLibraryRejectsTotalReferenceImageBytes(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body, contentType := buildMultipartReferenceImagesRequest(t, []int{
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
	})
	c := newMultipartTestContext(body, contentType)

	_, err := parseWithStandardLibrary(c)
	if err == nil {
		t.Fatalf("parseWithStandardLibrary error = nil, want total reference image bytes limit error")
	}
	if !strings.Contains(err.Error(), "参考图总大小") || !strings.Contains(err.Error(), "80MB") {
		t.Fatalf("error = %q, want total size limit context", err.Error())
	}
}

func TestReadAndCloseReferenceImageReturnsCloseError(t *testing.T) {
	content, err := readAndCloseReferenceImage(closeErrorReferenceImageReader{Reader: strings.NewReader("image-bytes")}, "close-fails.png")
	if err == nil {
		t.Fatalf("readAndCloseReferenceImage error = nil, want close error")
	}
	if !strings.Contains(err.Error(), "关闭参考图失败") || !strings.Contains(err.Error(), "close failed") {
		t.Fatalf("error = %q, want close failure context", err.Error())
	}
	if content != nil {
		t.Fatalf("content = %v, want nil when close fails", content)
	}
}

var _ io.ReadCloser = closeErrorReferenceImageReader{}

func TestValidateRefPathForTauriRejectsOversizedReferenceImage(t *testing.T) {
	realTempRoot, err := filepath.EvalSymlinks(os.TempDir())
	if err != nil {
		t.Fatalf("EvalSymlinks temp root: %v", err)
	}
	t.Setenv("TMPDIR", realTempRoot+string(os.PathSeparator))
	dir, err := os.MkdirTemp(realTempRoot, "banana-ref-limit-*")
	if err != nil {
		t.Fatalf("MkdirTemp under real temp root: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	path := filepath.Join(dir, "oversized-reference.png")
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("Create oversized ref image: %v", err)
	}
	if err := file.Truncate(20*1024*1024 + 1); err != nil {
		file.Close()
		t.Fatalf("Truncate oversized ref image: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("Close oversized ref image: %v", err)
	}

	_, err = validateRefPathForTauri(path)
	if err == nil {
		t.Fatalf("validateRefPathForTauri error = nil, want local reference image size limit error")
	}
	if !strings.Contains(err.Error(), "参考图") || !strings.Contains(err.Error(), "20MB") {
		t.Fatalf("error = %q, want local image size limit context", err.Error())
	}
}

func TestGenerateWithImagesHandlerReturnsLocalReferenceImageSizeError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("TAURI_PLATFORM", "darwin")
	provider.Register(testReferenceImageProvider{})

	dir := newAllowedTempDir(t)
	path := filepath.Join(dir, "oversized-reference.png")
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("Create oversized ref image: %v", err)
	}
	if err := file.Truncate(20*1024*1024 + 1); err != nil {
		file.Close()
		t.Fatalf("Truncate oversized ref image: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("Close oversized ref image: %v", err)
	}

	body, contentType := buildMultipartReferencePathsRequest(t, []string{path})
	request := httptest.NewRequest(http.MethodPost, "/api/generate-with-images", body)
	request.Header.Set("Content-Type", contentType)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = request

	GenerateWithImagesHandler(c)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body = %s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "参考图") || !strings.Contains(recorder.Body.String(), "20MB") {
		t.Fatalf("body = %q, want local reference image size limit context", recorder.Body.String())
	}
}

func TestValidateRefPathForTauriRejectsNonRegularReferenceImage(t *testing.T) {
	dir := newAllowedTempDir(t)

	_, err := validateRefPathForTauri(dir)
	if err == nil {
		t.Fatalf("validateRefPathForTauri error = nil, want non-regular reference image error")
	}
	if !strings.Contains(err.Error(), "普通文件") {
		t.Fatalf("error = %q, want non-regular file context", err.Error())
	}
}

func TestGenerateWithImagesHandlerRejectsTooManyLocalReferencePaths(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("TAURI_PLATFORM", "darwin")
	provider.Register(testReferenceImageProvider{})

	paths := makeLocalReferenceImages(t, []int{1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1})
	recorder := runGenerateWithImagesForRefPaths(t, paths)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body = %s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "参考图数量") || !strings.Contains(recorder.Body.String(), "10") {
		t.Fatalf("body = %q, want local refPaths count limit context", recorder.Body.String())
	}
}

func TestGenerateWithImagesHandlerRejectsTotalLocalReferencePathBytes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("TAURI_PLATFORM", "darwin")
	provider.Register(testReferenceImageProvider{})

	paths := makeLocalReferenceImages(t, []int{
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
		9 * 1024 * 1024,
	})
	recorder := runGenerateWithImagesForRefPaths(t, paths)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body = %s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "参考图总大小") || !strings.Contains(recorder.Body.String(), "80MB") {
		t.Fatalf("body = %q, want local refPaths total size limit context", recorder.Body.String())
	}
}

func buildMultipartReferenceImagesRequest(t *testing.T, fileSizes []int) (*bytes.Buffer, string) {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fields := map[string]string{
		"provider":    "openai-image",
		"model_id":    "gpt-image-2",
		"prompt":      "edit prompt",
		"aspectRatio": "1:1",
		"imageSize":   "2K",
		"count":       "1",
	}
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatalf("WriteField %s: %v", key, err)
		}
	}
	for i, size := range fileSizes {
		part, err := writer.CreateFormFile("refImages", fmt.Sprintf("ref-%02d.png", i+1))
		if err != nil {
			t.Fatalf("CreateFormFile %d: %v", i, err)
		}
		if _, err := part.Write(bytes.Repeat([]byte{'x'}, size)); err != nil {
			t.Fatalf("Write ref image %d: %v", i, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("Close multipart writer: %v", err)
	}
	return &body, writer.FormDataContentType()
}

func buildMultipartReferencePathsRequest(t *testing.T, paths []string) (*bytes.Buffer, string) {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fields := map[string]string{
		"provider":    "test-reference-provider",
		"model_id":    "test-model",
		"prompt":      "edit prompt",
		"aspectRatio": "1:1",
		"imageSize":   "2K",
		"count":       "1",
	}
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatalf("WriteField %s: %v", key, err)
		}
	}
	for _, path := range paths {
		if err := writer.WriteField("refPaths", path); err != nil {
			t.Fatalf("WriteField refPaths: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("Close multipart writer: %v", err)
	}
	return &body, writer.FormDataContentType()
}

func newAllowedTempDir(t *testing.T) string {
	t.Helper()

	realTempRoot, err := filepath.EvalSymlinks(os.TempDir())
	if err != nil {
		t.Fatalf("EvalSymlinks temp root: %v", err)
	}
	t.Setenv("TMPDIR", realTempRoot+string(os.PathSeparator))
	dir, err := os.MkdirTemp(realTempRoot, "banana-ref-limit-*")
	if err != nil {
		t.Fatalf("MkdirTemp under real temp root: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}

func makeLocalReferenceImages(t *testing.T, fileSizes []int) []string {
	t.Helper()

	dir := newAllowedTempDir(t)
	paths := make([]string, 0, len(fileSizes))
	for i, size := range fileSizes {
		path := filepath.Join(dir, fmt.Sprintf("ref-%02d.png", i+1))
		if err := os.WriteFile(path, bytes.Repeat([]byte{'x'}, size), 0o600); err != nil {
			t.Fatalf("Write local ref image %d: %v", i, err)
		}
		paths = append(paths, path)
	}
	return paths
}

func runGenerateWithImagesForRefPaths(t *testing.T, paths []string) *httptest.ResponseRecorder {
	t.Helper()

	body, contentType := buildMultipartReferencePathsRequest(t, paths)
	request := httptest.NewRequest(http.MethodPost, "/api/generate-with-images", body)
	request.Header.Set("Content-Type", contentType)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = request

	GenerateWithImagesHandler(c)
	return recorder
}

func newMultipartTestContext(body *bytes.Buffer, contentType string) *gin.Context {
	request := httptest.NewRequest(http.MethodPost, "/api/generate-with-images", body)
	request.Header.Set("Content-Type", contentType)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = request
	return c
}
