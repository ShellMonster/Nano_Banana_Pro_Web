package api

import (
	"strings"

	"image-gen-service/internal/diagnostic"
	"image-gen-service/internal/model"
)

func enrichTaskError(task *model.Task) {
	if task == nil {
		return
	}

	raw := strings.TrimSpace(task.ErrorMessage)
	if raw == "" {
		task.ErrorRawMessage = ""
		task.ErrorCode = ""
		task.ErrorCategory = ""
		task.ErrorRequestID = ""
		task.ErrorRetryable = false
		task.ErrorDetail = ""
		return
	}

	summary := diagnostic.SummarizeErrorMessage(raw)
	task.ErrorRawMessage = raw
	task.ErrorCode = summary.Code
	task.ErrorCategory = summary.Category
	task.ErrorRequestID = summary.RequestID
	task.ErrorRetryable = summary.Retryable
	task.ErrorDetail = summary.Detail
	task.ErrorMessage = diagnostic.UserFacingMessage(summary)
}

func enrichTaskErrors(tasks []model.Task) {
	for i := range tasks {
		enrichTaskError(&tasks[i])
	}
}
