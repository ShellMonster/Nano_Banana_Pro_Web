package provider

import (
	"context"
	"image-gen-service/internal/config"
	"image-gen-service/internal/model"
	"log"
	"sync"
)

// ProviderResult 图片生成结果
type ProviderResult struct {
	Images   [][]byte               // 图片原始数据列表
	Metadata map[string]interface{} // 额外信息
}

// Provider 定义图片生成接口
type Provider interface {
	Name() string
	Generate(ctx context.Context, params map[string]interface{}) (*ProviderResult, error)
	ValidateParams(params map[string]interface{}) error
}

// Registry 用于管理不同的 Provider
var (
	Registry    = make(map[string]Provider)
	registryMu  sync.RWMutex
	initMu      sync.Mutex // 确保 InitProviders 不会被并发调用
)

// Register 注册一个 Provider
func Register(p Provider) {
	registryMu.Lock()
	defer registryMu.Unlock()
	Registry[p.Name()] = p
}

// GetProvider 获取一个 Provider
func GetProvider(name string) Provider {
	registryMu.RLock()
	defer registryMu.RUnlock()
	return Registry[name]
}

// InitProviders 从数据库初始化所有已启用的 Provider
func InitProviders() error {
	initMu.Lock()
	defer initMu.Unlock()

	// 0. 确保基础 Provider 至少存在于数据库中（即使没有配置文件）
	defaultProviders := []string{"gemini", "openai"}
	for _, name := range defaultProviders {
		var count int64
		model.DB.Model(&model.ProviderConfig{}).Where("provider_name = ?", name).Count(&count)
		if count == 0 {
			model.DB.Create(&model.ProviderConfig{
				ProviderName: name,
				DisplayName:  name,
				Enabled:      true,
			})
		}
	}

	// 1. 将配置文件中的配置同步到数据库（如果不存在）
	for name, cfg := range config.GlobalConfig.Providers {
		if !cfg.Enabled {
			continue
		}

		var dbCfg model.ProviderConfig
		err := model.DB.Where("provider_name = ?", name).First(&dbCfg).Error
		if err != nil {
			// 不存在，从配置文件创建
			dbCfg = model.ProviderConfig{
				ProviderName: name,
				DisplayName:  name,
				APIKey:       cfg.APIKey,
				APIBase:      cfg.APIBase,
				Enabled:      true,
			}
			model.DB.Create(&dbCfg)
		}
	}

	// 2. 查询数据库中所有已启用的配置
	var finalConfigs []model.ProviderConfig
	if err := model.DB.Where("enabled = ?", true).Find(&finalConfigs).Error; err != nil {
		log.Printf("查询已启用 Provider 配置失败: %v", err)
		return err
	}

	// 3. 重建 Registry
	newRegistry := make(map[string]Provider)
	for _, cfg := range finalConfigs {
		var p Provider
		var err error

		switch cfg.ProviderName {
		case "gemini":
			p, err = NewGeminiProvider(&cfg)
		case "openai":
			p, err = NewOpenAIProvider(&cfg)
		default:
			log.Printf("未知的 Provider 类型: %s", cfg.ProviderName)
			continue
		}

		if err != nil {
			log.Printf("初始化 Provider %s 失败: %v", cfg.ProviderName, err)
			// 这里我们选择记录错误并继续，但也可以选择返回错误
			// 为了让用户知道配置有问题，我们这里记录但不中断
			continue
		}

		newRegistry[cfg.ProviderName] = p
		log.Printf("Provider %s 已加载 (BaseURL: %s)", cfg.ProviderName, cfg.APIBase)
	}

	// 4. 原子替换 Registry
	registryMu.Lock()
	Registry = newRegistry
	registryMu.Unlock()

	log.Printf("所有 Provider 已重新加载，当前生效数量: %d", len(newRegistry))
	return nil
}
