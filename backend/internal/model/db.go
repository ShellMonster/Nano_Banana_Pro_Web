package model

import (
	"log"
	"strconv"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

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

	log.Println("数据库初始化成功")

	// 异步迁移旧任务到月份文件夹
	go migrateOldTasksToMonthFolders()
}

// migrateOldTasksToMonthFolders 将旧版本未归类的任务自动迁移到月份文件夹
func migrateOldTasksToMonthFolders() {
	// 延迟几秒等待数据库完全初始化
	time.Sleep(2 * time.Second)

	log.Println("[Migration] 开始迁移旧任务到月份文件夹...")

	// 文件夹缓存: key="2006-01" (年份-月份), value=文件夹ID
	folderCache := make(map[string]uint)

	batchSize := 100
	offset := 0
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
		// 分批查询未归类的任务
		result := DB.Where("folder_id = ? OR folder_id IS NULL", "").
			Limit(batchSize).
			Offset(offset).
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

		// 下一批任务
		offset += len(tasks)
		log.Printf("[Migration] 已处理 %d/%d 个任务，继续下一批...\n", offset, totalTasks)
	}

	log.Printf("[Migration] 迁移完成: %d/%d 个任务已归类\n", totalMigrated, totalTasks)
}
