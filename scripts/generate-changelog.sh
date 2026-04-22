#!/usr/bin/env bash
# 用法: ./scripts/generate-changelog.sh <current_tag> [repo_url]
# 输出 GITHUB_OUTPUT 多行格式: body<<EOF ... EOF
set -euo pipefail

CURRENT_TAG="${1:?Usage: $0 <current_tag> [repo_url]}"
REPO_URL="${2:-}"

PREV_TAG=$(git describe --tags --abbrev=0 "$CURRENT_TAG^" 2>/dev/null || git rev-list --max-parents=0 HEAD)
echo "Previous tag: $PREV_TAG" >&2

CHANGED_FILES=$(git diff --name-only "$PREV_TAG".."$CURRENT_TAG" 2>/dev/null || true)

SUMMARY=""
# 检测变更文件是否匹配指定路径模式
touches() {
  printf "%s\n" "$CHANGED_FILES" | grep -qE "$1"
}

if touches "backend/internal/provider/"; then
  SUMMARY="${SUMMARY}
- AI 提供商接口适配与模型支持更新"
fi
if touches "backend/internal/worker/"; then
  SUMMARY="${SUMMARY}
- 任务并发处理引擎优化"
fi
if touches "backend/internal/templates/"; then
  SUMMARY="${SUMMARY}
- 模板市场资源更新"
fi
if touches "backend/internal/promptopt/"; then
  SUMMARY="${SUMMARY}
- 提示词智能优化引擎改进"
fi
if touches "backend/internal/(storage|config|folder)/"; then
  SUMMARY="${SUMMARY}
- 本地存储与配置管理优化"
fi
if touches "backend/internal/api/"; then
  SUMMARY="${SUMMARY}
- 后端 API 接口调整"
fi
if touches "desktop/src/components/"; then
  SUMMARY="${SUMMARY}
- 前端界面交互与组件体验升级"
fi
if touches "desktop/src/store/"; then
  SUMMARY="${SUMMARY}
- 前端状态管理逻辑更新"
fi
if touches "desktop/src/services/"; then
  SUMMARY="${SUMMARY}
- 前端 API 服务层调整"
fi
if touches "desktop/src-tauri/"; then
  SUMMARY="${SUMMARY}
- 桌面端 Tauri 容器与权限配置更新"
fi
if touches "desktop/src/i18n/"; then
  SUMMARY="${SUMMARY}
- 多语言国际化翻译更新"
fi
if touches "docker|Dockerfile|docker-compose|\.env\.example"; then
  SUMMARY="${SUMMARY}
- Docker 部署方案优化"
fi
if touches "\.github/"; then
  SUMMARY="${SUMMARY}
- CI/CD 构建与发布流程改进"
fi

NOISE_REGEX='^(chore|ci|release|bump|test|ignore)(\(|:|!|:)'
LOGS=$(git log "$PREV_TAG".."$CURRENT_TAG" --pretty=format:"%s" --no-merges 2>/dev/null || true)

FEATS=""
FIXES=""
DOCS=""
OTHERS=""

while IFS= read -r line; do
  [ -z "$line" ] && continue
  [[ $line =~ $NOISE_REGEX ]] && continue

  clean_line=$(printf "%s" "$line" | sed 's/`/\\`/g')

  # 剥离 conventional commit 前缀: feat: / feat(scope): / feat(scope)!: / fix!: 等
  stripped_line=$(printf "%s" "$clean_line" | sed -E 's/^[a-z]+(\([^)]*\))?!?:[[:space:]]*//')

  if [[ $line =~ ^feat ]]; then
    FEATS="$FEATS
- ${stripped_line}"
  elif [[ $line =~ ^fix ]]; then
    FIXES="$FIXES
- ${stripped_line}"
  elif [[ $line =~ ^docs ]]; then
    DOCS="$DOCS
- ${stripped_line}"
  elif [[ $line =~ ^refactor ]] || [[ $line =~ ^perf ]]; then
    FIXES="$FIXES
- ${clean_line}"
  else
    OTHERS="$OTHERS
- ${clean_line}"
  fi
done <<< "$LOGS"

BODY=""
if [ -n "$SUMMARY" ]; then
  BODY="${BODY}
### 📋 更新概要

本次发布主要涉及以下模块：${SUMMARY}
"
fi

[ -n "$FEATS" ] && BODY="${BODY}

### 🚀 新功能 (Features)${FEATS}
"
[ -n "$FIXES" ] && BODY="${BODY}

### 🔧 修复与优化 (Bug Fixes & Refactor)${FIXES}
"
[ -n "$DOCS" ] && BODY="${BODY}

### 📝 文档更新 (Documentation)${DOCS}
"
[ -n "$OTHERS" ] && BODY="${BODY}

### 📦 其他改动 (Others)${OTHERS}
"

[ -z "$BODY" ] && BODY="本次发布包含内部优化与稳定性提升。"

if [ -n "$REPO_URL" ] && [ "$PREV_TAG" != "$CURRENT_TAG" ]; then
  BODY="${BODY}

**Full Changelog**: ${REPO_URL}/compare/${PREV_TAG}...${CURRENT_TAG}"
fi

{
  printf "%s\n" "body<<EOF"
  printf "%s\n" "$BODY"
  printf "%s\n" "EOF"
}
