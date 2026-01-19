package api

import (
	"archive/zip"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"image-gen-service/internal/model"

	"github.com/gin-gonic/gin"
)

const maxExportRemoteSize = 50 * 1024 * 1024

type exportImagesRequest struct {
	ImageIDs    []string `json:"imageIds"`
	ImageIDsAlt []string `json:"image_ids"`
}

// ExportImagesHandler exports selected images as a zip archive.
func ExportImagesHandler(c *gin.Context) {
	var req exportImagesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, 400, "参数解析失败")
		return
	}

	ids := req.ImageIDs
	if len(ids) == 0 {
		ids = req.ImageIDsAlt
	}
	if len(ids) == 0 {
		Error(c, http.StatusBadRequest, 400, "imageIds 不能为空")
		return
	}

	var tasks []model.Task
	if err := model.DB.Where("task_id IN ?", ids).Find(&tasks).Error; err != nil {
		Error(c, http.StatusInternalServerError, 500, "查询任务失败")
		return
	}
	if len(tasks) == 0 {
		Error(c, http.StatusNotFound, 404, "未找到可导出的图片")
		return
	}

	taskMap := make(map[string]model.Task, len(tasks))
	for _, task := range tasks {
		taskMap[task.TaskID] = task
	}

	type fileEntry struct {
		name string
		path string
	}
	var files []fileEntry
	var missing []string
	var exportFailed []string

	for _, id := range ids {
		task, ok := taskMap[id]
		if !ok {
			missing = append(missing, fmt.Sprintf("%s: not found", id))
			continue
		}
		localPath := strings.TrimSpace(task.LocalPath)
		if localPath != "" {
			if _, err := os.Stat(localPath); err == nil {
				ext := filepath.Ext(localPath)
				if ext == "" {
					ext = ".jpg"
				}
				files = append(files, fileEntry{
					name: id + ext,
					path: localPath,
				})
				continue
			} else {
				missing = append(missing, fmt.Sprintf("%s: %v", id, err))
			}
		} else {
			missing = append(missing, fmt.Sprintf("%s: local_path empty", id))
		}

		remoteURL := strings.TrimSpace(task.ImageURL)
		if remoteURL == "" {
			remoteURL = strings.TrimSpace(task.ThumbnailURL)
		}
		if remoteURL != "" {
			ext := filepath.Ext(remoteURL)
			if ext == "" {
				if parsed, err := url.Parse(remoteURL); err == nil {
					ext = filepath.Ext(parsed.Path)
				}
			}
			if ext == "" {
				ext = ".jpg"
			}
			files = append(files, fileEntry{
				name: id + ext,
				path: remoteURL,
			})
			continue
		}
		exportFailed = append(exportFailed, fmt.Sprintf("%s: no available file", id))
	}

	if len(files) == 0 {
		Error(c, http.StatusNotFound, 404, "没有可导出的图片")
		return
	}

	hasPartial := len(missing) > 0 || len(exportFailed) > 0
	fileName := fmt.Sprintf("images-%d.zip", time.Now().Unix())
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", fileName))
	if hasPartial {
		c.Header("X-Export-Partial", "true")
	}
	c.Status(http.StatusOK)

	zipWriter := zip.NewWriter(c.Writer)
	defer zipWriter.Close()

	for _, entry := range files {
		if strings.HasPrefix(entry.path, "http://") || strings.HasPrefix(entry.path, "https://") {
			writer, err := zipWriter.Create(entry.name)
			if err != nil {
				exportFailed = append(exportFailed, fmt.Sprintf("%s: %v", entry.name, err))
				hasPartial = true
				continue
			}
			if err := writeRemoteFile(writer, entry.path); err != nil {
				exportFailed = append(exportFailed, fmt.Sprintf("%s: %v", entry.name, err))
				hasPartial = true
			}
			continue
		}

		file, err := os.Open(entry.path)
		if err != nil {
			missing = append(missing, fmt.Sprintf("%s: %v", entry.name, err))
			hasPartial = true
			continue
		}

		writer, err := zipWriter.Create(entry.name)
		if err != nil {
			file.Close()
			exportFailed = append(exportFailed, fmt.Sprintf("%s: %v", entry.name, err))
			hasPartial = true
			continue
		}

		if _, err := io.Copy(writer, file); err != nil {
			missing = append(missing, fmt.Sprintf("%s: %v", entry.name, err))
			hasPartial = true
		}
		file.Close()
	}

	if len(missing) > 0 || len(exportFailed) > 0 {
		hasPartial = true
		if writer, err := zipWriter.Create("missing.txt"); err == nil {
			lines := append([]string{}, missing...)
			lines = append(lines, exportFailed...)
			_, _ = writer.Write([]byte(strings.Join(lines, "\n")))
		}
	}
}

func writeRemoteFile(writer io.Writer, source string) error {
	resp, err := http.Get(source)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("http status %d", resp.StatusCode)
	}

	reader := io.LimitReader(resp.Body, maxExportRemoteSize+1)
	written, err := io.Copy(writer, reader)
	if err != nil {
		return err
	}
	if written > maxExportRemoteSize {
		return fmt.Errorf("remote file exceeds %d bytes", maxExportRemoteSize)
	}
	return nil
}
