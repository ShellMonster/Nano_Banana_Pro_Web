package storage

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
	"github.com/disintegration/imaging"
)

// 常量定义
const (
	// 最大图片文件大小限制 (100MB)
	maxImageSize = 100 * 1024 * 1024

	// 图片格式魔数常量
	// PNG: 89 50 4E 47 0D 0A 1A 0A
	magicPNG = "\x89PNG\r\n\x1a\n"
	// JPEG: FF D8 FF
	magicJPEG = "\xff\xd8\xff"
	// GIF: 47 49 46 38 (GIF8)
	magicGIF = "GIF8"
	// WebP: RIFF....WEBP
	magicRIFF = "RIFF"
	magicWEBP = "WEBP"
)

// 错误定义
var (
	ErrImageTooLarge   = errors.New("图片文件大小超过限制 (100MB)")
	ErrUnknownFormat   = errors.New("无法识别的图片格式")
	ErrInvalidImage    = errors.New("无效的图片数据")
)

// Storage 定义存储接口
type Storage interface {
	Save(name string, reader io.Reader) (string, string, error)                                                               // 返回 (localPath, remoteURL, error)
	SaveWithThumbnail(name string, reader io.Reader) (string, string, string, string, int, int, error) // 返回 (localPath, remoteURL, thumbLocalPath, thumbRemoteURL, width, height, error)
	Delete(name string) error
}

// LocalStorage 本地存储实现
type LocalStorage struct {
	BaseDir string
}

func (l *LocalStorage) Save(name string, reader io.Reader) (string, string, error) {
	// 使用 filepath.Base 防止路径遍历攻击
	safeName := filepath.Base(name)
	path := filepath.Join(l.BaseDir, safeName)
	// 确保目录存在
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", "", fmt.Errorf("创建目录失败: %w", err)
	}

	file, err := os.Create(path)
	if err != nil {
		return "", "", fmt.Errorf("创建本地文件失败: %w", err)
	}
	defer file.Close()

	_, err = io.Copy(file, reader)
	if err != nil {
		return "", "", fmt.Errorf("写入本地文件失败: %w", err)
	}

	return path, "", nil
}

// detectImageFormat 检测图片格式（通过文件头魔数）
// 返回格式名称或错误，不再使用默认值
func detectImageFormat(data []byte) (string, error) {
	if len(data) < 8 {
		return "", ErrInvalidImage
	}

	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if bytes.HasPrefix(data, []byte(magicPNG)) {
		return "png", nil
	}
	// JPEG: FF D8 FF
	if bytes.HasPrefix(data, []byte(magicJPEG)) {
		return "jpeg", nil
	}
	// GIF: 47 49 46 38 (GIF8)
	if bytes.HasPrefix(data, []byte(magicGIF)) {
		return "gif", nil
	}
	// WebP: RIFF....WEBP (位置 0-3 是 RIFF, 位置 8-11 是 WEBP)
	if bytes.HasPrefix(data, []byte(magicRIFF)) && len(data) >= 12 {
		if string(data[8:12]) == magicWEBP {
			return "webp", nil
		}
	}

	return "", ErrUnknownFormat
}

// formatToExt 将格式名称转换为文件后缀
func formatToExt(format string) string {
	switch format {
	case "jpeg":
		return ".jpg"
	case "png":
		return ".png"
	case "gif":
		return ".gif"
	case "webp":
		return ".webp"
	default:
		return ".png"
	}
}

func (l *LocalStorage) SaveWithThumbnail(name string, reader io.Reader) (string, string, string, string, int, int, error) {
	// 1. 读取原始数据到内存（使用 LimitReader 限制大小，防止内存溢出）
	limitedReader := io.LimitReader(reader, maxImageSize+1)
	data, err := io.ReadAll(limitedReader)
	if err != nil {
		return "", "", "", "", 0, 0, fmt.Errorf("读取图片数据失败: %w", err)
	}

	// 2. 检查文件大小是否超限
	if len(data) > maxImageSize {
		return "", "", "", "", 0, 0, ErrImageTooLarge
	}

	// 3. 检测图片格式（不再使用默认值，格式必须被识别）
	format, err := detectImageFormat(data)
	if err != nil {
		return "", "", "", "", 0, 0, fmt.Errorf("检测图片格式失败: %w", err)
	}
	ext := formatToExt(format)
	log.Printf("[Storage] 检测到图片格式: %s, 后缀: %s", format, ext)

	// 4. 生成正确的文件名（去掉原后缀，使用检测到的后缀）
	// 使用 filepath.Base 防止路径遍历攻击
	safeName := filepath.Base(name)
	baseName := strings.TrimSuffix(safeName, filepath.Ext(safeName))
	fileName := baseName + ext
	localPath := filepath.Join(l.BaseDir, fileName)

	// 5. 确保目录存在
	dir := filepath.Dir(localPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", "", "", "", 0, 0, fmt.Errorf("创建目录失败: %w", err)
	}

	// 6. 直接保存原始字节（无损，保持原始质量）
	if err := os.WriteFile(localPath, data, 0644); err != nil {
		return "", "", "", "", 0, 0, fmt.Errorf("保存原图失败: %w", err)
	}
	log.Printf("[Storage] 原图已保存: %s", localPath)

	// 7. 解码图片用于生成缩略图和获取尺寸
	srcImg, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		// 解码失败但原图已保存，只记录警告，返回原图路径
		log.Printf("[Storage] 警告: 解码图片失败，无法生成缩略图: %v", err)
		return localPath, "", "", "", 0, 0, nil
	}

	// 8. 获取图片尺寸
	width := srcImg.Bounds().Dx()
	height := srcImg.Bounds().Dy()

	// 9. 生成 256x256 的等比例缩略图（使用相同格式）
	thumbName := "thumb_" + fileName
	thumbPath := filepath.Join(l.BaseDir, thumbName)
	dstImg := imaging.Thumbnail(srcImg, 256, 256, imaging.Lanczos)
	if err := imaging.Save(dstImg, thumbPath); err != nil {
		log.Printf("[Storage] 警告: 保存缩略图失败: %v", err)
		// 缩略图失败不影响原图，继续返回
		return localPath, "", "", "", width, height, nil
	}
	log.Printf("[Storage] 缩略图已保存: %s", thumbPath)

	return localPath, "", thumbPath, "", width, height, nil
}

func (l *LocalStorage) Delete(name string) error {
	// 使用 filepath.Base 防止路径遍历攻击
	safeName := filepath.Base(name)
	path := filepath.Join(l.BaseDir, safeName)
	err := os.Remove(path)

	// 同时尝试删除缩略图（可能后缀不同，尝试多种格式）
	baseName := strings.TrimSuffix(safeName, filepath.Ext(safeName))
	for _, ext := range []string{".png", ".jpg", ".gif", ".webp"} {
		thumbPath := filepath.Join(l.BaseDir, "thumb_"+baseName+ext)
		_ = os.Remove(thumbPath)
	}

	return err
}

// OSSStorage 阿里云 OSS 存储实现
type OSSStorage struct {
	Bucket *oss.Bucket
	Domain string // OSS 访问域名
}

func (s *OSSStorage) Save(name string, reader io.Reader) (string, string, error) {
	err := s.Bucket.PutObject(name, reader)
	if err != nil {
		return "", "", fmt.Errorf("OSS 上传失败: %w", err)
	}

	url := fmt.Sprintf("https://%s/%s", s.Domain, name)
	return "", url, nil
}

func (s *OSSStorage) SaveWithThumbnail(name string, reader io.Reader) (string, string, string, string, int, int, error) {
	// 1. 使用 LimitReader 限制大小，防止内存溢出
	limitedReader := io.LimitReader(reader, maxImageSize+1)
	data, err := io.ReadAll(limitedReader)
	if err != nil {
		return "", "", "", "", 0, 0, fmt.Errorf("读取图片数据失败: %w", err)
	}

	// 2. 检查文件大小是否超限
	if len(data) > maxImageSize {
		return "", "", "", "", 0, 0, ErrImageTooLarge
	}

	// 3. 检测格式（必须被识别）
	format, err := detectImageFormat(data)
	if err != nil {
		return "", "", "", "", 0, 0, fmt.Errorf("检测图片格式失败: %w", err)
	}
	ext := formatToExt(format)

	// 4. 使用 filepath.Base 防止路径遍历攻击
	safeName := filepath.Base(name)
	baseName := strings.TrimSuffix(safeName, filepath.Ext(safeName))
	fileName := baseName + ext

	// 5. 上传原图
	_, remoteURL, err := s.Save(fileName, bytes.NewReader(data))
	if err != nil {
		return "", "", "", "", 0, 0, err
	}

	// 6. 生成缩略图并获取尺寸
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", remoteURL, "", "", 0, 0, nil
	}

	width := img.Bounds().Dx()
	height := img.Bounds().Dy()

	dstImg := imaging.Thumbnail(img, 256, 256, imaging.Lanczos)

	// 7. 根据原图格式选择缩略图编码方式（保持格式一致）
	buf := new(bytes.Buffer)
	var encodeErr error
	switch format {
	case "jpeg":
		encodeErr = imaging.Encode(buf, dstImg, imaging.JPEG)
	case "gif":
		encodeErr = imaging.Encode(buf, dstImg, imaging.GIF)
	case "webp":
		// imaging 不支持 webp 编码，回退到 PNG
		encodeErr = imaging.Encode(buf, dstImg, imaging.PNG)
	default:
		encodeErr = imaging.Encode(buf, dstImg, imaging.PNG)
	}
	if encodeErr != nil {
		return "", remoteURL, "", "", width, height, nil
	}

	// 8. 上传缩略图（缩略图后缀与原图一致）
	thumbName := "thumb_" + fileName
	_, thumbRemoteURL, err := s.Save(thumbName, buf)
	if err != nil {
		log.Printf("[Storage] 警告: 上传缩略图到 OSS 失败: %v", err)
		// 缩略图上传失败不影响原图，继续返回
	}

	return "", remoteURL, "", thumbRemoteURL, width, height, nil
}

func (s *OSSStorage) Delete(name string) error {
	var errs []string

	// 使用 filepath.Base 防止路径遍历攻击
	safeName := filepath.Base(name)

	// 删除原图
	if err := s.Bucket.DeleteObject(safeName); err != nil {
		errs = append(errs, fmt.Sprintf("删除原图失败: %v", err))
	}

	// 尝试删除各种格式的缩略图
	baseName := strings.TrimSuffix(safeName, filepath.Ext(safeName))
	for _, ext := range []string{".png", ".jpg", ".gif", ".webp"} {
		if err := s.Bucket.DeleteObject("thumb_" + baseName + ext); err != nil {
			// 缩略图删除失败只记录日志，不作为错误
			log.Printf("[Storage] 删除缩略图失败: %v", err)
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("OSS 删除失败: %s", strings.Join(errs, "; "))
	}
	return nil
}

// CompositeStorage 同时支持本地和 OSS
type CompositeStorage struct {
	Local *LocalStorage
	OSS   *OSSStorage
}

func (c *CompositeStorage) Save(name string, reader io.Reader) (string, string, error) {
	// 保持原样，仅为了接口兼容
	return c.Local.Save(name, reader)
}

func (c *CompositeStorage) SaveWithThumbnail(name string, reader io.Reader) (string, string, string, string, int, int, error) {
	// 1. 先保存到本地并生成缩略图
	localPath, _, thumbLocalPath, _, width, height, err := c.Local.SaveWithThumbnail(name, reader)
	if err != nil {
		return "", "", "", "", 0, 0, err
	}

	remoteURL := ""
	thumbRemoteURL := ""
	if c.OSS != nil {
		// 2. 上传原图到 OSS（使用实际的文件名）
		fileName := filepath.Base(localPath)
		file, err := os.Open(localPath)
		if err == nil {
			defer file.Close()
			_, remoteURL, err = c.OSS.Save(fileName, file)
			if err != nil {
				log.Printf("[Storage] 警告: 上传原图到 OSS 失败: %v", err)
			}
		} else {
			log.Printf("[Storage] 警告: 打开本地文件失败，无法上传到 OSS: %v", err)
		}

		// 3. 上传缩略图到 OSS
		if thumbLocalPath != "" {
			thumbFileName := filepath.Base(thumbLocalPath)
			thumbFile, err := os.Open(thumbLocalPath)
			if err == nil {
				defer thumbFile.Close()
				_, thumbRemoteURL, err = c.OSS.Save(thumbFileName, thumbFile)
				if err != nil {
					log.Printf("[Storage] 警告: 上传缩略图到 OSS 失败: %v", err)
				}
			} else {
				log.Printf("[Storage] 警告: 打开缩略图文件失败，无法上传到 OSS: %v", err)
			}
		}
	}

	return localPath, remoteURL, thumbLocalPath, thumbRemoteURL, width, height, nil
}

func (c *CompositeStorage) Delete(name string) error {
	var errs []string
	if err := c.Local.Delete(name); err != nil {
		errs = append(errs, fmt.Sprintf("本地删除失败: %v", err))
	}

	if c.OSS != nil {
		if err := c.OSS.Delete(name); err != nil {
			errs = append(errs, fmt.Sprintf("OSS 删除失败: %v", err))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("删除过程出错: %s", strings.Join(errs, "; "))
	}
	return nil
}

var GlobalStorage Storage

// InitStorage 初始化存储组件
func InitStorage(localDir string, ossConfig map[string]string) {
	local := &LocalStorage{BaseDir: localDir}

	var ossStorage *OSSStorage
	if ossConfig != nil {
		client, err := oss.New(ossConfig["endpoint"], ossConfig["accessKeyID"], ossConfig["accessKeySecret"])
		if err == nil {
			bucket, err := client.Bucket(ossConfig["bucketName"])
			if err == nil {
				ossStorage = &OSSStorage{
					Bucket: bucket,
					Domain: ossConfig["domain"],
				}
			}
		}
	}

	GlobalStorage = &CompositeStorage{
		Local: local,
		OSS:   ossStorage,
	}
}
