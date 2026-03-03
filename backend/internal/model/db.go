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

	// 查询所有未归类的任务（folder_id 为空或空字符串）
	var tasks []Task
	if err := DB.Where("folder_id = ? OR folder_id IS NULL", "").Find(&tasks).Error; err != nil {
		log.Printf("[Migration] 查询未归类任务失败: %v\n", err)
		return
	}

	if len(tasks) == 0 {
		log.Println("[Migration] 没有需要迁移的任务")
		return
	}

	log.Printf("[Migration] 发现 %d 个需要迁移的任务\n", len(tasks))

	// 迁移每个任务（每个任务使用独立事务）
	migratedCount := 0
	for _, task := range tasks {
		// 使用事务确保每个任务的迁移是原子操作
		err := DB.Transaction(func(tx *gorm.DB) error {
			// 根据任务创建时间获取或创建月份文件夹
			year := task.CreatedAt.Year()
			month := int(task.CreatedAt.Month())
			folderName := task.CreatedAt.Format("2006-01")

			folder := Folder{
				Type:  "month",
				Year:  year,
				Month: month,
			}

			// 使用 FirstOrCreate 确保文件夹存在（在事务内）
			result := tx.Where(Folder{
				Type:  "month",
				Year:  year,
				Month: month,
			}).Attrs(Folder{
				Name: folderName,
			}).FirstOrCreate(&folder)

			if result.Error != nil {
				return result.Error // 返回错误会自动回滚事务
			}

			// 更新任务的 folder_id（在事务内）
			folderIDStr := strconv.FormatUint(uint64(folder.ID), 10)
			if err := tx.Model(&task).Update("folder_id", folderIDStr).Error; err != nil {
				return err // 返回错误会自动回滚事务
			}

			return nil // 返回 nil 会自动提交事务
		})

		if err != nil {
			log.Printf("[Migration] 迁移任务 %s 失败: %v\n", task.TaskID, err)
			continue // 单个任务失败不影响其他任务
		}

		migratedCount++
	}

	log.Printf("[Migration] 迁移完成: %d/%d 个任务已归类\n", migratedCount, len(tasks))
}
