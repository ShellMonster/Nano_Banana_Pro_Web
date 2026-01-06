package api

import (
	"fmt"
	"io"
	"log"
	"strconv"

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
	Provider    string
	ModelID     string
	Prompt      string
	AspectRatio string
	ImageSize   string
	Count       int
	RefImages   []MultipartFile
	RefPaths    []string
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
		content, err := io.ReadAll(reader)
		if err != nil {
			return fmt.Errorf("读取文件失败: %w", err)
		}
		req.RefImages = append(req.RefImages, MultipartFile{
			Name:    header.FileName(),
			Content: content,
		})
		return nil
	})

	// 执行解析
	if err := p.Parse(); err != nil {
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
		Count:       1,
	}

	if countStr := c.PostForm("count"); countStr != "" {
		if count, err := strconv.Atoi(countStr); err == nil {
			req.Count = count
		}
	}

	form, err := c.MultipartForm()
	if err == nil && form.File != nil {
		files := form.File["refImages"]
		for _, fileHeader := range files {
			file, err := fileHeader.Open()
			if err != nil {
				continue
			}
			content, err := io.ReadAll(file)
			file.Close()
			if err != nil {
				continue
			}
			req.RefImages = append(req.RefImages, MultipartFile{
				Name:    fileHeader.Filename,
				Content: content,
			})
		}
	}

	return req, nil
}
