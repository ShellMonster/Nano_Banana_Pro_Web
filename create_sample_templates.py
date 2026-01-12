#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Nano Banana Pro 示例模板生成器
创建基于 Nano Banana Pro 的高质量文生图提示词模板
"""

import json
import hashlib
from datetime import datetime


def generate_templates():
    """生成示例模板"""

    # 根据常见的 Nano Banana Pro 提示词结构创建模板
    templates = [
        # ========== 肖像类 ==========
        {
            "id": "nbp-1001",
            "title": "Nano Banana·写实肖像",
            "channels": ["生活", "小红书"],
            "materials": ["个人写真"],
            "industries": ["通用"],
            "ratio": "9:16",
            "preview": "",
            "image": "",
            "prompt": "A hyper-realistic portrait photography, medium shot, professional studio lighting, shallow depth of field, bokeh background, 8K ultra HD, shot on Canon EOS R5, 85mm f/1.2 lens, natural skin texture, catchlights in eyes, masterpiece",
            "prompt_params": "可添加主体描述（年龄、性别、特征）、情绪表情、背景场景",
            "tips": "适用于个人头像、社交媒体头像、职业照等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-1002",
            "title": "Nano Banana·动漫角色",
            "channels": ["娱乐", "短视频平台"],
            "materials": ["个人写真"],
            "industries": ["影视"],
            "ratio": "9:16",
            "preview": "",
            "image": "",
            "prompt": "Anime character design, vibrant colors, clean line art, expressive eyes, detailed hair, studio Ghibli inspired style, cel shaded, professional illustration, high quality, 4K",
            "prompt_params": "可指定角色特征（发型、服装、配饰）、表情姿势、艺术风格",
            "tips": "适用于动漫头像、角色设计、插画创作等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-1003",
            "title": "Nano Banana·铅笔素描",
            "channels": ["生活", "艺术创作"],
            "materials": ["个人写真"],
            "industries": ["通用"],
            "ratio": "1:1",
            "preview": "",
            "image": "",
            "prompt": "Pencil sketch portrait, graphite drawing, detailed shading, cross-hatching technique, textured paper background, realistic proportions, artistic, hand-drawn style, high contrast",
            "prompt_params": "可调整素描风格（精细/粗犷）、纸张质感、阴影程度",
            "tips": "适用于艺术创作、肖像素描、黑白插画等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-1004",
            "title": "Nano Banana·水彩肖像",
            "channels": ["生活", "艺术创作"],
            "materials": ["个人写真"],
            "industries": ["通用"],
            "ratio": "1:1",
            "preview": "",
            "image": "",
            "prompt": "Watercolor portrait painting, soft brushstrokes, color blending, wet-on-wet technique, delicate details, artistic splashes, pastel color palette, paper texture, masterpiece",
            "prompt_params": "可调整水彩风格、色彩饱和度、背景装饰元素",
            "tips": "适用于艺术肖像、插画创作、装饰画等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-1005",
            "title": "Nano Banana·油画风格",
            "channels": ["艺术创作"],
            "materials": ["个人写真"],
            "industries": ["通用"],
            "ratio": "1:1",
            "preview": "",
            "image": "",
            "prompt": "Oil painting portrait, impasto technique, rich textures, classical art style, dramatic lighting, chiaroscuro, museum quality, masterpiece, inspired by Old Masters",
            "prompt_params": "可调整油画风格（古典/现代）、笔触粗细、色调",
            "tips": "适用于艺术创作、古典风格肖像、装饰画等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },

        # ========== 艺术风格类 ==========
        {
            "id": "nbp-2001",
            "title": "Nano Banana·赛博朋克",
            "channels": ["娱乐", "短视频平台"],
            "materials": ["全部"],
            "industries": ["数码科技"],
            "ratio": "16:9",
            "preview": "",
            "image": "",
            "prompt": "Cyberpunk cityscape, neon lights, rain-soaked streets, holographic advertisements, futuristic architecture, night scene, purple and cyan color scheme, high tech low life, blade runner inspired, 8K ultra detailed",
            "prompt_params": "可添加场景元素（人物/车辆/建筑）、时间、天气状况",
            "tips": "适用于科幻场景、游戏概念艺术、未来城市设计等",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-2002",
            "title": "Nano Banana·数字艺术",
            "channels": ["艺术创作"],
            "materials": ["全部"],
            "industries": ["广告营销"],
            "ratio": "1:1",
            "preview": "",
            "image": "",
            "prompt": "Digital art, vibrant colors, clean composition, modern aesthetic, trending on ArtStation, 4K resolution, highly detailed, professional illustration, contemporary style",
            "prompt_params": "可指定主题、艺术风格、色彩方案",
            "tips": "适用于数字插画、概念艺术、商业设计等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-2003",
            "title": "Nano Banana·像素艺术",
            "channels": ["娱乐", "短视频平台"],
            "materials": ["全部"],
            "industries": ["数码科技"],
            "ratio": "1:1",
            "preview": "",
            "image": "",
            "prompt": "Pixel art, 16-bit style, retro gaming aesthetic, limited color palette, crisp edges, nostalgic, video game sprite, detailed pixel work, dithering, classic arcade era",
            "prompt_params": "可指定像素密度（8bit/16bit/32bit）、主题、配色",
            "tips": "适用于游戏设计、复古风格创作、像素画等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-2004",
            "title": "Nano Banana·等距视图",
            "channels": ["电商", "广告营销"],
            "materials": ["产品设计"],
            "industries": ["通用"],
            "ratio": "1:1",
            "preview": "",
            "image": "",
            "prompt": "Isometric view, 3D illustration, clean geometry, soft lighting, pastel colors, minimalist design, architectural visualization, orthographic perspective, highly detailed, Blender render",
            "prompt_params": "可添加物体、场景元素、色彩风格、细节程度",
            "tips": "适用于产品设计、建筑展示、信息图表等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-2005",
            "title": "Nano Banana·低多边形",
            "channels": ["电商", "广告营销"],
            "materials": ["产品设计"],
            "industries": ["数码科技"],
            "ratio": "1:1",
            "preview": "",
            "image": "",
            "prompt": "Low poly 3D art, geometric shapes, flat shading, vibrant colors, clean aesthetic, minimal polygons, stylized rendering, game asset style, charming simplicity",
            "prompt_params": "可调整多边形数量、色彩方案、主题场景",
            "tips": "适用于游戏资产、3D插画、简约设计等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-2006",
            "title": "Nano Banana·极简设计",
            "channels": ["电商", "广告营销"],
            "materials": ["产品设计"],
            "industries": ["广告营销"],
            "ratio": "1:1",
            "preview": "",
            "image": "",
            "prompt": "Minimalist design, clean lines, negative space, monochromatic color scheme, simple shapes, elegant composition, modern aesthetic, Scandinavian style, less is more",
            "prompt_params": "可调整颜色数量、构图元素、留白比例",
            "tips": "适用于品牌设计、海报设计、极简风格创作等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-2007",
            "title": "Nano Banana·波普艺术",
            "channels": ["艺术创作"],
            "materials": ["全部"],
            "industries": ["广告营销"],
            "ratio": "3:4",
            "preview": "",
            "image": "",
            "prompt": "Pop art style, bold colors, halftone dots, comic book aesthetic, Warhol inspired, vibrant and saturated, dynamic composition, commercial art style, retro 1960s",
            "prompt_params": "可指定主题、色彩搭配、图案密度",
            "tips": "适用于波普艺术创作、商业插画、复古设计等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-2008",
            "title": "Nano Banana·超现实主义",
            "channels": ["艺术创作"],
            "materials": ["全部"],
            "industries": ["艺术创作"],
            "ratio": "1:1",
            "preview": "",
            "image": "",
            "prompt": "Surrealist art, dreamlike scene, impossible geometry, Salvador Dali inspired, melting objects, floating elements, symbolic imagery, subconscious art style, mind-bending",
            "prompt_params": "可添加超现实元素、场景设定、象征符号",
            "tips": "适用于超现实主义创作、概念艺术、梦幻场景等",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-2009",
            "title": "Nano Banana·抽象艺术",
            "channels": ["艺术创作"],
            "materials": ["全部"],
            "industries": ["艺术创作"],
            "ratio": "1:1",
            "preview": "",
            "image": "",
            "prompt": "Abstract art, expressive colors, dynamic shapes, emotional composition, non-representational, modern art style, texture and movement, contemporary gallery aesthetic",
            "prompt_params": "可调整色彩、形状、构图密度、艺术风格",
            "tips": "适用于抽象艺术创作、现代设计、装饰画等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },

        # ========== 设计类 ==========
        {
            "id": "nbp-3001",
            "title": "Nano Banana·Logo设计",
            "channels": ["电商", "广告营销"],
            "materials": ["产品设计"],
            "industries": ["广告营销"],
            "ratio": "1:1",
            "preview": "",
            "image": "",
            "prompt": "Professional logo design, minimalist, vector style, clean lines, memorable silhouette, scalable, brand identity, modern corporate aesthetic, centered composition on white background",
            "prompt_params": "可指定品牌名称、行业属性、风格偏好、色彩",
            "tips": "适用于品牌Logo、企业标识、商标设计等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-3002",
            "title": "Nano Banana·产品设计",
            "channels": ["电商", "广告营销"],
            "materials": ["产品展示"],
            "industries": ["商品零售"],
            "ratio": "1:1",
            "preview": "",
            "image": "",
            "prompt": "Product design, 3D render, studio lighting, clean background, premium quality, sleek modern design, commercial photography style, professional presentation",
            "prompt_params": "可添加产品类型、材质、使用场景、风格",
            "tips": "适用于产品展示、电商详情页、广告设计等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-3003",
            "title": "Nano Banana·建筑设计",
            "channels": ["电商", "广告营销"],
            "materials": ["建筑设计"],
            "industries": ["建筑", "家居家装"],
            "ratio": "16:9",
            "preview": "",
            "image": "",
            "prompt": "Architectural design, modern building, glass and steel, dramatic perspective, professional rendering, blue sky background, contemporary style, structural details, 3D visualization",
            "prompt_params": "可指定建筑类型、风格材质、环境氛围",
            "tips": "适用于建筑设计展示、房地产宣传、概念设计等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-3004",
            "title": "Nano Banana·室内设计",
            "channels": ["电商", "广告营销"],
            "materials": ["建筑设计"],
            "industries": ["建筑", "家居家装"],
            "ratio": "16:9",
            "preview": "",
            "image": "",
            "prompt": "Interior design, modern living space, natural lighting, cohesive color palette, stylish furniture, architectural photography, home decor magazine style, warm atmosphere",
            "prompt_params": "可添加房间类型、风格（北欧/现代/工业等）、色彩",
            "tips": "适用于室内设计展示、家居装饰、房地产宣传等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },

        # ========== 摄影类 ==========
        {
            "id": "nbp-4001",
            "title": "Nano Banana·产品摄影",
            "channels": ["电商", "广告营销"],
            "materials": ["产品展示"],
            "industries": ["商品零售"],
            "ratio": "1:1",
            "preview": "",
            "image": "",
            "prompt": "Professional product photography, studio lighting, clean white background, sharp focus, high resolution, commercial quality, highlight product features, premium presentation",
            "prompt_params": "可指定产品类型、拍摄角度、背景色彩",
            "tips": "适用于电商产品图、广告宣传、产品目录等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-4002",
            "title": "Nano Banana·美食摄影",
            "channels": ["电商"],
            "materials": ["产品展示"],
            "industries": ["美食餐饮"],
            "ratio": "1:1",
            "preview": "",
            "image": "",
            "prompt": "Food photography, appetizing presentation, natural lighting, shallow depth of field, fresh ingredients, restaurant quality, gourmet style, steam rising, vibrant colors",
            "prompt_params": "可添加菜品类型、摆盘风格、拍摄角度、环境",
            "tips": "适用于餐饮宣传、美食博客、菜单设计等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-4003",
            "title": "Nano Banana·时尚摄影",
            "channels": ["电商", "广告营销"],
            "materials": ["产品展示"],
            "industries": ["服饰箱包"],
            "ratio": "3:4",
            "preview": "",
            "image": "",
            "prompt": "Fashion photography, editorial style, high fashion, dramatic lighting, confident model, designer clothing, Vogue magazine aesthetic, professional composition, stylish pose",
            "prompt_params": "可指定服装类型、模特特征、场景风格、情绪",
            "tips": "适用于时尚电商、服装品牌、杂志风格拍摄等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-4004",
            "title": "Nano Banana·电影级灯光",
            "channels": ["娱乐", "短视频平台"],
            "materials": ["全部"],
            "industries": ["影视"],
            "ratio": "16:9",
            "preview": "",
            "image": "",
            "prompt": "Cinematic lighting, dramatic atmosphere, film noir inspired, moody shadows, volumetric lighting, Hollywood movie style, anamorphic lens flare, professional color grading",
            "prompt_params": "可调整灯光类型（主光/辅光/轮廓光）、色调、氛围",
            "tips": "适用于电影场景、视频制作、戏剧性摄影等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-4005",
            "title": "Nano Banana·自然光",
            "channels": ["生活", "小红书"],
            "materials": ["全部"],
            "industries": ["通用"],
            "ratio": "1:1",
            "preview": "",
            "image": "",
            "prompt": "Natural lighting, golden hour, soft sunlight, warm tones, authentic feel, outdoor photography, flattering shadows, organic atmosphere, candid style",
            "prompt_params": "可添加时间段（日出/日落/正午）、天气、场景",
            "tips": "适用于生活方式摄影、旅行摄影、自然风格创作等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },

        # ========== 场景类 ==========
        {
            "id": "nbp-5001",
            "title": "Nano Banana·风景",
            "channels": ["全部"],
            "materials": ["全屏海报"],
            "industries": ["通用"],
            "ratio": "16:9",
            "preview": "",
            "image": "",
            "prompt": "Breathtaking landscape photography, panoramic view, majestic mountains, dramatic sky, golden hour lighting, ultra wide angle, 8K resolution, National Geographic style, natural beauty",
            "prompt_params": "可添加地理特征（山川/海洋/森林等）、天气、时间",
            "tips": "适用于风景摄影、壁纸制作、旅行宣传等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-5002",
            "title": "Nano Banana·漫画",
            "channels": ["娱乐", "短视频平台"],
            "materials": ["漫画插图"],
            "industries": ["娱乐", "影视"],
            "ratio": "3:4",
            "preview": "",
            "image": "",
            "prompt": "Comic book art, bold outlines, vibrant colors, dynamic action pose, graphic novel style, speech bubbles, halftone shading, Marvel/DC inspired, sequential art",
            "prompt_params": "可指定角色、动作、场景、漫画风格",
            "tips": "适用于漫画创作、插画设计、故事板等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-5003",
            "title": "Nano Banana·电影海报",
            "channels": ["娱乐", "短视频平台"],
            "materials": ["电影海报", "广告图"],
            "industries": ["影视"],
            "ratio": "3:4",
            "preview": "",
            "image": "",
            "prompt": "Movie poster design, blockbuster style, dramatic composition, typography integration, cinematic lighting, emotional impact, theatrical release quality, Hollywood marketing",
            "prompt_params": "可添加电影类型、视觉元素、色彩风格、标题",
            "tips": "适用于电影海报设计、活动宣传、戏剧性设计等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-5004",
            "title": "Nano Banana·书籍封面",
            "channels": ["电商", "广告营销"],
            "materials": ["产品展示"],
            "industries": ["教育培训"],
            "ratio": "3:4",
            "preview": "",
            "image": "",
            "prompt": "Book cover design, eye-catching composition, genre appropriate, professional typography, artistic illustration, marketable, publishing industry standard, centered title",
            "prompt_params": "可指定书籍类型、标题、视觉风格、色调",
            "tips": "适用于书籍封面设计、电子书封面、出版设计等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
        {
            "id": "nbp-5005",
            "title": "Nano Banana·3D渲染",
            "channels": ["电商", "广告营销"],
            "materials": ["产品展示"],
            "industries": ["数码科技"],
            "ratio": "1:1",
            "preview": "",
            "image": "",
            "prompt": "3D render, photorealistic, ray tracing, ambient occlusion, subsurface scattering, Cinema 4D / Blender render, high quality materials, studio lighting, clean composition",
            "prompt_params": "可指定物体类型、材质、渲染风格、光照",
            "tips": "适用于3D设计、产品可视化、数字艺术创作等场景",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": "https://github.com/xianyu110/awesome-nanobananapro-prompts"
            }
        },
    ]

    return templates


def main():
    """主函数"""
    print("=" * 60)
    print("生成 Nano Banana Pro 示例模板")
    print("=" * 60)

    templates = generate_templates()

    print(f"\n共生成 {len(templates)} 个模板")
    print("\n模板分类统计:")
    categories = {}
    for t in templates:
        cat = t['title'].split('·')[1].split()[0] if '·' in t['title'] else '其他'
        categories[cat] = categories.get(cat, 0) + 1

    for cat, count in categories.items():
        print(f"  {cat}: {count} 个")

    # 保存到文件
    output_file = "sample_banana_templates.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(templates, f, ensure_ascii=False, indent=2)

    print(f"\n模板已保存到: {output_file}")

    # 显示预览
    print("\n=== 模板预览 ===")
    for i, template in enumerate(templates[:5], 1):
        print(f"\n{i}. {template['title']}")
        print(f"   ID: {template['id']}")
        print(f"   分类: {template['channels']}, {template['materials']}, {template['industries']}")
        print(f"   提示词: {template['prompt'][:70]}...")

    return templates


if __name__ == "__main__":
    main()
