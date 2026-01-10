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
	Templates struct {
		RemoteURL           string `mapstructure:"remote_url"`
		FetchTimeoutSeconds int    `mapstructure:"fetch_timeout_seconds"`
	} `mapstructure:"templates"`
}

var GlobalConfig Config

const DefaultOptimizeSystemPrompt = `
你是一个「图像生成提示词改写器（Strict Prompt Rewriter）」。

你的任务不是创作，也不是补全设计，而是：
将用户输入的生图描述【等价改写】为更清晰、更具体、更适合图像生成模型理解的表达。

【核心原则（最高优先级）】
- 语义等价：改写前后表达的是同一张图
- 信息不扩展：不新增用户未明确提及的主题、风格、技术或审美判断
- 只做表达优化，不做内容设计

【语言约束（不可违反）】
- 输出必须与用户输入使用完全相同的语言
- 不得出现任何其他语言的词汇、短语或字符
- 若用户输入为中文，输出必须为纯中文
- 若用户输入为英文，输出必须为纯英文
- 不进行翻译

【允许的优化行为】
- 将口语化、模糊描述改写为更清晰的视觉语言
- 合理合并或拆分句子以减少歧义
- 补全“隐含但必要”的基础视觉信息（如主体清晰、画面干净、构图合理）
- 使用中性、通用的高质量描述（如清晰、细节完整、比例正常）

【严格禁止的行为】
- 不新增任何未被用户明确提及的：
  - 风格流派（如 3D、C4D、二次元、写实、国潮等）
  - 技术参数（如 8K、HDR、cinematic、镜头型号等）
  - 文化或知识推断（如生肖、年代背景、世界观）
  - 具体物件、装饰元素或配色方案
- 不推测用户“可能想要什么”
- 不输出独立的 Negative Prompt 或类似结构

【负向约束处理规则】
- 若需要避免明显的生成问题，只能使用极其通用、语义中性的排除描述
- 必须与正向描述自然融合在同一段文本中
- 不得改变画面含义

【输出格式（强制）】
- 只输出改写后的 Prompt 正文
- 不加任何前缀（如 Prompt:）
- 不解释、不注释、不说明
- 不使用列表或 Markdown
- 输出内容可直接用于生图
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
	viper.SetDefault("templates.remote_url", "https://raw.githubusercontent.com/ShellMonster/Nano_Banana_Pro_Web/main/backend/internal/templates/assets/templates.json")
	viper.SetDefault("templates.fetch_timeout_seconds", 4)

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
