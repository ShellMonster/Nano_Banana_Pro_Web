package config

import (
	"log"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	Server struct {
		Port int `mapstructure:"port"`
	} `mapstructure:"server"`
	Database struct {
		Path string `mapstructure:"path"`
	} `mapstructure:"database"`
	Storage struct {
		LocalDir string `mapstructure:"local_dir"`
		OSS      struct {
			Enabled         bool   `mapstructure:"enabled"`
			Endpoint        string `mapstructure:"endpoint"`
			AccessKeyID     string `mapstructure:"access_key_id"`
			AccessKeySecret string `mapstructure:"access_key_secret"`
			BucketName      string `mapstructure:"bucket_name"`
			Domain          string `mapstructure:"domain"`
		} `mapstructure:"oss"`
	} `mapstructure:"storage"`
	Providers map[string]struct {
		APIKey  string `mapstructure:"api_key"`
		APIBase string `mapstructure:"api_base"`
		Enabled bool   `mapstructure:"enabled"`
	} `mapstructure:"providers"`
	Prompts struct {
		OptimizeSystem string `mapstructure:"optimize_system"`
	} `mapstructure:"prompts"`
}

var GlobalConfig Config

const DefaultOptimizeSystemPrompt = `
你是一个「图像生成提示词优化器」。

你的任务是：  
在【完全不改变用户原始意图、主题和风格取向】的前提下，将用户输入的生图提示词，重写为更清晰、更具体、更适合图像生成模型理解和执行的最终 Prompt。

【输入】
- 用户提供的原始生图提示词（可能简短、口语化、不完整）

【输出规则（非常重要）】
- 只输出【优化后的最终 Prompt】
- 不要输出任何解释、说明、分析、前言或结论
- 不要与用户对话，不要提及“优化”“改写”等字眼
- 输出内容必须可直接复制用于生图

【优化要求】
- 保留用户的核心主题、风格与表达意图
- 将模糊描述转化为可视觉化、可执行的画面语言
- 在不违背原意的前提下，补全必要的视觉信息，包括但不限于：
  - 主体与关键特征
  - 场景与环境
  - 构图、视角、镜头感
  - 风格、质感、真实度或艺术方向
  - 光影、色彩、清晰度
- 避免抽象词、情绪词、评价词，全部转化为具体画面描述

【负向提示词】
- 在同一输出中包含 Negative Prompt
- 明确排除低质量、畸形、比例错误、风格跑偏、多余元素等常见问题
- Negative Prompt 不得与正向 Prompt 冲突

【输出格式】
Prompt: <优化后的正向提示词>
Negative Prompt: <负向提示词>

【约束】
- 不新增用户未表达的核心内容
- 不擅自切换风格（如写实 / 二次元 / 插画 / 摄影）
- 不输出任何与图像生成无关的文字
`

func InitConfig() {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("configs")
	viper.AddConfigPath(".")

	// 设置默认值
	viper.SetDefault("database.path", "data.db")
	viper.SetDefault("storage.local_dir", "storage")
	viper.SetDefault("server.port", 8080)
	viper.SetDefault("prompts.optimize_system", DefaultOptimizeSystemPrompt)

	// 支持环境变量
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	viper.AutomaticEnv()

	if err := viper.ReadInConfig(); err != nil {
		log.Printf("未找到配置文件，将使用环境变量或默认值: %v", err)
	}

	if err := viper.Unmarshal(&GlobalConfig); err != nil {
		log.Fatalf("解析配置失败: %v", err)
	}
}
