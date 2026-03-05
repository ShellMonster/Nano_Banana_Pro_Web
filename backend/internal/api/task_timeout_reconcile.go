package api

import (
	"context"
	"strings"
	"sync/atomic"
	"time"

	"image-gen-service/internal/model"
)

const onDemandTimeoutGrace = 60 * time.Second
const activeReconcileMinInterval = 10 * time.Second
const activeReconcileScanBatchSize = 500
const activeReconcileUpdateBatchSize = 200

var activeReconcileLastRunMs int64
var activeReconcileRunning int32

func loadProviderTimeoutMap(ctx context.Context) (map[string]time.Duration, error) {
	result := make(map[string]time.Duration)

	var configs []model.ProviderConfig
	if err := model.DB.WithContext(ctx).Select("provider_name", "timeout_seconds").Find(&configs).Error; err != nil {
		return result, err
	}

	for _, cfg := range configs {
		name := normalizeProviderForTimeout(cfg.ProviderName)
		if name == "" || cfg.TimeoutSeconds <= 0 {
			continue
		}
		result[name] = time.Duration(cfg.TimeoutSeconds) * time.Second
	}

	return result, nil
}

func normalizeProviderForTimeout(providerName string) string {
	name := strings.TrimSpace(strings.ToLower(providerName))
	switch {
	case strings.HasPrefix(name, "gemini"):
		return "gemini"
	case strings.HasPrefix(name, "openai"):
		return "openai"
	default:
		return name
	}
}

func taskTimeoutForProvider(providerName string, timeoutMap map[string]time.Duration) time.Duration {
	name := normalizeProviderForTimeout(providerName)
	if timeout, ok := timeoutMap[name]; ok && timeout > 0 {
		return timeout
	}
	return time.Duration(defaultTimeoutSecondsForProvider(name)) * time.Second
}

func isTaskTimedOut(task model.Task, now time.Time, timeoutMap map[string]time.Duration) bool {
	if task.Status != "pending" && task.Status != "processing" {
		return false
	}
	timeout := taskTimeoutForProvider(task.ProviderName, timeoutMap)
	return now.Sub(task.CreatedAt) > timeout+onDemandTimeoutGrace
}

func reconcileSingleTaskTimeoutOnDemand(ctx context.Context, task *model.Task) (bool, error) {
	if task == nil {
		return false, nil
	}

	timeoutMap, err := loadProviderTimeoutMap(ctx)
	if err != nil {
		timeoutMap = map[string]time.Duration{}
	}
	now := time.Now()
	if !isTaskTimedOut(*task, now, timeoutMap) {
		return false, nil
	}

	updates := map[string]interface{}{
		"status":        "failed",
		"error_message": model.ZOMBIE_TASK_ERROR_MESSAGE,
		"completed_at":  now,
	}

	result := model.DB.WithContext(ctx).
		Model(&model.Task{}).
		Where("task_id = ?", task.TaskID).
		Where("status IN ?", []string{"pending", "processing"}).
		Updates(updates)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 0 {
		return false, nil
	}

	task.Status = "failed"
	task.ErrorMessage = model.ZOMBIE_TASK_ERROR_MESSAGE
	task.CompletedAt = &now
	return true, nil
}

func reconcileActiveTasksTimeoutOnDemand(ctx context.Context) error {
	nowMs := time.Now().UnixMilli()
	last := atomic.LoadInt64(&activeReconcileLastRunMs)
	if nowMs-last < activeReconcileMinInterval.Milliseconds() {
		return nil
	}
	if !atomic.CompareAndSwapInt32(&activeReconcileRunning, 0, 1) {
		return nil
	}
	defer atomic.StoreInt32(&activeReconcileRunning, 0)

	timeoutMap, err := loadProviderTimeoutMap(ctx)
	if err != nil {
		return err
	}
	now := time.Now()
	var lastID uint

	for {
		var activeTasks []model.Task
		if err := model.DB.WithContext(ctx).
			Select("id", "task_id", "status", "provider_name", "created_at").
			Where("status IN ?", []string{"pending", "processing"}).
			Where("id > ?", lastID).
			Order("id ASC").
			Limit(activeReconcileScanBatchSize).
			Find(&activeTasks).Error; err != nil {
			return err
		}

		if len(activeTasks) == 0 {
			atomic.StoreInt64(&activeReconcileLastRunMs, nowMs)
			return nil
		}

		staleTaskIDs := make([]string, 0)
		for _, task := range activeTasks {
			if isTaskTimedOut(task, now, timeoutMap) {
				staleTaskIDs = append(staleTaskIDs, task.TaskID)
			}
			lastID = task.ID
		}

		if len(staleTaskIDs) == 0 {
			continue
		}

		updates := map[string]interface{}{
			"status":        "failed",
			"error_message": model.ZOMBIE_TASK_ERROR_MESSAGE,
			"completed_at":  now,
		}
		for i := 0; i < len(staleTaskIDs); i += activeReconcileUpdateBatchSize {
			end := i + activeReconcileUpdateBatchSize
			if end > len(staleTaskIDs) {
				end = len(staleTaskIDs)
			}
			batch := staleTaskIDs[i:end]
			if err := model.DB.WithContext(ctx).
				Model(&model.Task{}).
				Where("task_id IN ?", batch).
				Where("status IN ?", []string{"pending", "processing"}).
				Updates(updates).Error; err != nil {
				return err
			}
		}
	}
}
