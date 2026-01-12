#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Nano Banana Pro 模板提取脚本
使用多种方式从 GitHub 仓库提取文生图提示词模板
"""

import requests
import json
import re
import hashlib
import os
import subprocess
from typing import List, Dict, Any


class NanoBananaTemplateExtractor:
    """Nano Banana Pro 模板提取器 - 使用多种方式获取"""

    def __init__(self):
        self.owner = "xianyu110"
        self.repo = "awesome-nanobananapro-prompts"
        self.branch = "master"
        self.clone_url = f"https://github.com/{self.owner}/{self.repo}.git"
        self.temp_dir = "temp_github_repo"
        self.session = requests.Session()

    def try_github_api(self) -> List[Dict]:
        """尝试使用 GitHub API 获取文件列表"""
        print("\n方式1: 尝试使用 GitHub API...")

        # 尝试获取目录内容
        api_url = f"https://api.github.com/repos/{self.owner}/{self.repo}/contents/gpt4o-image-prompts-master"
        headers = {"Accept": "application/vnd.github.v3+json"}

        try:
            response = self.session.get(api_url, headers=headers, timeout=30)
            if response.status_code == 200:
                contents = response.json()
                if isinstance(contents, list):
                    print(f"  ✓ 找到 {len(contents)} 个文件/目录")
                    return contents
                else:
                    print(f"  响应类型: {type(contents)}")
            else:
                print(f"  ✗ API 请求失败: {response.status_code}")
        except Exception as e:
            print(f"  ✗ API 请求出错: {e}")

        return []

    def clone_with_http1(self) -> bool:
        """使用 HTTP/1.1 克隆仓库"""
        import shutil

        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)

        print("\n方式2: 尝试使用 HTTP/1.1 克隆仓库...")

        try:
            # 强制使用 HTTP/1.1
            env = os.environ.copy()
            env['GIT_PROTOCOL'] = 'http'

            result = subprocess.run(
                ["git", "-c", "http.version=HTTP/1.1", "clone", "--depth", "1",
                 "--single-branch", "--branch", self.branch, self.clone_url, self.temp_dir],
                capture_output=True,
                text=True,
                timeout=120,
                env=env
            )

            if result.returncode == 0:
                print("  ✓ 仓库克隆成功！")
                return True
            else:
                print(f"  ✗ 克隆失败: {result.stderr[:200]}")
                return False
        except Exception as e:
            print(f"  ✗ 克隆出错: {e}")
            return False

    def extract_via_html(self) -> List[str]:
        """通过 HTML 页面提取文件列表"""
        print("\n方式3: 尝试通过 GitHub 网页获取...")

        template_files = []

        # 根据仓库常见结构，预设一些文件路径
        possible_files = [
            "gpt4o-image-prompts-master/Portrait/Realistic-portrait.md",
            "gpt4o-image-prompts-master/Portrait/Anime-character.md",
            "gpt4o-image-prompts-master/Art-style/Cyberpunk.md",
            "gpt4o-image-prompts-master/Art-style/Digital-art.md",
            "gpt4o-image-prompts-master/Photography/Product-photography.md",
        ]

        # 使用不同的镜像源尝试
        mirrors = [
            "https://raw.githubusercontent.com",
            "https://ghproxy.net/https://raw.githubusercontent.com",
            "https://mirror.ghproxy.com/https://raw.githubusercontent.com",
        ]

        for mirror in mirrors:
            print(f"  尝试镜像: {mirror[:50]}...")

            for filepath in possible_files[:2]:  # 只测试前两个
                url = f"{mirror}/{self.owner}/{self.repo}/{self.branch}/{filepath}"
                try:
                    response = self.session.head(url, timeout=10)
                    if response.status_code == 200:
                        print(f"    ✓ 找到可访问的镜像!")
                        # 返回该镜像和文件列表
                        return [mirror, possible_files]
                except:
                    pass

        print("  ✗ 所有镜像均无法访问")
        return []

    def get_file_via_mirror(self, mirror: str, filepath: str) -> str:
        """通过镜像获取文件内容"""
        url = f"{mirror}/{self.owner}/{self.repo}/{self.branch}/{filepath}"
        try:
            response = self.session.get(url, timeout=30)
            if response.status_code == 200:
                return response.text
        except Exception as e:
            pass
        return ""

    def parse_prompt_file(self, content: str, filepath: str) -> Dict[str, Any]:
        """解析提示词文件"""
        parts = filepath.replace(".md", "").split("/")
        category = parts[-2] if len(parts) >= 3 else "通用"
        filename = parts[-1]

        title = filename.replace("-", " ").strip()
        prompt = self._extract_prompt(content)

        hash_val = int(hashlib.md5(filepath.encode()).hexdigest()[:8], 16)
        template_id = f"nbp-{hash_val % 10000:04d}"

        channels, materials, industries, ratio = self._classify_template(category, title, content)

        template = {
            "id": template_id,
            "title": f"Nano Banana·{title}",
            "channels": channels,
            "materials": materials,
            "industries": industries,
            "ratio": ratio,
            "preview": "",
            "image": "",
            "prompt": prompt[:500],
            "prompt_params": self._extract_params(content),
            "tips": f"{category}类提示词模板，适用于{title}风格的图像生成",
            "source": {
                "name": "@xianyu110",
                "label": "GitHub",
                "url": f"https://github.com/xianyu110/awesome-nanobananapro-prompts/blob/master/{filepath}"
            }
        }
        return template

    def _extract_prompt(self, content: str) -> str:
        """提取提示词内容"""
        lines = content.split("\n")
        prompt = ""
        in_code_block = False

        for line in lines:
            stripped = line.strip()
            if stripped.startswith("```"):
                in_code_block = not in_code_block
                continue
            if in_code_block and stripped:
                prompt = stripped
                break
            elif not in_code_block and stripped and not stripped.startswith("#") and len(stripped) > 20:
                if self._is_english_prompt(stripped):
                    prompt = stripped
                    break

        if not prompt:
            for line in lines:
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and len(stripped) > 10:
                    prompt = stripped
                    break

        return prompt if prompt else "高质量图像生成提示词"

    def _is_english_prompt(self, text: str) -> bool:
        """判断是否是英文提示词"""
        english_chars = sum(1 for c in text if c.isalpha() and ord(c) < 128)
        total_chars = sum(1 for c in text if c.isalpha())
        return total_chars > 0 and english_chars / total_chars > 0.7

    def _classify_template(self, category: str, title: str, content: str) -> tuple:
        """智能分类模板"""
        title_lower = title.lower()
        category_lower = category.lower()

        if category == "肖像" or "portrait" in category_lower:
            channels = ["生活", "小红书"]
        elif category == "摄影" or "photography" in category_lower:
            channels = ["电商", "广告营销"]
        elif category == "设计" or "design" in category_lower:
            channels = ["电商", "广告营销"]
        elif category == "场景" or category == "艺术风格":
            channels = ["娱乐", "短视频平台"]
        else:
            channels = ["全部"]

        if "肖像" in category_lower or "角色" in title_lower or "character" in title_lower or "portrait" in title_lower:
            materials = ["个人写真"]
        elif "logo" in title_lower:
            materials = ["产品设计"]
        elif "产品" in title_lower or "product" in title_lower:
            materials = ["产品展示"]
        elif "海报" in title_lower or "poster" in title_lower:
            materials = ["电影海报", "广告图"]
        elif "风景" in title_lower or "landscape" in title_lower:
            materials = ["全屏海报"]
        elif "漫画" in category_lower or "comic" in title_lower:
            materials = ["漫画插图"]
        else:
            materials = ["全部"]

        if "美食" in title_lower or "food" in title_lower:
            industries = ["美食餐饮"]
        elif "时尚" in title_lower or "fashion" in title_lower:
            industries = ["服饰箱包"]
        elif "建筑" in title_lower or "室内" in title_lower or "architectural" in title_lower or "interior" in title_lower:
            industries = ["建筑", "家居家装"]
        elif "logo" in title_lower or "设计" in title_lower:
            industries = ["广告营销"]
        else:
            industries = ["通用"]

        if "肖像" in category_lower or "portrait" in title_lower:
            ratio = "9:16"
        elif "风景" in title_lower or "landscape" in title_lower:
            ratio = "16:9"
        elif "海报" in title_lower or "poster" in title_lower:
            ratio = "3:4"
        else:
            ratio = "1:1"

        return channels, materials, industries, ratio

    def _extract_params(self, content: str) -> str:
        """提取参数说明"""
        lines = content.split("\n")
        for line in lines:
            stripped = line.strip()
            if any(kw in stripped.lower() for kw in ["parameter", "建议", "参数", "tip"]):
                return stripped[:100]
        return "可根据需要调整提示词中的风格、细节和质量参数"

    def extract_all_templates(self) -> List[Dict[str, Any]]:
        """提取所有模板"""
        templates = []

        # 方式1: Git Clone
        if self.clone_with_http1():
            template_files = self.find_template_files()
            if template_files:
                for i, filepath in enumerate(template_files, 1):
                    filename = filepath.split("/")[-1]
                    print(f"[{i}/{len(template_files)}] {filename}")

                    content = self.read_file_content(filepath)
                    if content and len(content) > 10:
                        try:
                            template = self.parse_prompt_file(content, filepath)
                            templates.append(template)
                            print(f"  ✓ 成功: {template['id']} - {template['title']}")
                        except Exception as e:
                            print(f"  ✗ 解析失败: {e}")

                self.cleanup()
                return templates

        # 方式2: 镜像方式
        result = self.extract_via_html()
        if result and len(result) >= 2:
            mirror, file_list = result[0], result[1:]
            print(f"\n使用镜像获取，共 {len(file_list)} 个文件")

            for i, filepath in enumerate(file_list, 1):
                filename = filepath.split("/")[-1]
                print(f"[{i}/{len(file_list)}] {filename}")

                content = self.get_file_via_mirror(mirror, filepath)
                if content and len(content) > 10:
                    try:
                        template = self.parse_prompt_file(content, filepath)
                        templates.append(template)
                        print(f"  ✓ 成功: {template['id']} - {template['title']}")
                    except Exception as e:
                        print(f"  ✗ 解析失败: {e}")
                else:
                    print(f"  - 跳过")

        return templates

    def find_template_files(self) -> List[str]:
        """查找所有模板文件"""
        template_files = []
        target_dir = os.path.join(self.temp_dir, "gpt4o-image-prompts-master")

        if not os.path.exists(target_dir):
            print(f"目标目录不存在: {target_dir}")
            print("可用目录:", os.listdir(self.temp_dir) if os.path.exists(self.temp_dir) else "N/A")
            return template_files

        print(f"\n扫描目录: {target_dir}")

        for root, dirs, files in os.walk(target_dir):
            for file in files:
                if file.endswith(".md") and file != "README.md":
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, self.temp_dir)
                    template_files.append(rel_path)
                    print(f"  找到: {rel_path}")

        return template_files

    def read_file_content(self, filepath: str) -> str:
        """读取文件内容"""
        full_path = os.path.join(self.temp_dir, filepath)
        try:
            with open(full_path, 'r', encoding='utf-8') as f:
                return f.read()
        except Exception as e:
            return ""

    def cleanup(self):
        """清理临时文件"""
        import shutil
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
            print(f"\n已清理临时目录: {self.temp_dir}")

    def run(self) -> List[Dict[str, Any]]:
        """执行提取"""
        print("=" * 60)
        print("从 GitHub 提取 Nano Banana Pro 模板")
        print("=" * 60)

        templates = self.extract_all_templates()

        print(f"\n{'=' * 60}")
        print(f"提取完成！共获取 {len(templates)} 个模板")
        print("=" * 60)

        return templates


def main():
    """主函数"""
    extractor = NanoBananaTemplateExtractor()
    templates = extractor.run()

    if templates:
        output_file = "extracted_templates.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(templates, f, ensure_ascii=False, indent=2)

        print(f"\n模板已保存到: {output_file}")

        print("\n=== 模板预览 ===")
        for i, template in enumerate(templates[:5], 1):
            print(f"\n{i}. {template['title']}")
            print(f"   ID: {template['id']}")
            print(f"   分类: {template['channels']}, {template['materials']}, {template['industries']}")
            print(f"   提示词: {template['prompt'][:60]}...")
    else:
        print("\n未能提取到任何模板")
        print("提示：可能需要配置网络代理或稍后重试")


if __name__ == "__main__":
    main()
