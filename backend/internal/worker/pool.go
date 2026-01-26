package worker

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"image-gen-service/internal/model"
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
	// 1. 首先关闭任务队列通道，不再接收新提交的任务
	// 已经提交到通道中的任务会继续保留在通道中
	close(wp.taskQueue)

	// 2. 等待所有正在运行的 Worker 完成任务
	// 由于通道已关闭，Worker 会在处理完通道中剩余的所有任务后退出
	wp.wg.Wait()

	// 3. 最后取消 Context，通知所有依赖该 Context 的操作（如正在进行的 HTTP 请求）停止
	wp.cancel()

	log.Println("Worker 池已优雅停止，所有队列中的任务已处理完毕")
}

// Submit 提交任务到队列
func (wp *WorkerPool) Submit(task *Task) bool {
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
			return
		case task, ok := <-wp.taskQueue:
			if !ok {
				return
			}
			wp.processTask(task)
		}
	}
}

// processTask 处理单个任务（由 Worker 调用）
func (wp *WorkerPool) processTask(task *Task) {
	// 1. 更新状态为 processing
	model.DB.Model(task.TaskModel).Update("status", "processing")

	// 2. 获取 Provider
	p := provider.GetProvider(task.TaskModel.ProviderName)
	if p == nil {
		wp.failTask(task.TaskModel, fmt.Errorf("Provider %s 不存在", task.TaskModel.ProviderName))
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

	done := make(chan generateResult, 1)
	go func() {
		result, err := p.Generate(ctx, task.Params)
		done <- generateResult{result: result, err: err}
	}()

	var result *provider.ProviderResult
	select {
	case <-ctx.Done():
		err := ctx.Err()
		if errors.Is(err, context.DeadlineExceeded) {
			wp.failTask(task.TaskModel, fmt.Errorf("生成超时(%s)", timeout))
		} else {
			wp.failTask(task.TaskModel, err)
		}
		return
	case out := <-done:
		if out.err != nil {
			if errors.Is(out.err, context.DeadlineExceeded) {
				wp.failTask(task.TaskModel, fmt.Errorf("生成超时(%s)", timeout))
			} else {
				wp.failTask(task.TaskModel, out.err)
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
	if len(result.Images) > 0 {
		fileName := fmt.Sprintf("%s.jpg", task.TaskModel.TaskID)
		reader := bytes.NewReader(result.Images[0])
		localPath, remoteURL, thumbLocalPath, thumbRemoteURL, width, height, err := storage.GlobalStorage.SaveWithThumbnail(fileName, reader)
		if err != nil {
			wp.failTask(task.TaskModel, err)
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

		model.DB.Model(task.TaskModel).Updates(updates)
		log.Printf("任务 %s 处理完成", task.TaskModel.TaskID)
	} else {
		wp.failTask(task.TaskModel, fmt.Errorf("未生成任何图片"))
	}
}

func (wp *WorkerPool) failTask(taskModel *model.Task, err error) {
	log.Printf("任务 %s 失败: %v", taskModel.TaskID, err)
	model.DB.Model(taskModel).Updates(map[string]interface{}{
		"status":        "failed",
		"error_message": err.Error(),
	})
}

func fetchProviderTimeout(providerName string) time.Duration {
	if model.DB == nil || providerName == "" {
		return 150 * time.Second
	}
	var cfg model.ProviderConfig
	if err := model.DB.Select("timeout_seconds").Where("provider_name = ?", providerName).First(&cfg).Error; err != nil {
		return 150 * time.Second
	}
	if cfg.TimeoutSeconds <= 0 {
		return 150 * time.Second
	}
	return time.Duration(cfg.TimeoutSeconds) * time.Second
}
