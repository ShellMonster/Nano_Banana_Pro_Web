#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 GitHub 仓库提取真实模板的脚本
使用 git sparse-checkout 只获取需要的目录
"""

import subprocess
import json
import os
import shutil
import hashlib
from datetime import datetime


def get_next_id(templates):
    """获取下一个可用的ID"""
    max_id = 0
    for item in templates:
        if 'id' in item:
            # 提取数字部分
            id_num = int(item['id'].replace('nbp-', ''))
            if id_num > max_id:
                max_id = id_num
    return f"nbp-{max_id + 1:03d}"


def clone_repo_sparse():
    """使用 sparse-checkout 克隆特定目录"""
    temp_dir = "temp_banana_repo"

    # 清理已存在的目录
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)

    print("正在使用 sparse-checkout 克隆仓库...")

    try:
        # 初始化仓库
        subprocess.run(
            ["git", "init", temp_dir],
            capture_output=True,
            check=True,
            timeout=60
        )

        # 添加远程仓库
        subprocess.run(
            ["git", "-C", temp_dir, "remote", "add", "origin",
             "https://github.com/xianyu110/awesome-nanobananapro-prompts.git"],
            capture_output=True,
            check=True,
            timeout=30
        )

        # 配置 sparse-checkout
        subprocess.run(
            ["git", "-C", temp_dir, "config", "core.sparseCheckout", "true"],
            capture_output=True,
            check=True,
            timeout=10
        )

        # 设置要获取的目录
        sparse_file = os.path.join(temp_dir, ".git", "info", "sparse-checkout")
        with open(sparse_file, "w") as f:
            f.write("gpt4o-image-prompts-master/\n")

        # 获取内容 - 尝试 main 分支
        result = subprocess.run(
            ["git", "-C", temp_dir, "pull", "origin", "main", "--depth=1"],
            capture_output=True,
            timeout=120
        )

        # 如果 main 失败，尝试 master
        if result.returncode != 0:
            print("main 分支不存在，尝试 master 分支...")
            result = subprocess.run(
                ["git", "-C", temp_dir, "pull", "origin", "master", "--depth=1"],
                capture_output=True,
                timeout=120
            )

        result.check_returncode()

        print("✓ 仓库克隆成功!")
        return temp_dir

    except subprocess.CalledProcessError as e:
        print(f"✗ 克隆失败: {e.stderr}")
        # 清理
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        return None
    except Exception as e:
        print(f"✗ 出错: {e}")
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        return None


def find_template_files(repo_dir):
    """查找所有模板文件"""
    templates_dir = os.path.join(repo_dir, "gpt4o-image-prompts-master")
    template_files = []

    if not os.path.exists(templates_dir):
        print(f"目录不存在: {templates_dir}")
        return template_files

    print(f"\n扫描目录: {templates_dir}")

    # 遍历所有子目录
    for root, dirs, files in os.walk(templates_dir):
        for file in files:
            if file.endswith(".md") and file.lower() != "readme.md":
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, repo_dir)
                template_files.append(rel_path)

    print(f"找到 {len(template_files)} 个模板文件")
    return template_files


def read_file_content(filepath, repo_dir):
    """读取文件内容"""
    full_path = os.path.join(repo_dir, filepath)
    try:
        with open(full_path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        print(f"  读取文件失败: {e}")
        return ""


def parse_prompt_file(content, filepath):
    """解析提示词文件"""
    if not content:
        return None

    # 从文件路径提取信息
    parts = filepath.replace(".md", "").split("/")
    filename = parts[-1]

    # 提取提示词 - 查找代码块
    prompt = ""
    lines = content.split("\n")
    in_code_block = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            continue
        if in_code_block and stripped and not prompt:
            prompt = stripped
            break

    # 如果没有找到代码块，查找第一段英文描述
    if not prompt:
        for line in lines:
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and len(stripped) > 20:
                # 检查是否是英文
                english_chars = sum(1 for c in stripped if c.isalpha() and ord(c) < 128)
                total_chars = sum(1 for c in stripped if c.isalpha())
                if total_chars > 0 and english_chars / total_chars > 0.6:
                    prompt = stripped
                    break

    if not prompt:
        return None

    # 生成标题
    title = filename.replace("-", " ").replace("_", " ").strip().title()

    # 根据文件名和内容智能分类
    channels, materials, industries, ratio = classify_template(filename, content)

    template = {
        "title": f"Nano Banana·{title}",
        "channels": channels,
        "materials": materials,
        "industries": industries,
        "ratio": ratio,
        "preview": "",
        "image": "",
        "prompt": prompt[:500],
        "prompt_params": "可根据需要调整提示词中的风格、细节和质量参数",
        "tips": f"从 GitHub 仓库提取的{title}提示词模板",
        "source": {
            "name": "@xianyu110",
            "label": "GitHub",
            "url": f"https://github.com/xianyu110/awesome-nanobananapro-prompts/blob/master/{filepath}"
        }
    }

    return template


def classify_template(filename, content):
    """智能分类"""
    filename_lower = filename.lower()
    content_lower = content.lower()

    # 渠道分类
    if any(kw in filename_lower for kw in ["portrait", "anime", "character", "写实", "动漫"]):
        channels = ["生活", "小红书"]
    elif any(kw in filename_lower for kw in ["product", "food", "fashion", "产品", "美食", "时尚"]):
        channels = ["电商"]
    elif any(kw in filename_lower for kw in ["cyberpunk", "comic", "pixel", "fantasy", "赛博", "漫画"]):
        channels = ["娱乐", "短视频平台"]
    else:
        channels = ["全部"]

    # 素材分类
    if any(kw in filename_lower for kw in ["portrait", "character", "写实"]):
        materials = ["个人写真"]
    elif any(kw in filename_lower for kw in ["poster", "海报"]):
        materials = ["电影海报", "广告图"]
    elif any(kw in filename_lower for kw in ["logo", "design"]):
        materials = ["产品设计"]
    elif any(kw in filename_lower for kw in ["comic", "漫画"]):
        materials = ["漫画插图"]
    elif any(kw in filename_lower for kw in ["landscape", "风景"]):
        materials = ["全屏海报"]
    else:
        materials = ["全部"]

    # 行业分类
    if any(kw in filename_lower for kw in ["food", "美食"]):
        industries = ["美食餐饮"]
    elif any(kw in filename_lower for kw in ["fashion", "时尚"]):
        industries = ["服饰箱包"]
    elif any(kw in filename_lower for kw in ["architectural", "architecture", "建筑"]):
        industries = ["建筑", "家居家装"]
    else:
        industries = ["通用"]

    # 比例分类
    if any(kw in filename_lower for kw in ["portrait", "写实"]):
        ratio = "9:16"
    elif any(kw in filename_lower for kw in ["landscape", "风景"]):
        ratio = "16:9"
    elif any(kw in filename_lower for kw in ["poster", "海报"]):
        ratio = "3:4"
    else:
        ratio = "1:1"

    return channels, materials, industries, ratio


def main():
    """主函数"""
    print("=" * 60)
    print("从 GitHub 提取 Nano Banana Pro 真实模板")
    print("=" * 60)

    # 1. 克隆仓库
    repo_dir = clone_repo_sparse()
    if not repo_dir:
        print("\n无法克隆仓库，退出")
        return

    # 2. 查找模板文件
    template_files = find_template_files(repo_dir)
    if not template_files:
        print("未找到模板文件")
        shutil.rmtree(repo_dir)
        return

    # 3. 读取现有模板
    templates_json_path = "backend/internal/templates/assets/templates.json"
    with open(templates_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        existing_items = data.get("items", [])

    print(f"\n现有模板数量: {len(existing_items)}")

    # 4. 解析新模板
    print("\n开始解析模板文件...")
    new_templates = []

    for i, filepath in enumerate(template_files[:50], 1):  # 先处理前50个
        filename = filepath.split("/")[-1]
        print(f"[{i}/{min(50, len(template_files))}] {filename}")

        content = read_file_content(filepath, repo_dir)
        if content:
            template = parse_prompt_file(content, filepath)
            if template:
                # 检查是否重复
                is_duplicate = False
                for existing in existing_items:
                    if existing.get('prompt', '')[:100] == template['prompt'][:100]:
                        is_duplicate = True
                        print(f"  - 跳过（重复）")
                        break

                if not is_duplicate:
                    # 生成ID
                    template['id'] = get_next_id(existing_items + new_templates)
                    new_templates.append(template)
                    print(f"  ✓ 成功: {template['id']} - {template['title']}")

    # 5. 追加到 JSON
    if new_templates:
        print(f"\n成功提取 {len(new_templates)} 个新模板")

        # 更新元数据
        data['meta']['version'] = datetime.now().strftime('%Y-%m-%d')
        data['meta']['updated_at'] = datetime.now().isoformat()

        # 追加新模板
        data['items'].extend(new_templates)

        # 保存
        with open(templates_json_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"\n✓ 已更新 {templates_json_path}")
        print(f"  总模板数: {len(data['items'])}")
    else:
        print("\n未提取到新模板")

    # 6. 清理
    shutil.rmtree(repo_dir)
    print(f"\n已清理临时目录")


if __name__ == "__main__":
    main()
