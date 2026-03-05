package api

import (
	"context"
	"strings"
	"time"

	"image-gen-service/internal/model"
)

const onDemandTimeoutGrace = 60 * time.Second

func loadProviderTimeoutMap(ctx context.Context) map[string]time.Duration {
	result := make(map[string]time.Duration)

	var configs []model.ProviderConfig
	if err := model.DB.WithContext(ctx).Select("provider_name", "timeout_seconds").Find(&configs).Error; err != nil {
		return result
	}

	for _, cfg := range configs {
		name := strings.TrimSpace(strings.ToLower(cfg.ProviderName))
		if name == "" || cfg.TimeoutSeconds <= 0 {
			continue
		}
		result[name] = time.Duration(cfg.TimeoutSeconds) * time.Second
	}

	return result
}

func taskTimeoutForProvider(providerName string, timeoutMap map[string]time.Duration) time.Duration {
	name := strings.TrimSpace(strings.ToLower(providerName))
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

	timeoutMap := loadProviderTimeoutMap(ctx)
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
	timeoutMap := loadProviderTimeoutMap(ctx)
	now := time.Now()

	var activeTasks []model.Task
	if err := model.DB.WithContext(ctx).
		Select("task_id", "status", "provider_name", "created_at").
		Where("status IN ?", []string{"pending", "processing"}).
		Find(&activeTasks).Error; err != nil {
		return err
	}

	if len(activeTasks) == 0 {
		return nil
	}

	staleTaskIDs := make([]string, 0)
	for _, task := range activeTasks {
		if isTaskTimedOut(task, now, timeoutMap) {
			staleTaskIDs = append(staleTaskIDs, task.TaskID)
		}
	}
	if len(staleTaskIDs) == 0 {
		return nil
	}

	updates := map[string]interface{}{
		"status":        "failed",
		"error_message": model.ZOMBIE_TASK_ERROR_MESSAGE,
		"completed_at":  now,
	}
	return model.DB.WithContext(ctx).
		Model(&model.Task{}).
		Where("task_id IN ?", staleTaskIDs).
		Where("status IN ?", []string{"pending", "processing"}).
		Updates(updates).Error
}
