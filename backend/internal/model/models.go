package model

import (
	"time"

	"gorm.io/gorm"
)

// ProviderConfig 对应 provider_configs 表，用于存储不同图片生成 API 的配置
type ProviderConfig struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	ProviderName   string         `gorm:"uniqueIndex;not null" json:"provider_name"` // e.g., 'gemini', 'stable-diffusion'
	DisplayName    string         `json:"display_name"`                              // e.g., 'Google Gemini'
	APIBase        string         `json:"api_base"`                                  // API 基础 URL
	APIKey         string         `json:"api_key"`                                   // API 密钥
	Models         string         `json:"models"`                                    // 模型列表 JSON
	Enabled        bool           `gorm:"default:true" json:"enabled"`               // 是否启用
	TimeoutSeconds int            `gorm:"default:150" json:"timeout_seconds"`        // 超时时间
	MaxRetries     int            `gorm:"default:3" json:"max_retries"`              // 最大重试次数
	ExtraConfig    string         `json:"extra_config"`                              // 额外配置 JSON
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

// Task 对应 tasks 表，用于存储生成任务的状态和结果
type Task struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	TaskID         string         `gorm:"uniqueIndex;not null" json:"task_id"`               // 外部调用的唯一 ID
	Prompt         string         `gorm:"index:idx_prompt_search;index" json:"prompt"`       // 提示词，添加复合索引支持搜索
	ProviderName   string         `gorm:"index" json:"provider_name"`                        // 使用的 Provider
	ModelID        string         `gorm:"index" json:"model_id"`                             // 使用的模型 ID
	Status         string         `gorm:"index:idx_status_created;not null" json:"status"`   // 状态，与创建时间组成复合索引
	ErrorMessage   string         `json:"error_message"`                                     // 错误信息
	ImageURL       string         `json:"image_url"`                                         // OSS 访问地址
	LocalPath      string         `json:"local_path"`                                        // 本地存储路径
	ThumbnailURL   string         `json:"thumbnail_url"`                                     // 缩略图 OSS 访问地址
	ThumbnailPath  string         `json:"thumbnail_path"`                                    // 缩略图本地存储路径
	Width          int            `json:"width"`                                             // 图片宽度
	Height         int            `json:"height"`                                            // 图片高度
	TotalCount     int            `gorm:"default:1" json:"total_count"`                      // 申请生成的数量
	ConfigSnapshot string         `json:"config_snapshot"`                                   // 生成时的配置快照
	CreatedAt      time.Time      `gorm:"index:idx_status_created;index" json:"created_at"` // 创建时间
	CompletedAt    *time.Time     `json:"completed_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}
