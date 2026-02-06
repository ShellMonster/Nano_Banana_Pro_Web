package model

import (
	"log"
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
	err = DB.AutoMigrate(&ProviderConfig{}, &Task{})
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
}
