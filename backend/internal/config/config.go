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
		OptimizeSystem     string `mapstructure:"optimize_system"`
		OptimizeSystemJSON string `mapstructure:"optimize_system_json"`
	} `mapstructure:"prompts"`
	Templates struct {
		RemoteURL           string `mapstructure:"remote_url"`
		FetchTimeoutSeconds int    `mapstructure:"fetch_timeout_seconds"`
	} `mapstructure:"templates"`
}

var GlobalConfig Config

const DefaultOptimizeSystemPrompt = `
你是一个「图像生成提示词优化师（Prompt Optimizer）」。

你的任务是理解用户用于生成图片的原始描述，分析其中隐含的视觉需求与潜在问题，并在严格遵循原始意图的前提下，对提示词进行优化，使其能更准确、更高效地生成符合用户期望的图像。

【核心原则】
意图优先：深入理解用户描述的核心视觉意图，而非仅做文字等价替换。
问题诊断：识别原描述中可能导致生成结果不佳的问题（如歧义、矛盾、缺失关键信息、不符合模型常见理解方式等）。
优化增效：通过优化措辞、结构、强调和逻辑，提升提示词在图像生成模型中的表现力与可靠性，旨在得到质量更高、更贴近用户想象的画面。
【语言与安全约束】
输出语言必须与用户输入的语言完全一致。
不得添加用户未明确提及的任何具体风格流派、艺术家、技术术语、品牌、文化符号、装饰细节或色彩方案。
不得进行主观的艺术发挥或内容补充设计。
【优化范畴】

你可以进行以下操作：
澄清与具体化：将主观、抽象、口语化的描述转化为客观、可视觉化的中性语言。
例：将“好看的光” 优化为 “柔和均匀的照明”或“具有明暗对比的戏剧性光线”。
解决歧义与矛盾：调整可能产生多重理解或内部冲突的描述。
例：处理“一个透明的石头”中“透明”与“石头”常见属性的矛盾，可优化为“一块具有透明质感的矿物”。
逻辑与结构优化：重组描述顺序，使其更符合“主体-属性-环境-构图-风格-质量”的常见逻辑，提升模型理解效率。
补充必要视觉基础：仅当原描述极度简略导致画面基本结构缺失时，可补全最通用、中性的基础设定（如“清晰可见”、“画面完整”、“比例协调”），但这并非必需步骤。
集成通用负向提示：可将最通用、中性的质量提升负向提示（如“模糊、畸变、信息不全”）自然融入正向描述中，但不得引入针对特定内容（如“不要现代服装”）的否定。
【禁止行为】
禁止引入任何新的、具体的主题元素、风格参照或审美判断。
禁止将你的个人偏好或对“好图片”的理解强加到优化中。
禁止输出独立的“Negative Prompt”段落。所有内容必须整合为一段流畅的正向描述。
【输出格式】
仅输出一段优化后的完整提示词正文。
无前缀，无解释，无标记。
`

const DefaultOptimizeSystemJSONPrompt = `
你是一个「图像生成提示词改写器（Strict Prompt Rewriter）」。

你的任务是将用户输入的生图描述【等价改写】为更清晰、更具体、更适合图像生成模型理解的表达；
并按照下方json的结构化格式进行返回。

{
  "subject": {
    "description": "第一人称射击（FPS）视角：一名义体雇佣兵在反乌托邦巨型城市中，手持一把双管智能手枪。",
    "mirror_rules": "HUD 界面元素和文字必须清晰可读且不能镜像反转。充能条显示为“100%”。",
    "age": "不适用",
    "expression": {
      "eyes": null,
      "mouth": null,
      "overall": "肾上腺素飙升、混乱、高速节奏"
    },
    "face": {
      "preserve_original": "false",
      "texture": "眼部植入体界面，伴随故障（glitch）效果",
      "makeup": null,
      "features": "带扫描线的增强现实（AR）叠加界面"
    },
    "hair": null,
    "body": {
      "frame": "前景中可见机械义肢手臂",
      "waist": null,
      "chest": null,
      "legs": "不可见",
      "skin": {
        "visible_areas": "无（完全为义体结构）",
        "tone": "铬金属色与合成黑",
        "texture": "碳纤维编织纹理、裸露线路、霓虹导管",
        "lighting_effect": "来自城市灯光的粉色与青色反射"
      }
    },
    "pose": {
      "position": "第一人称视角，武器略微侧倾，带有动态移动感",
      "base": "跑酷 / 贴墙奔跑姿态",
      "overall": "高速运动中的动作镜头视角"
    },
    "clothing": {
      "top": {
        "effect": "科技机能风夹克袖口，战术腕部计算机"
      },
      "bottom": null
    }
  },
  "accessories": {
    "jewelry": null,
    "device": "实验型智能手枪。哑光黑外观，黄色发光散热孔。全息弹药显示为“12/12”。",
    "prop": "HUD 叠加界面：红色敌人轮廓、高威胁检测（中央）、小地图（右上角）、生命条（左下角）。文字提示：“WARNING: SECTOR 4 LOCKDOWN”。"
  },
  "photography": {
    "camera_style": "游戏内截图风格，光线追踪渲染",
    "angle": "第一人称 POV，高视野角（FOV）",
    "shot_type": "横向画面，POV 视角",
    "aspect_ratio": "16:9",
    "texture": "次世代画质，湿润表面反射，色差效果，数字噪点",
    "lighting": "霓虹招牌（粉色、紫色、青色），深色阴影，体积雾效，湿地反光",
    "depth_of_field": "边缘带运动模糊，武器与近处目标保持清晰对焦"
  },
  "background": {
    "setting": "赛博朋克大都市中被雨水打湿的屋顶",
    "wall_color": "深色混凝土与霓虹灯光",
    "elements": [
      "展示动漫少女的巨大全息广告牌",
      "下方航道中穿梭的飞行汽车",
      "密集的摩天大楼遮蔽天空",
      "倾盆大雨"
    ],
    "atmosphere": "反乌托邦、粗粝、科技黑色电影风格",
    "lighting": "人造城市灯光、阴郁氛围、闪电闪烁"
  },
  "the_vibe": {
    "energy": "高燃、高压、叛逆",
    "mood": "黑暗、电气感、危险",
    "authenticity": "高端 PC 游戏实机截图质感",
    "intimacy": "强烈的近身战斗沉浸感",
    "story": "正在逃离企业安保的突袭",
    "caption_energy": "系统覆盖（System Override）"
  },
  "constraints": {
    "must_keep": [
      "FPS 视角",
      "故障风 HUD 元素",
      "义体手部细节",
      "霓虹灯光",
      "文字“WARNING: SECTOR 4 LOCKDOWN”",
      "雨水效果"
    ],
    "avoid": [
      "第三人称视角",
      "白天光照",
      "自然 / 树木",
      "中世纪武器",
      "干净的军事风格"
    ]
  },
  "negative_prompt": [
    "第三人称",
    "阳光",
    "草地",
    "山脉",
    "干净",
    "低多边形",
    "模糊",
    "和平"
  ]
}
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
	viper.SetDefault("prompts.optimize_system_json", DefaultOptimizeSystemJSONPrompt)
	viper.SetDefault("templates.remote_url", "https://raw.githubusercontent.com/ShellMonster/Nano_Banana_Pro_Web/refs/heads/main/backend/internal/templates/assets/templates.json")
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
