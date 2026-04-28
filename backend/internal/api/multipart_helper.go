package api

import (
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mazrean/formstream"
	ginform "github.com/mazrean/formstream/gin"
)

// MultipartFile 表示上传的文件
type MultipartFile struct {
	Name    string
	Content []byte
}

// MultipartRequest 表示图生图请求解析后的数据
type MultipartRequest struct {
	Provider               string
	ModelID                string
	Prompt                 string
	AspectRatio            string
	ImageSize              string
	Quality                string
	Count                  int
	Verbose                bool
	PromptOptimizeMode     string
	PromptOptimizeProvider string
	PromptOptimizeModel    string
	RefImages              []MultipartFile
	RefPaths               []string
}

const (
	maxReferenceImageCount      = 10
	maxReferenceImageSizeBytes  = 20 * 1024 * 1024
	maxReferenceImagesTotalByte = 80 * 1024 * 1024
)

func referenceImageLimitMB(limit int64) int64 {
	return limit / 1024 / 1024
}

func referenceImagesTotalBytes(files []MultipartFile) int64 {
	var total int64
	for _, file := range files {
		total += int64(len(file.Content))
	}
	return total
}

func totalReferenceImageBytes(images []interface{}) int64 {
	var total int64
	for _, image := range images {
		if content, ok := image.([]byte); ok {
			total += int64(len(content))
		}
	}
	return total
}

func validateReferenceImageCount(nextCount int) error {
	if nextCount > maxReferenceImageCount {
		return fmt.Errorf("参考图数量超过限制: 当前 %d 张，最多 %d 张", nextCount, maxReferenceImageCount)
	}
	return nil
}

func validateReferenceImageSize(name string, size int64) error {
	if size > maxReferenceImageSizeBytes {
		return fmt.Errorf("参考图 %s 大小超过限制: 当前 %.2fMB，单张最多 %dMB", name, float64(size)/1024/1024, referenceImageLimitMB(maxReferenceImageSizeBytes))
	}
	return nil
}

func validateReferenceImageRegularFile(name string, isRegular bool) error {
	if !isRegular {
		return fmt.Errorf("参考图 %s 不是普通文件", name)
	}
	return nil
}

func validateReferenceImagesTotalBytes(nextTotal int64) error {
	if nextTotal > maxReferenceImagesTotalByte {
		return fmt.Errorf("参考图总大小超过限制: 当前 %.2fMB，总计最多 %dMB", float64(nextTotal)/1024/1024, referenceImageLimitMB(maxReferenceImagesTotalByte))
	}
	return nil
}

func validateReferenceImageBytesAppend(currentImages []interface{}, name string, content []byte) error {
	if err := validateReferenceImageCount(len(currentImages) + 1); err != nil {
		return err
	}
	if err := validateReferenceImageSize(name, int64(len(content))); err != nil {
		return err
	}
	return validateReferenceImagesTotalBytes(totalReferenceImageBytes(currentImages) + int64(len(content)))
}

func appendReferenceImageBytes(currentImages []interface{}, name string, content []byte) ([]interface{}, error) {
	if err := validateReferenceImageBytesAppend(currentImages, name, content); err != nil {
		return currentImages, err
	}
	return append(currentImages, content), nil
}

func readReferenceImageWithLimit(reader io.Reader, name string) ([]byte, error) {
	content, err := io.ReadAll(io.LimitReader(reader, maxReferenceImageSizeBytes+1))
	if err != nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}
	if err := validateReferenceImageSize(name, int64(len(content))); err != nil {
		return nil, err
	}
	return content, nil
}

func readAndCloseReferenceImage(file io.ReadCloser, name string) ([]byte, error) {
	content, readErr := readReferenceImageWithLimit(file, name)
	closeErr := file.Close()
	if readErr != nil {
		return nil, readErr
	}
	if closeErr != nil {
		return nil, fmt.Errorf("关闭参考图失败: %w", closeErr)
	}
	return content, nil
}

func appendMultipartReferenceImage(req *MultipartRequest, name string, content []byte) error {
	if err := validateReferenceImageCount(len(req.RefImages) + 1); err != nil {
		return err
	}
	if err := validateReferenceImageSize(name, int64(len(content))); err != nil {
		return err
	}
	nextTotal := referenceImagesTotalBytes(req.RefImages) + int64(len(content))
	if err := validateReferenceImagesTotalBytes(nextTotal); err != nil {
		return err
	}
	req.RefImages = append(req.RefImages, MultipartFile{
		Name:    name,
		Content: content,
	})
	return nil
}

func validateFileHeaderBeforeRead(fileHeader *multipart.FileHeader, currentCount int, currentTotal int64) error {
	if err := validateReferenceImageCount(currentCount + 1); err != nil {
		return err
	}
	if fileHeader == nil {
		return nil
	}
	if err := validateReferenceImageSize(fileHeader.Filename, fileHeader.Size); err != nil {
		return err
	}
	return validateReferenceImagesTotalBytes(currentTotal + fileHeader.Size)
}

// ParseGenerateRequestFromMultipart 使用 formstream 解析图生图请求
func ParseGenerateRequestFromMultipart(c *gin.Context) (*MultipartRequest, error) {
	req := &MultipartRequest{
		Count: 1, // 默认生成 1 张
	}

	p, err := ginform.NewParser(c)
	if err != nil {
		return nil, fmt.Errorf("创建解析器失败: %w", err)
	}

	// 注册字段处理器
	p.Parser.Register("provider", func(reader io.Reader, header formstream.Header) error {
		data, err := io.ReadAll(reader)
		if err != nil {
			return err
		}
		req.Provider = string(data)
		return nil
	})
	p.Parser.Register("model_id", func(reader io.Reader, header formstream.Header) error {
		data, err := io.ReadAll(reader)
		if err != nil {
			return err
		}
		req.ModelID = string(data)
		return nil
	})
	p.Parser.Register("prompt", func(reader io.Reader, header formstream.Header) error {
		data, err := io.ReadAll(reader)
		if err != nil {
			return err
		}
		req.Prompt = string(data)
		return nil
	})
	p.Parser.Register("aspectRatio", func(reader io.Reader, header formstream.Header) error {
		data, err := io.ReadAll(reader)
		if err != nil {
			return err
		}
		req.AspectRatio = string(data)
		return nil
	})
	p.Parser.Register("imageSize", func(reader io.Reader, header formstream.Header) error {
		data, err := io.ReadAll(reader)
		if err != nil {
			return err
		}
		req.ImageSize = string(data)
		return nil
	})
	p.Parser.Register("quality", func(reader io.Reader, header formstream.Header) error {
		data, err := io.ReadAll(reader)
		if err != nil {
			return err
		}
		req.Quality = string(data)
		return nil
	})
	p.Parser.Register("count", func(reader io.Reader, header formstream.Header) error {
		data, err := io.ReadAll(reader)
		if err != nil {
			return err
		}
		if count, err := strconv.Atoi(string(data)); err == nil {
			req.Count = count
		}
		return nil
	})
	p.Parser.Register("verbose_logging", func(reader io.Reader, header formstream.Header) error {
		data, err := io.ReadAll(reader)
		if err != nil {
			return err
		}
		req.Verbose = parseLooseBool(string(data))
		return nil
	})
	p.Parser.Register("prompt_optimize_mode", func(reader io.Reader, header formstream.Header) error {
		data, err := io.ReadAll(reader)
		if err != nil {
			return err
		}
		req.PromptOptimizeMode = string(data)
		return nil
	})
	p.Parser.Register("prompt_optimize_provider", func(reader io.Reader, header formstream.Header) error {
		data, err := io.ReadAll(reader)
		if err != nil {
			return err
		}
		req.PromptOptimizeProvider = string(data)
		return nil
	})
	p.Parser.Register("prompt_optimize_model", func(reader io.Reader, header formstream.Header) error {
		data, err := io.ReadAll(reader)
		if err != nil {
			return err
		}
		req.PromptOptimizeModel = string(data)
		return nil
	})
	p.Parser.Register("refPaths", func(reader io.Reader, header formstream.Header) error {
		data, err := io.ReadAll(reader)
		if err != nil {
			return err
		}
		req.RefPaths = append(req.RefPaths, string(data))
		return nil
	})

	// 注册文件处理器 (匹配前端的 refImages)
	p.Parser.Register("refImages", func(reader io.Reader, header formstream.Header) error {
		name := header.FileName()
		if err := validateReferenceImageCount(len(req.RefImages) + 1); err != nil {
			return err
		}
		content, err := readReferenceImageWithLimit(reader, name)
		if err != nil {
			return err
		}
		return appendMultipartReferenceImage(req, name, content)
	})

	// 执行解析
	if err := p.Parse(); err != nil {
		if strings.Contains(err.Error(), "参考图") {
			return nil, err
		}
		// 如果 formstream 解析失败，尝试回退到标准库
		log.Printf("[回退] formstream 解析失败: %v, 尝试使用标准库\n", err)
		return parseWithStandardLibrary(c)
	}

	return req, nil
}

// parseWithStandardLibrary 标准库回退解析逻辑
func parseWithStandardLibrary(c *gin.Context) (*MultipartRequest, error) {
	if err := c.Request.ParseMultipartForm(32 << 20); err != nil {
		return nil, fmt.Errorf("解析表单失败: %w", err)
	}

	req := &MultipartRequest{
		Provider:    c.PostForm("provider"),
		ModelID:     c.PostForm("model_id"),
		Prompt:      c.PostForm("prompt"),
		AspectRatio: c.PostForm("aspectRatio"),
		ImageSize:   c.PostForm("imageSize"),
		Quality:     c.PostForm("quality"),
		Count:       1,
	}

	if countStr := c.PostForm("count"); countStr != "" {
		if count, err := strconv.Atoi(countStr); err == nil {
			req.Count = count
		}
	}
	req.Verbose = parseLooseBool(c.PostForm("verbose_logging"))
	req.PromptOptimizeMode = c.PostForm("prompt_optimize_mode")
	req.PromptOptimizeProvider = c.PostForm("prompt_optimize_provider")
	req.PromptOptimizeModel = c.PostForm("prompt_optimize_model")

	form, err := c.MultipartForm()
	if err == nil && form.File != nil {
		files := form.File["refImages"]
		for _, fileHeader := range files {
			if err := validateFileHeaderBeforeRead(fileHeader, len(req.RefImages), referenceImagesTotalBytes(req.RefImages)); err != nil {
				return nil, err
			}
			file, err := fileHeader.Open()
			if err != nil {
				return nil, fmt.Errorf("打开参考图失败: %w", err)
			}
			content, err := readAndCloseReferenceImage(file, fileHeader.Filename)
			if err != nil {
				return nil, err
			}
			if err := appendMultipartReferenceImage(req, fileHeader.Filename, content); err != nil {
				return nil, err
			}
		}
	}

	return req, nil
}

func parseLooseBool(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}
