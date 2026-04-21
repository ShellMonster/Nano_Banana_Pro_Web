# CLAUDE.md — Banana Pro AI 项目指南

> 本文件为 AI 编码助手提供项目上下文，遵循 Anthropic CLAUDE.md 最佳实践。

## 项目概述

**大香蕉 AI (Banana Pro AI)** — 跨平台 AI 图片生成应用，支持 Gemini 和 OpenAI 标准接口。

- **版本**: v2.8.0
- **协议**: MIT
- **仓库**: ShellMonster/Nano_Banana_Pro_Web

三层架构：React 前端 → Tauri (Rust IPC 桥) → Go Sidecar 后端。桌面端通过 Tauri 打包，Web 端通过 Docker + Nginx 部署。

## 常用命令

```bash
# 后端
cd backend && go run cmd/server/main.go    # 启动后端 (默认 :8080)
make build                                  # 编译
make run                                    # 运行

# 桌面端 (前端 + Tauri)
cd desktop && npm install && npm run tauri dev

# Web 前端 (独立版，非 Tauri)
cd frontend && npm install && npm run dev

# 打包发布
cd desktop && npm run tauri build           # 本地构建桌面安装包

# Docker 部署 (Web 版)
docker compose -p banana-pro up -d

# 发布流程
git tag v2.8.0 && git push origin v2.8.0   # 触发 GitHub Actions 自动构建
```

## 项目结构

```
backend/                   # Go 后端 (Sidecar)
├── cmd/server/main.go     # 服务入口、路由注册、生命周期
├── internal/
│   ├── api/               # API Handlers (generate, folders, templates, export, history, config, images)
│   ├── provider/          # AI 提供商适配器
│   │   ├── gemini.go      # Gemini /v1beta 接口
│   │   ├── openai.go      # OpenAI /v1/chat/completions (多模态)
│   │   ├── openai_image.go # OpenAI /v1/images/generations (gpt-image-2-all)
│   │   └── model_resolver.go # 模型名称解析
│   ├── worker/pool.go     # Worker 池 (6 workers, 100 queue, panic recovery)
│   ├── model/             # 数据模型 (ProviderConfig, Task, Folder)
│   ├── storage/storage.go # 存储层 (本地文件系统 + 可选阿里云 OSS)
│   ├── config/config.go   # Viper 配置管理
│   ├── templates/store.go # 模板市场 (935+ 模板, 内嵌+远程+缓存)
│   ├── promptopt/service.go # 提示词优化 (text/json 模式, singleflight, 10min cache)
│   ├── diagnostic/        # 日志 & 错误分类 (20+ 类别)
│   ├── folder/            # 文件夹管理 (自动月分组 + 手动文件夹)
│   └── platform/runtime.go # 运行环境检测 (Tauri/Docker)

desktop/                   # Tauri 桌面端
├── src/
│   ├── components/        # 37 React 组件
│   ├── store/             # 8 个 Zustand Store (configStore migration v19)
│   ├── hooks/             # 6 个自定义 Hook
│   ├── services/          # 8 个 API 服务文件
│   ├── i18n/locales/      # 4 种语言 (zh-CN, en-US, ja-JP, ko-KR)
│   └── types/             # TypeScript 接口定义
├── src-tauri/
│   ├── Cargo.toml         # Rust 依赖
│   ├── tauri.conf.json    # Tauri 配置 (窗口、权限、Updater)
│   └── capabilities/      # Tauri 权限声明
└── package.json

frontend/                  # 独立 Web 前端 (v2.5.2, 非 Tauri)
```

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 前端 | React + TypeScript + Zustand | 18.3.1 |
| 桌面容器 | Tauri (Rust) | 2.0 |
| 后端 | Go + Gin | 1.21+ |
| 数据库 | SQLite (via mattn/go-sqlite3) | - |
| CI/CD | GitHub Actions | release.yml + pr-check.yml |
| 部署 | Docker multi-stage (Alpine + Nginx) | - |

## AI 提供商架构

项目支持 3 种 AI 提供商，通过 `ProviderType` 区分：

| Provider | API Endpoint | 用途 |
|---|---|---|
| `gemini` | `/v1beta/models/{model}:generateContent` | 文生图/图生图，支持 4K |
| `openai` | `/v1/chat/completions` (多模态) | 文生图/图生图/提示词优化 |
| `openai-image` | `/v1/images/generations` | 专用图片生成 (gpt-image-2-all) |

- 提供商配置热更新：存储在 SQLite，修改后立即生效，无需重启
- 默认模型：`gemini-2.0-flash-exp` (gemini), `gpt-4o` (openai), `gpt-image-2-all` (openai-image)

## 关键架构决策

1. **asset:// 协议**：桌面端注册原生资源协议，绕过 HTTP 栈加载本地图片，速度提升 300%
2. **Sidecar 模式**：Go 后端作为 Tauri sidecar 运行，Tauri 退出时自动清理进程
3. **Worker 池**：6 workers + 100-slot 队列，per-provider 超时，panic 自动恢复
4. **IPC 优化**：前后端只传文件路径，二进制数据通过 asset:// 协议直读
5. **Prompt 优化**：singleflight 去重 + 10min 缓存，支持 text/json 两种输出模式
6. **模板市场**：内嵌 JSON + 远程 GitHub Raw + 本地缓存三层策略，24h 自动刷新

## 代码风格

### Go 后端
- 标准 Go 项目布局 (`cmd/`, `internal/`)
- Gin 框架，中间件链式调用
- 错误处理：使用 `internal/diagnostic` 分类错误，返回结构化 JSON
- 配置：Viper 读取 `config.yaml`，环境变量覆盖
- 数据库：`database/sql` + `mattn/go-sqlite3`，不使用 ORM

### React 前端
- 函数组件 + Hooks，无 Class 组件
- Zustand 状态管理，`configStore` 管理 provider 配置和迁移
- API 调用集中在 `services/` 目录
- i18n 使用 `react-i18next`，翻译文件在 `i18n/locales/`
- Tailwind CSS 样式

### 通用
- 中文注释解释「为什么」而非「做什么」
- 提交信息格式：`feat:`, `fix:`, `chore:`, `docs:`
- 版本号统一在 `Cargo.toml`, `tauri.conf.json`, `package.json`, `Cargo.lock`, `package-lock.json`

## 注意事项 & 易错点

1. **端口冲突**：Go sidecar 监听 `127.0.0.1:8080`，确保无其他进程占用。调试时检查 `lsof -i :8080`
2. **模型名称**：`openai-image` provider 默认模型是 `gpt-image-2-all`（v2.8.0 更新），不支持 `quality` 参数
3. **版本同步**：发布前确保 5 个文件的版本号一致（见上方「通用」部分）
4. **Tauri 权限**：新功能涉及文件系统/网络访问时需更新 `capabilities/default.json`
5. **Docker vs Desktop**：后端通过 `platform/runtime.go` 检测运行环境，Docker 监听 `0.0.0.0`，Tauri 监听 `127.0.0.1`
6. **configStore 迁移**：前端配置存储在 localStorage，版本迁移在 `configStore.ts` 的 `migrations` 中处理，当前版本 v19
7. **图片存储路径**：桌面端默认 `~/Library/Application Support/com.banana.pro/` (macOS)，`%APPDATA%/com.banana.pro/` (Windows)

## 测试

项目当前无自动化测试套件。验证方式：
- `cd desktop && npm run tauri dev` 启动桌面端手动测试
- `cd backend && go run cmd/server/main.go` 启动后端，用 curl 测试 API
- Docker: `docker compose up -d` 后访问 `http://localhost:8090`

## CI/CD

- **release.yml**: 推送 `v*` tag 触发，构建 macOS ARM/Universal + Windows x64，生成 latest.json + .sig 签名
- **pr-check.yml**: PR 触发，运行后端 `go vet` + 前端 `npm run build` 检查
- GitHub Secrets 需配置：`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
