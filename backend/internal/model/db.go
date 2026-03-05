package model

import (
	"log"
	"strconv"
	"sync"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

const STALE_TASK_ERROR_MESSAGE = "任务因应用重启中断，请重新生成"
const ZOMBIE_TASK_ERROR_MESSAGE = "任务超时未完成，请重试"

var zombieReconciler struct {
	mu      sync.Mutex
	started bool
	stopCh  chan struct{}
	doneCh  chan struct{}
}

// InitDB 初始化 SQLite 数据库
func InitDB(dbPath string) {
	var err error
	DB, err = gorm.Open(sqlite.Open(dbPath+"?_busy_timeout=5000"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		log.Fatalf("无法连接数据库: %v", err)
	}

	// 设置连接池参数
	sqlDB, err := DB.DB()
	if err == nil {
		sqlDB.SetMaxOpenConns(1) // SQLite 建议写操作时设置为 1，或者使用 WAL 模式
		sqlDB.SetMaxIdleConns(1)
		sqlDB.SetConnMaxLifetime(time.Hour)
	}

	// 自动迁移表结构
	err = DB.AutoMigrate(&ProviderConfig{}, &Task{}, &Folder{})
	if err != nil {
		log.Fatalf("数据库迁移失败: %v", err)
	}

	// 兼容旧版本默认超时（0/60s）记录：按 Provider 类型修复到对应默认值
	if err := DB.Model(&ProviderConfig{}).
		Where("provider_name IN ? AND (timeout_seconds <= 0 OR timeout_seconds = ?)", []string{"gemini", "openai"}, 60).
		Update("timeout_seconds", 500).Error; err != nil {
		log.Printf("更新生图默认超时失败: %v", err)
	}
	if err := DB.Model(&ProviderConfig{}).
		Where("provider_name NOT IN ? AND (timeout_seconds <= 0 OR timeout_seconds = ?)", []string{"gemini", "openai"}, 60).
		Update("timeout_seconds", 150).Error; err != nil {
		log.Printf("更新对话默认超时失败: %v", err)
	}

	reconcileStaleActiveTasks()
	startZombieTaskReconciler()

	log.Println("数据库初始化成功")

	// 异步迁移旧任务到月份文件夹
	go migrateOldTasksToMonthFolders()
}

func defaultTimeoutForProvider(providerName string) time.Duration {
	switch providerName {
	case "gemini", "openai":
		return 500 * time.Second
	default:
		return 150 * time.Second
	}
}

func startZombieTaskReconciler() {
	zombieReconciler.mu.Lock()
	defer zombieReconciler.mu.Unlock()
	if zombieReconciler.started {
		return
	}
	zombieReconciler.started = true
	zombieReconciler.stopCh = make(chan struct{})
	zombieReconciler.doneCh = make(chan struct{})

	const checkInterval = time.Minute
	ticker := time.NewTicker(checkInterval)
	go func() {
		defer close(zombieReconciler.doneCh)
		defer ticker.Stop()

		reconcileTimedOutActiveTasks()
		for {
			select {
			case <-zombieReconciler.stopCh:
				return
			case <-ticker.C:
				reconcileTimedOutActiveTasks()
			}
		}
	}()
}

func StopZombieTaskReconciler() {
	zombieReconciler.mu.Lock()
	if !zombieReconciler.started {
		zombieReconciler.mu.Unlock()
		return
	}
	stopCh := zombieReconciler.stopCh
	doneCh := zombieReconciler.doneCh
	zombieReconciler.started = false
	zombieReconciler.stopCh = nil
	zombieReconciler.doneCh = nil
	zombieReconciler.mu.Unlock()

	close(stopCh)
	<-doneCh
}

func reconcileStaleActiveTasks() {
	now := time.Now()
	updates := map[string]interface{}{
		"status":        "failed",
		"error_message": STALE_TASK_ERROR_MESSAGE,
		"completed_at":  now,
	}

	result := DB.Model(&Task{}).
		Where("status IN ?", []string{"pending", "processing"}).
		Updates(updates)
	if result.Error != nil {
		log.Printf("收敛遗留任务状态失败: %v", result.Error)
		return
	}
	if result.RowsAffected > 0 {
		log.Printf("已收敛 %d 个遗留任务（pending/processing -> failed）", result.RowsAffected)
	}
}

func reconcileTimedOutActiveTasks() {
	const timeoutGrace = 10 * time.Second
	const batchSize = 500

	timeoutMap := make(map[string]time.Duration)
	var configs []ProviderConfig
	if err := DB.Select("provider_name", "timeout_seconds").Find(&configs).Error; err != nil {
		log.Printf("获取 provider 超时配置失败: %v, 将使用默认超时", err)
	} else {
		for _, cfg := range configs {
			if cfg.TimeoutSeconds > 0 {
				timeoutMap[cfg.ProviderName] = time.Duration(cfg.TimeoutSeconds) * time.Second
			}
		}
	}

	var lastID uint
	for {
		now := time.Now()
		var activeTasks []Task
		if err := DB.Select("id", "task_id", "provider_name", "status", "created_at", "processing_started_at").
			Where("status IN ?", []string{"pending", "processing"}).
			Where("id > ?", lastID).
			Order("id ASC").
			Limit(batchSize).
			Find(&activeTasks).Error; err != nil {
			log.Printf("扫描超时任务失败: %v", err)
			return
		}
		if len(activeTasks) == 0 {
			return
		}

		staleTaskIDs := make([]string, 0)
		for _, task := range activeTasks {
			timeout := timeoutMap[task.ProviderName]
			if timeout <= 0 {
				timeout = defaultTimeoutForProvider(task.ProviderName)
			}
			startAt := task.CreatedAt
			if task.ProcessingStartedAt != nil && !task.ProcessingStartedAt.IsZero() {
				startAt = *task.ProcessingStartedAt
			}
			if now.Sub(startAt) > timeout+timeoutGrace {
				staleTaskIDs = append(staleTaskIDs, task.TaskID)
			}
			lastID = task.ID
		}

		if len(staleTaskIDs) > 0 {
			updates := map[string]interface{}{
				"status":        "failed",
				"error_message": ZOMBIE_TASK_ERROR_MESSAGE,
				"completed_at":  now,
			}
			result := DB.Model(&Task{}).
				Where("task_id IN ?", staleTaskIDs).
				Where("status IN ?", []string{"pending", "processing"}).
				Updates(updates)
			if result.Error != nil {
				log.Printf("收敛超时任务失败: %v", result.Error)
				return
			}
			if result.RowsAffected > 0 {
				log.Printf("已收敛 %d 个超时任务（pending/processing -> failed）", result.RowsAffected)
			}
		}
	}
}

// migrateOldTasksToMonthFolders 将旧版本未归类的任务自动迁移到月份文件夹
func migrateOldTasksToMonthFolders() {
	// 添加 panic 恢复机制，防止迁移过程中的意外错误导致服务崩溃
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[Migration] 迁移过程发生严重错误: %v\n", r)
		}
	}()

	// 延迟几秒等待数据库完全初始化
	// 原因：确保 InitDB() 中的其他初始化操作已完成，避免并发问题
	time.Sleep(2 * time.Second)

	log.Println("[Migration] 开始迁移旧任务到月份文件夹...")

	// 文件夹缓存: key="2006-01" (年份-月份), value=文件夹ID
	folderCache := make(map[string]uint)

	batchSize := 100
	processed := 0
	totalMigrated := 0
	var totalTasks int64

	// 先统计总数（用于日志）
	DB.Model(&Task{}).Where("folder_id = ? OR folder_id IS NULL", "").Count(&totalTasks)
	if totalTasks == 0 {
		log.Println("[Migration] 没有需要迁移的任务")
		return
	}
	log.Printf("[Migration] 发现 %d 个需要迁移的任务\n", totalTasks)

	// 分批处理任务
	for {
		var tasks []Task
		// 每批都从当前剩余未归类任务中取前 N 条，避免更新后使用 offset 漏扫
		result := DB.Where("folder_id = ? OR folder_id IS NULL", "").
			Order("id ASC").
			Limit(batchSize).
			Find(&tasks)

		if result.Error != nil {
			log.Printf("[Migration] 查询未归类任务失败: %v\n", result.Error)
			return
		}

		// 没有更多任务了
		if len(tasks) == 0 {
			break
		}

		// 处理这一批任务
		for _, task := range tasks {
			// 根据任务创建时间获取月份文件夹key
			folderKey := task.CreatedAt.Format("2006-01")

			// 从缓存获取文件夹ID
			folderID, exists := folderCache[folderKey]
			if !exists {
				// 缓存中没有，需要查询或创建文件夹
				year := task.CreatedAt.Year()
				month := int(task.CreatedAt.Month())

				folder := Folder{
					Type:  "month",
					Year:  year,
					Month: month,
				}

				// 使用事务确保文件夹创建是原子操作
				err := DB.Transaction(func(tx *gorm.DB) error {
					result := tx.Where(Folder{
						Type:  "month",
						Year:  year,
						Month: month,
					}).Attrs(Folder{
						Name: folderKey,
					}).FirstOrCreate(&folder)

					if result.Error != nil {
						return result.Error
					}
					return nil
				})

				if err != nil {
					log.Printf("[Migration] 创建文件夹失败 (%s): %v\n", folderKey, err)
					continue
				}

				// 缓存文件夹ID
				folderCache[folderKey] = folder.ID
				folderID = folder.ID
			}

			// 更新任务的 folder_id
			folderIDStr := strconv.FormatUint(uint64(folderID), 10)
			if err := DB.Model(&task).Update("folder_id", folderIDStr).Error; err != nil {
				log.Printf("[Migration] 更新任务 %s 失败: %v\n", task.TaskID, err)
				continue
			}

			totalMigrated++
		}

		processed += len(tasks)
		log.Printf("[Migration] 已处理 %d/%d 个任务，继续下一批...\n", processed, totalTasks)
	}

	log.Printf("[Migration] 迁移完成: %d/%d 个任务已归类\n", totalMigrated, totalTasks)
}
