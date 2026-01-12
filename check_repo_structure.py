#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
检查 GitHub 仓库结构
"""

import requests
import json

# 尝试不同的路径
owner = "xianyu110"
repo = "awesome-nanobananapro-prompts"
branch = "main"
mirror_base = "https://ghproxy.net/https://raw.githubusercontent.com"

# 尝试获取 README
paths_to_try = [
    "README.md",
    "gpt4o-image-prompts-master/README.md",
    "gpt4o-image-prompts-master/",
]

print("=" * 60)
print("检查 GitHub 仓库结构")
print("=" * 60)

session = requests.Session()

# 首先尝试获取仓库的基本信息
print("\n1. 尝试获取 README.md...")
url = f"{mirror_base}/{owner}/{repo}/{branch}/README.md"
print(f"   URL: {url}")
try:
    resp = session.get(url, timeout=20)
    print(f"   状态码: {resp.status_code}")
    if resp.status_code == 200:
        print("   内容预览:")
        print(resp.text[:500])
except Exception as e:
    print(f"   错误: {e}")

# 尝试获取 gpt4o-image-prompts-master 目录下的 README
print("\n2. 尝试获取 gpt4o-image-prompts-master/README.md...")
url = f"{mirror_base}/{owner}/{repo}/{branch}/gpt4o-image-prompts-master/README.md"
print(f"   URL: {url}")
try:
    resp = session.get(url, timeout=20)
    print(f"   状态码: {resp.status_code}")
    if resp.status_code == 200:
        print("   内容预览:")
        print(resp.text[:500])
except Exception as e:
    print(f"   错误: {e}")

# 尝试列出可能的文件
print("\n3. 尝试查找一些常见文件...")
possible_files = [
    "gpt4o-image-prompts-master/portrait.md",
    "gpt4o-image-prompts-master/anime.md",
    "gpt4o-image-prompts-master/painting.md",
    "gpt4o-image-prompts-master/3d.md",
    "gpt4o-image-prompts-master/logo.md",
    "gpt4o-image-prompts-master/poster.md",
    "gpt4o-image-prompts-master/product.md",
    "gpt4o-image-prompts-master/food.md",
    "gpt4o-image-prompts-master/fashion.md",
    "gpt4o-image-prompts-master/landscape.md",
    "gpt4o-image-prompts-master/cyberpunk.md",
]

for filename in possible_files:
    url = f"{mirror_base}/{owner}/{repo}/{branch}/{filename}"
    try:
        resp = session.get(url, timeout=10)
        if resp.status_code == 200:
            print(f"   ✓ 找到文件: {filename}")
            print(f"      内容预览: {resp.text[:100]}...")
            break
    except:
        pass

# 尝试其他可能的分支
print("\n4. 尝试其他分支...")
other_branches = ["master"]
for br in other_branches:
    url = f"{mirror_base}/{owner}/{repo}/{br}/README.md"
    try:
        resp = session.get(url, timeout=10)
        if resp.status_code == 200:
            print(f"   ✓ 分支 {br} 存在")
            print(f"      内容预览: {resp.text[:200]}...")
            break
    except:
        pass

print("\n" + "=" * 60)
