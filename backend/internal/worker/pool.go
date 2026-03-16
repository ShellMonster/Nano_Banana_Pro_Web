package worker

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"image-gen-service/internal/diagnostic"
	"image-gen-service/internal/model"
	"image-gen-service/internal/promptopt"
	"image-gen-service/internal/provider"
	"image-gen-service/internal/storage"
)

// Task 表示一个生成任务
type Task struct {
	TaskModel *model.Task
	Params    map[string]interface{}
}

// WorkerPool 任务池结构
type WorkerPool struct {
	workerCount int
	taskQueue   chan *Task
	wg          sync.WaitGroup
	ctx         context.Context
	cancel      context.CancelFunc
	stopping    int32
}

var Pool *WorkerPool

// InitPool 初始化全局任务池
func InitPool(workerCount, queueSize int) {
	ctx, cancel := context.WithCancel(context.Background())
	Pool = &WorkerPool{
		workerCount: workerCount,
		taskQueue:   make(chan *Task, queueSize),
		ctx:         ctx,
		cancel:      cancel,
	}
}

// Start 启动所有 Worker
func (wp *WorkerPool) Start() {
	for i := 0; i < wp.workerCount; i++ {
		wp.wg.Add(1)
		go wp.worker(i)
	}
	log.Printf("Worker 池已启动，Worker 数量: %d", wp.workerCount)
}

// Stop 优雅停止 Worker 池
func (wp *WorkerPool) Stop() {
	atomic.StoreInt32(&wp.stopping, 1)

	// 先 cancel，确保进行中的 provider 调用尽快退出，避免“退出后仍长时间运行”
	wp.cancel()
	close(wp.taskQueue)
	wp.wg.Wait()

	log.Println("Worker 池已停止，进行中的任务已中断，队列遗留任务已标记失败")
}

// Submit 提交任务到队列
func (wp *WorkerPool) Submit(task *Task) (ok bool) {
	if atomic.LoadInt32(&wp.stopping) == 1 {
		return false
	}
	defer func() {
		if recover() != nil {
			ok = false
		}
	}()
	select {
	case wp.taskQueue <- task:
		return true
	default:
		// 队列已满
		return false
	}
}

func (wp *WorkerPool) worker(id int) {
	defer wp.wg.Done()
	log.Printf("Worker %d 启动", id)

	for {
		select {
		case <-wp.ctx.Done():
			log.Printf("Worker %d 收到停止信号", id)
			wp.drainPendingTasks(id)
			return
		case task, ok := <-wp.taskQueue:
			if !ok {
				return
			}
			wp.processTask(task)
		}
	}
}

func (wp *WorkerPool) drainPendingTasks(workerID int) {
	drained := 0
	for {
		select {
		case task, ok := <-wp.taskQueue:
			if !ok {
				if drained > 0 {
					log.Printf("Worker %d 退出前收敛了 %d 个队列遗留任务", workerID, drained)
				}
				return
			}
			if task == nil || task.TaskModel == nil {
				continue
			}
			wp.failTask(task, errors.New(model.STALE_TASK_ERROR_MESSAGE))
			drained++
		default:
			if drained > 0 {
				log.Printf("Worker %d 退出前收敛了 %d 个队列遗留任务", workerID, drained)
			}
			return
		}
	}
}

// processTask 处理单个任务（由 Worker 调用）
func (wp *WorkerPool) processTask(task *Task) {
	defer func() {
		if r := recover(); r != nil {
			err := fmt.Errorf("任务处理异常崩溃: %v", r)
			log.Printf("任务 %s panic: %v\n%s", task.TaskModel.TaskID, r, string(debug.Stack()))
			wp.failTask(task, err)
		}
	}()

	if !task.TaskModel.CreatedAt.IsZero() {
		log.Printf("任务 %s 开始处理: provider=%s model=%s queue_wait=%s", task.TaskModel.TaskID, task.TaskModel.ProviderName, task.TaskModel.ModelID, time.Since(task.TaskModel.CreatedAt))
	} else {
		log.Printf("任务 %s 开始处理: provider=%s model=%s", task.TaskModel.TaskID, task.TaskModel.ProviderName, task.TaskModel.ModelID)
	}
	if task.Params == nil {
		task.Params = map[string]interface{}{}
	}
	diagnostic.AttachTaskID(task.Params, task.TaskModel.TaskID)
	queueWait := time.Duration(0)
	if !task.TaskModel.CreatedAt.IsZero() {
		queueWait = time.Since(task.TaskModel.CreatedAt)
	}
	diagnostic.Logf(task.Params, "worker_start",
		"provider=%s model=%s total_count=%d queue_wait=%s status_before=%s",
		task.TaskModel.ProviderName,
		task.TaskModel.ModelID,
		task.TaskModel.TotalCount,
		queueWait,
		task.TaskModel.Status,
	)

	// 1. 更新状态为 processing
	startedAt := time.Now()
	model.DB.Model(task.TaskModel).Updates(map[string]interface{}{
		"status":                "processing",
		"processing_started_at": &startedAt,
	})

	// 2. 获取 Provider
	p := provider.GetProvider(task.TaskModel.ProviderName)
	if p == nil {
		wp.failTask(task, fmt.Errorf("Provider %s 不存在", task.TaskModel.ProviderName))
		return
	}

	// 3. 调用 API 生成图片（带任务级超时）
	timeout := fetchProviderTimeout(task.TaskModel.ProviderName)
	ctx, cancel := context.WithTimeout(wp.ctx, timeout)
	defer cancel()

	type generateResult struct {
		result *provider.ProviderResult
		err    error
	}

	callStartedAt := time.Now()
	log.Printf("任务 %s 调用 Provider 开始: provider=%s model=%s timeout=%s", task.TaskModel.TaskID, task.TaskModel.ProviderName, task.TaskModel.ModelID, timeout)
	diagnostic.Logf(task.Params, "provider_call_start",
		"provider=%s model=%s timeout=%s prompt_hash=%s prompt_len=%d",
		task.TaskModel.ProviderName,
		task.TaskModel.ModelID,
		timeout,
		diagnostic.PromptHash(task.TaskModel.Prompt),
		len([]rune(task.TaskModel.Prompt)),
	)

		if err := wp.optimizePromptForTask(ctx, task); err != nil {
			log.Printf("任务 %s 自动优化提示词失败，终止生图: %v", task.TaskModel.TaskID, err)
			diagnostic.Logf(task.Params, "prompt_optimize_failed",
				"mode=%s provider=%s model=%s err=%q fallback=%t",
				task.TaskModel.PromptOptimizeMode,
				promptopt.ExtractProvider(task.Params),
				promptopt.ExtractModel(task.Params),
				err.Error(),
				false,
			)
			wp.failTask(task, fmt.Errorf("提示词优化失败: %w", err))
			return
		}

	done := make(chan generateResult, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				done <- generateResult{
					err: fmt.Errorf("Provider 执行异常崩溃: %v", r),
				}
			}
		}()
		result, err := p.Generate(ctx, task.Params)
		elapsed := time.Since(callStartedAt)
		if err != nil {
			log.Printf("任务 %s 调用 Provider 失败: provider=%s model=%s elapsed=%s err=%v", task.TaskModel.TaskID, task.TaskModel.ProviderName, task.TaskModel.ModelID, elapsed, err)
			summary := diagnostic.SummarizeError(err)
			diagnostic.Logf(task.Params, "provider_call_error",
				"provider=%s model=%s elapsed=%s error_type=%s error_code=%s category=%s retryable=%t request_id=%s user_message=%q raw_error=%q",
				task.TaskModel.ProviderName,
				task.TaskModel.ModelID,
				elapsed,
				summary.Type,
				summary.Code,
				summary.Category,
				summary.Retryable,
				summary.RequestID,
				summary.UserMessage,
				err.Error(),
			)
		} else {
			imageCount := 0
			if result != nil {
				imageCount = len(result.Images)
			}
			log.Printf("任务 %s 调用 Provider 成功: provider=%s model=%s elapsed=%s images=%d", task.TaskModel.TaskID, task.TaskModel.ProviderName, task.TaskModel.ModelID, elapsed, imageCount)
			diagnostic.Logf(task.Params, "provider_call_success",
				"provider=%s model=%s elapsed=%s images=%d metadata=%v",
				task.TaskModel.ProviderName,
				task.TaskModel.ModelID,
				elapsed,
				imageCount,
				func() map[string]interface{} {
					if result == nil || result.Metadata == nil {
						return map[string]interface{}{}
					}
					return result.Metadata
				}(),
			)
		}
		done <- generateResult{result: result, err: err}
	}()

	var result *provider.ProviderResult
	select {
	case <-ctx.Done():
		err := ctx.Err()
		if errors.Is(err, context.DeadlineExceeded) {
			wp.failTask(task, fmt.Errorf("生成超时(%s)", timeout))
		} else {
			wp.failTask(task, err)
		}
		return
	case out := <-done:
		if out.err != nil {
			if errors.Is(out.err, context.DeadlineExceeded) {
				wp.failTask(task, fmt.Errorf("生成超时(%s)", timeout))
			} else {
				wp.failTask(task, out.err)
			}
			return
		}
		result = out.result
	}

	// 记录配置快照
	configSnapshot := ""
	if task.TaskModel.ModelID != "" {
		configSnapshot = fmt.Sprintf("Model: %s", task.TaskModel.ModelID)
	}

	// 4. 存储图片（含缩略图生成）
	// 文件后缀由 storage 层根据实际图片格式自动确定
	if len(result.Images) > 0 {
		// 传入基础文件名（无后缀），storage 会根据实际格式添加正确后缀
		baseFileName := task.TaskModel.TaskID
		// 警告：当前只保存第一张图片，其余丢弃
		if len(result.Images) > 1 {
			log.Printf("任务 %s 生成了 %d 张图片，当前只保存第1张，其余 %d 张已丢弃", task.TaskModel.TaskID, len(result.Images), len(result.Images)-1)
		}
		diagnostic.Logf(task.Params, "storage_start",
			"image_count=%d first_image_bytes=%d",
			len(result.Images),
			len(result.Images[0]),
		)
		reader := bytes.NewReader(result.Images[0])
		localPath, remoteURL, thumbLocalPath, thumbRemoteURL, width, height, err := storage.GlobalStorage.SaveWithThumbnail(baseFileName, reader)
		if err != nil {
			wp.failTask(task, err)
			return
		}

		// 5. 更新成功状态
		now := time.Now()
		updates := map[string]interface{}{
			"status":         "completed",
			"image_url":      remoteURL,
			"local_path":     localPath,
			"thumbnail_url":  thumbRemoteURL,
			"thumbnail_path": thumbLocalPath,
			"width":          width,
			"height":         height,
			"completed_at":   &now,
		}

		// 兼容：历史版本可能未写入 config_snapshot，这里只在为空时补充
		if task.TaskModel.ConfigSnapshot == "" && configSnapshot != "" {
			updates["config_snapshot"] = configSnapshot
		}

		if dbResult := model.DB.Model(task.TaskModel).Updates(updates); dbResult.Error != nil {
			log.Printf("任务 %s 数据库更新失败（图片文件已保存至磁盘）: %v", task.TaskModel.TaskID, dbResult.Error)
		} else {
			log.Printf("任务 %s 处理完成", task.TaskModel.TaskID)
			diagnostic.Logf(task.Params, "storage_success",
				"local_path=%q remote_url=%q thumbnail_path=%q thumbnail_url=%q width=%d height=%d",
				localPath,
				remoteURL,
				thumbLocalPath,
				thumbRemoteURL,
				width,
				height,
			)
			diagnostic.Logf(task.Params, "db_update_success",
				"status=%s completed_at=%s",
				"completed",
				now.Format(time.RFC3339Nano),
			)
		}
	} else {
		wp.failTask(task, fmt.Errorf("未生成任何图片"))
	}
}

func (wp *WorkerPool) optimizePromptForTask(ctx context.Context, task *Task) error {
	if task == nil || task.TaskModel == nil {
		return nil
	}
	mode := promptopt.NormalizeMode(task.TaskModel.PromptOptimizeMode)
	if !promptopt.Enabled(mode) {
		return nil
	}

	rawPrompt := strings.TrimSpace(task.TaskModel.PromptOriginal)
	if rawPrompt == "" {
		rawPrompt = promptopt.ExtractOriginalPrompt(task.Params)
	}
	if rawPrompt == "" {
		rawPrompt = strings.TrimSpace(task.TaskModel.Prompt)
	}
	if rawPrompt == "" {
		rawPrompt = promptopt.ExtractPrompt(task.Params)
	}
	if rawPrompt == "" {
		return fmt.Errorf("原始提示词为空")
	}

	optProvider := promptopt.ExtractProvider(task.Params)
	optModel := promptopt.ExtractModel(task.Params)
	startedAt := time.Now()
	diagnostic.Logf(task.Params, "prompt_optimize_start",
		"mode=%s provider=%s model=%s prompt_hash=%s prompt_len=%d",
		mode,
		optProvider,
		optModel,
		diagnostic.PromptHash(rawPrompt),
		len([]rune(rawPrompt)),
	)

	result, err := promptopt.OptimizePrompt(ctx, promptopt.Request{
		Provider: optProvider,
		Model:    optModel,
		Prompt:   rawPrompt,
		Mode:     mode,
	})
	if err != nil {
		return err
	}

	optimized := strings.TrimSpace(result.Prompt)
	if optimized == "" || optimized == rawPrompt {
		task.TaskModel.PromptOriginal = rawPrompt
		task.TaskModel.Prompt = rawPrompt
		task.TaskModel.PromptOptimized = ""
		return nil
	}

	updates := map[string]interface{}{
		"prompt_original":      rawPrompt,
		"prompt_optimized":     optimized,
		"prompt":               optimized,
		"prompt_optimize_mode": mode,
	}
	if err := model.DB.Model(task.TaskModel).Updates(updates).Error; err != nil {
		return fmt.Errorf("保存优化后的提示词失败: %w", err)
	}

	task.TaskModel.PromptOriginal = rawPrompt
	task.TaskModel.PromptOptimized = optimized
	task.TaskModel.Prompt = optimized
	if task.Params == nil {
		task.Params = map[string]interface{}{}
	}
	task.Params["prompt_original"] = rawPrompt
	task.Params["prompt_optimized"] = optimized
	task.Params["prompt"] = optimized
	task.Params["prompt_optimize_mode"] = mode
	task.Params["prompt_optimize_provider"] = result.Provider
	task.Params["prompt_optimize_model"] = result.Model

	diagnostic.Logf(task.Params, "prompt_optimize_success",
		"mode=%s provider=%s model=%s elapsed=%s original_hash=%s optimized_hash=%s optimized_len=%d",
		mode,
		result.Provider,
		result.Model,
		time.Since(startedAt),
		diagnostic.PromptHash(rawPrompt),
		diagnostic.PromptHash(optimized),
		len([]rune(optimized)),
	)
	return nil
}

func (wp *WorkerPool) failTask(task *Task, err error) {
	if task == nil || task.TaskModel == nil {
		log.Printf("任务失败，但任务信息缺失: %v", err)
		return
	}
	taskModel := task.TaskModel
	log.Printf("任务 %s 失败: %v", taskModel.TaskID, err)
	params := task.Params
	if params == nil {
		params = map[string]interface{}{}
	}
	diagnostic.AttachTaskID(params, taskModel.TaskID)
	summary := diagnostic.SummarizeError(err)
	diagnostic.Logf(params, "task_failed",
		"provider=%s model=%s error_type=%s error_code=%s category=%s retryable=%t request_id=%s user_message=%q raw_error=%q",
		taskModel.ProviderName,
		taskModel.ModelID,
		summary.Type,
		summary.Code,
		summary.Category,
		summary.Retryable,
		summary.RequestID,
		summary.UserMessage,
		err.Error(),
	)
	if dbResult := model.DB.Model(taskModel).Updates(map[string]interface{}{
		"status":        "failed",
		"error_message": err.Error(),
	}); dbResult.Error != nil {
		log.Printf("任务 %s 写入失败状态到数据库时出错: %v", taskModel.TaskID, dbResult.Error)
	}
}

func fetchProviderTimeout(providerName string) time.Duration {
	name := strings.TrimSpace(strings.ToLower(providerName))
	if strings.HasPrefix(name, "gemini") {
		name = "gemini"
	} else if strings.HasPrefix(name, "openai") {
		name = "openai"
	}

	defaultTimeout := func(p string) time.Duration {
		switch p {
		case "gemini", "openai":
			return 500 * time.Second
		default:
			return 150 * time.Second
		}
	}

	if model.DB == nil || name == "" {
		return defaultTimeout(name)
	}
	var cfg model.ProviderConfig
	if err := model.DB.Select("timeout_seconds").Where("provider_name = ?", name).First(&cfg).Error; err != nil {
		return defaultTimeout(name)
	}
	if cfg.TimeoutSeconds <= 0 {
		return defaultTimeout(name)
	}
	return time.Duration(cfg.TimeoutSeconds) * time.Second
}
