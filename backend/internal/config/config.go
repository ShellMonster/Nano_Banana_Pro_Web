package config

import (
	"log"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	Server struct {
		Host string `mapstructure:"host"`
		Port int    `mapstructure:"port"`
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
		OptimizeSystem      string `mapstructure:"optimize_system"`
		OptimizeSystemJSON  string `mapstructure:"optimize_system_json"`
		ImageToPromptSystem string `mapstructure:"image_to_prompt_system"`
	} `mapstructure:"prompts"`
	Templates struct {
		RemoteURL           string `mapstructure:"remote_url"`
		FetchTimeoutSeconds int    `mapstructure:"fetch_timeout_seconds"`
	} `mapstructure:"templates"`
	Exports struct {
		RemoteFetchTimeoutSeconds int `mapstructure:"remote_fetch_timeout_seconds"`
		RemoteMaxFileMB           int `mapstructure:"remote_max_file_mb"`
	} `mapstructure:"exports"`
}

var GlobalConfig Config

const DefaultOptimizeSystemPrompt = `
你是一个「图像生成提示词优化师（Prompt Optimizer）」。

你的任务是理解用户用于生成图片的原始描述，并在不改变核心意图的前提下，将其优化为更清晰、更稳定、更适合图像生成模型理解的提示词。

【核心原则】

意图优先  
必须保留用户描述的核心主题与视觉意图，不得改变主体或生成新的主题元素。

结构优化  
将描述整理为清晰的视觉结构，使模型更容易理解画面。

视觉可生成性  
确保提示词能够明确表达一个可被生成的画面，而不是抽象描述。

【允许优化的内容】

在不改变用户主题的前提下，可以补充以下基础视觉信息：

- 构图方式（如全景、近景、俯视、航拍等）
- 视角或镜头感（如广角视角、高空视角等）
- 光线条件（如清晨光线、柔和光线等）
- 环境层次（前景、中景、远景）
- 空气与氛围（雾气、薄云、空间深度等）
- 画面完整性描述（清晰、稳定、细节可见）

这些补充仅用于提高画面可生成性，不得改变主题。

【参考图处理 - 重要】

如果用户提到以下内容：
- 参考图
- 上传图片
- 按照参考图
- 参考我提供的图片

说明用户提供了视觉参考。

必须保留所有与参考图相关的描述，不得删除或弱化。

【禁止行为】

禁止添加新的主题元素  
禁止添加艺术家、品牌、具体风格流派  
禁止加入未提及的文化符号或具体设计元素  
禁止改变用户的场景或主题内容

【输出要求】

将提示词整理为一段结构清晰、自然流畅的视觉描述。

不得输出解释。  
不得输出多段结构。  
只输出最终优化后的提示词。
`

// DefaultImageToPromptSystem 图片逆向提示词的系统提示词
// 注意：输出语言要求由后端根据用户语言动态添加
const DefaultImageToPromptSystem = `你是一个AI绘图提示词专家。请分析用户提供的图片，直接输出一个详细的、可以用来生成相似图片的AI绘图提示词。

提示词必须包含以下要素（融合成连贯的描述，不要分点列举）：
- 主体内容：主要对象、人物、场景的详细描述
- 构图方式：视角、景别、画面布局
- 色彩风格：主色调、配色方案
- 光影效果：光源、氛围
- 艺术风格：写实、插画、动漫等
- 细节特征：纹理、材质、装饰
- 质量标签：如 high quality, 8k, detailed 等

输出规则：
- 直接输出提示词，不要任何前言、标题、引导语
- 不要输出"这是提示词"、"Prompt:"、"AI 绘图 Prompt"等
- 提示词是连续的一段描述性文本，用逗号或句号分隔
- 不要使用 Markdown 格式（如 **粗体**）
- 提示词要足够详细，能生成与原图相似的图片

{{LANGUAGE_INSTRUCTION}}`

const DefaultOptimizeSystemJSONPrompt = `
你是一个「图像生成提示词改写器（Strict Prompt Rewriter）」。

你的任务是将用户输入的生图描述【等价改写】为更清晰、更具体、更适合图像生成模型理解的表达；
并按照下方json的结构化格式进行返回（注意：key一直用英文(新增的key也用英文)，value的语言必须与用户输入的语言完全一致）。

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
	viper.SetDefault("server.host", "127.0.0.1")
	viper.SetDefault("server.port", 8080)
	viper.SetDefault("prompts.optimize_system", DefaultOptimizeSystemPrompt)
	viper.SetDefault("prompts.optimize_system_json", DefaultOptimizeSystemJSONPrompt)
	viper.SetDefault("prompts.image_to_prompt_system", DefaultImageToPromptSystem)
	viper.SetDefault("templates.remote_url", "https://raw.githubusercontent.com/ShellMonster/Nano_Banana_Pro_Web/refs/heads/main/backend/internal/templates/assets/templates.json")
	viper.SetDefault("templates.fetch_timeout_seconds", 4)
	viper.SetDefault("exports.remote_fetch_timeout_seconds", 120)
	viper.SetDefault("exports.remote_max_file_mb", 512)

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
