package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"image-gen-service/internal/model"

	"github.com/gin-gonic/gin"
)

const (
	taskStreamPollInterval = 1 * time.Second
	taskStreamKeepAlive    = 3 * time.Second
)

// StreamTaskHandler streams task status updates via SSE.
func StreamTaskHandler(c *gin.Context) {
	taskID := c.Param("task_id")

	var task model.Task
	if err := model.DB.Where("task_id = ?", taskID).First(&task).Error; err != nil {
		Error(c, http.StatusNotFound, 404, "任务未找到")
		return
	}

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		Error(c, http.StatusInternalServerError, 500, "Streaming unsupported")
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	lastSignature := taskSignature(&task)
	if !writeTaskEvent(c.Writer, flusher, &task) {
		return
	}

	ticker := time.NewTicker(taskStreamPollInterval)
	defer ticker.Stop()
	keepAliveTicker := time.NewTicker(taskStreamKeepAlive)
	defer keepAliveTicker.Stop()

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
			var latest model.Task
			if err := model.DB.Where("task_id = ?", taskID).First(&latest).Error; err != nil {
				return
			}

			signature := taskSignature(&latest)
			if signature != lastSignature {
				if !writeTaskEvent(c.Writer, flusher, &latest) {
					return
				}
				lastSignature = signature
			}

			if latest.Status == "completed" || latest.Status == "failed" {
				return
			}
		case <-keepAliveTicker.C:
			if _, err := fmt.Fprintf(c.Writer, "event: ping\ndata: {}\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func writeTaskEvent(w http.ResponseWriter, flusher http.Flusher, task *model.Task) bool {
	payload, err := json.Marshal(task)
	if err != nil {
		return false
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", payload); err != nil {
		return false
	}
	flusher.Flush()
	return true
}

func taskSignature(task *model.Task) string {
	completedAt := ""
	if task.CompletedAt != nil {
		completedAt = task.CompletedAt.UTC().Format(time.RFC3339Nano)
	}
	return fmt.Sprintf("%s|%s|%s|%s|%s|%s|%d|%d|%d|%s",
		task.Status,
		task.ErrorMessage,
		task.ImageURL,
		task.ThumbnailURL,
		task.LocalPath,
		task.ThumbnailPath,
		task.TotalCount,
		task.Width,
		task.Height,
		completedAt,
	)
}
