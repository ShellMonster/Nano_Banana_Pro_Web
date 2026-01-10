package api

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"image-gen-service/internal/config"

	"github.com/gin-gonic/gin"
)

const maxTemplateImageBytes = 12 * 1024 * 1024

type templateImageMeta struct {
	URL         string `json:"url"`
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	UpdatedAt   string `json:"updated_at"`
}

// TemplateImageProxyHandler 代理模板图片并落盘缓存，解决防盗链与加载失败问题
func TemplateImageProxyHandler(c *gin.Context) {
	rawURL := strings.TrimSpace(c.Query("url"))
	if rawURL == "" {
		Error(c, http.StatusBadRequest, 400, "url 不能为空")
		return
	}

	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		Error(c, http.StatusBadRequest, 400, "url 不合法")
		return
	}

	refresh := strings.TrimSpace(c.Query("refresh")) == "1"

	cacheDir := filepath.Join(config.GlobalConfig.Storage.LocalDir, "template_images")
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		Error(c, http.StatusInternalServerError, 500, "创建缓存目录失败")
		return
	}

	cacheKey := sha1.Sum([]byte(rawURL))
	key := hex.EncodeToString(cacheKey[:])
	metaPath := filepath.Join(cacheDir, fmt.Sprintf("%s.json", key))

	if !refresh {
		if cachedPath, contentType := loadTemplateImageCache(metaPath, cacheDir, key); cachedPath != "" {
			writeTemplateImageHeaders(c, contentType, true)
			c.File(cachedPath)
			return
		}
	}

	timeout := time.Duration(config.GlobalConfig.Templates.FetchTimeoutSeconds) * time.Second
	if timeout < 6*time.Second {
		timeout = 6 * time.Second
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		Error(c, http.StatusBadRequest, 400, "请求构造失败")
		return
	}
	req.Header.Set("User-Agent", "BananaAI-TemplateImageProxy/1.0")
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
	if referer := refererForHost(parsed.Host); referer != "" {
		req.Header.Set("Referer", referer)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		Error(c, http.StatusBadGateway, 502, "拉取远程图片失败")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		Error(c, http.StatusBadGateway, 502, "远程图片响应异常")
		return
	}

	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	reader := io.LimitReader(resp.Body, maxTemplateImageBytes+1)
	data, err := io.ReadAll(reader)
	if err != nil {
		Error(c, http.StatusBadGateway, 502, "读取远程图片失败")
		return
	}
	if len(data) > maxTemplateImageBytes {
		Error(c, http.StatusRequestEntityTooLarge, 413, "图片过大")
		return
	}

	ext := resolveImageExt(parsed.Path, contentType)
	filename := fmt.Sprintf("%s%s", key, ext)
	finalPath := filepath.Join(cacheDir, filename)
	tmpPath := finalPath + ".tmp"

	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		Error(c, http.StatusInternalServerError, 500, "写入缓存失败")
		return
	}
	if err := os.Rename(tmpPath, finalPath); err != nil {
		_ = os.Remove(tmpPath)
		Error(c, http.StatusInternalServerError, 500, "写入缓存失败")
		return
	}

	meta := templateImageMeta{
		URL:         rawURL,
		Filename:    filename,
		ContentType: contentType,
		UpdatedAt:   time.Now().Format(time.RFC3339),
	}
	if encoded, err := json.Marshal(meta); err == nil {
		_ = os.WriteFile(metaPath, encoded, 0644)
	}

	writeTemplateImageHeaders(c, contentType, false)
	c.File(finalPath)
}

func loadTemplateImageCache(metaPath, cacheDir, key string) (string, string) {
	if metaData, err := os.ReadFile(metaPath); err == nil {
		var meta templateImageMeta
		if err := json.Unmarshal(metaData, &meta); err == nil && meta.Filename != "" {
			cachedPath := filepath.Join(cacheDir, meta.Filename)
			if _, err := os.Stat(cachedPath); err == nil {
				return cachedPath, meta.ContentType
			}
		}
	}

	matches, err := filepath.Glob(filepath.Join(cacheDir, key+".*"))
	if err == nil && len(matches) > 0 {
		return matches[0], ""
	}

	return "", ""
}

func resolveImageExt(path, contentType string) string {
	if ext := strings.ToLower(filepath.Ext(path)); ext != "" && len(ext) <= 5 {
		return ext
	}
	ctype := strings.ToLower(contentType)
	switch {
	case strings.Contains(ctype, "jpeg"):
		return ".jpg"
	case strings.Contains(ctype, "png"):
		return ".png"
	case strings.Contains(ctype, "webp"):
		return ".webp"
	case strings.Contains(ctype, "gif"):
		return ".gif"
	case strings.Contains(ctype, "bmp"):
		return ".bmp"
	case strings.Contains(ctype, "svg"):
		return ".svg"
	default:
		return ".img"
	}
}

func refererForHost(host string) string {
	hostname := strings.ToLower(host)
	switch {
	case strings.HasSuffix(hostname, "zhimg.com"):
		return "https://www.zhihu.com/"
	case strings.HasSuffix(hostname, "qpic.cn"):
		return "https://mp.weixin.qq.com/"
	case strings.HasSuffix(hostname, "qcloudimg.com"):
		return "https://cloud.tencent.com/"
	default:
		return ""
	}
}

func writeTemplateImageHeaders(c *gin.Context, contentType string, cached bool) {
	if contentType != "" {
		c.Header("Content-Type", contentType)
	}
	if cached {
		c.Header("Cache-Control", "public, max-age=604800")
	} else {
		c.Header("Cache-Control", "public, max-age=86400")
	}
}
