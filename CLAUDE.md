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
curl http://localhost:8080/api/v1/health   # 标准健康检查接口
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
# Release CI
cd desktop && npm ci                       # 发布构建使用 lockfile 严格安装依赖
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
│   │   ├── openai_image.go # OpenAI /v1/images/generations (gpt-image-2)
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
│   ├── components/        # 38 React 组件
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

frontend/                  # 独立 Web 前端 (非 Tauri，Docker 构建入口；版本跟随 desktop/package.json)
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
| `openai-image` | `/v1/images/generations` | 专用图片生成 (gpt-image-2) |

- 提供商配置热更新：存储在 SQLite，修改后立即生效，无需重启
- 默认模型：`gemini-2.0-flash-exp` (gemini), `gpt-4o` (openai), `gpt-image-2` (openai-image)

## 关键架构决策

1. **asset:// 协议**：桌面端注册原生资源协议，绕过 HTTP 栈加载本地图片，速度提升 300%
2. **Sidecar 模式**：Go 后端作为 Tauri sidecar 运行，Tauri 退出时自动清理进程
3. **Worker 池**：6 workers + 100-slot 队列，per-provider 超时，provider 调用在 worker goroutine 内执行并带 panic 自动恢复
4. **IPC 优化**：前后端只传文件路径，二进制数据通过 asset:// 协议直读
5. **Prompt 优化**：singleflight 去重 + 10min 缓存，支持 text/json 两种输出模式
6. **模板市场**：内嵌 JSON + 远程 GitHub Raw + 本地缓存三层策略，24h 自动刷新；桌面端模板网格使用 `react-window` 虚拟化渲染，避免 935+ 模板一次性挂载
7. **服务端连接超时**：Go HTTP Server 使用 5s ReadHeaderTimeout、30s ReadTimeout、120s IdleTimeout；WriteTimeout 保持 0，避免截断任务状态 SSE 长连接
8. **Docker Nginx 长连接代理**：Web 版 Nginx 在 `http` 上下文使用 `$http_upgrade` 到 `$connection_upgrade` 的 `map`，API 代理只设置一个 `Connection $connection_upgrade`，兼容普通 HTTP 请求和 WebSocket/SSE 升级场景

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
- 桌面发布版本号统一在 `Cargo.toml`, `tauri.conf.json`, `desktop/package.json`, `Cargo.lock`, `desktop/package-lock.json`
- Docker Web 版仍构建 `frontend/`，`frontend/package.json` 与 `frontend/package-lock.json` 的根版本必须跟随 `desktop/package.json`，避免 Web 镜像与当前应用版本元数据脱节

## 注意事项 & 易错点

1. **端口冲突**：Go sidecar 监听 `127.0.0.1:8080`，标准健康检查接口为 `GET /api/v1/health`；确保无其他进程占用。调试时检查 `lsof -i :8080`
2. **模型名称**：`openai-image` provider 默认模型是 `gpt-image-2`（v2.8.0 更新），不支持 `quality` 参数
3. **版本同步**：发布前确保桌面版本文件一致，并同步 `frontend/package.json` / `frontend/package-lock.json` 根版本；Dockerfile 当前构建的是 `frontend/`，不要让 Web 镜像保留旧版本号
4. **Tauri 权限**：新功能涉及文件系统/网络访问时需更新 `capabilities/default.json`
5. **Docker vs Desktop**：后端通过 `platform/runtime.go` 检测运行环境，Docker 监听 `0.0.0.0`，Tauri 监听 `127.0.0.1`
6. **configStore 迁移**：前端配置存储在 localStorage，版本迁移在 `configStore.ts` 的 `migrations` 中处理，当前版本 v19
7. **图片存储路径**：桌面端默认 `~/Library/Application Support/com.banana.pro/` (macOS)，`%APPDATA%/com.banana.pro/` (Windows)
8. **参考图边界**：后端必须同时限制 multipart `refImages` 与桌面端本地 `refPaths`，最多 10 张、单张最多 20MB、总计最多 80MB；本地路径读取必须先 `os.Open`，对已打开文件执行 `file.Stat` 并校验普通文件/大小/总量，再通过有界读取与关闭 helper 读取，禁止回退到裸 `os.ReadFile`
9. **Provider 诊断日志**：OpenAI、Gemini、OpenAI Image 的响应日志和错误返回默认只能记录状态、耗时、请求 ID、响应长度和有界脱敏预览，禁止输出完整响应体、未脱敏错误体或完整 base64 图片数据
10. **HTTP Server 超时**：新增或修改后端 server 构造时必须保留 `ReadHeaderTimeout=5s`、`ReadTimeout=30s`、`IdleTimeout=120s`；不要给全局 `WriteTimeout` 设置短超时，因为 `/api/v1/tasks/:task_id/stream` 依赖 SSE 长连接保活
11. **Worker Provider 超时**：新增或修改 provider 时必须把传入的 `context.Context` 继续传递给 HTTP 请求/长耗时操作并及时返回；Worker 不再为 `Generate` 额外派生 goroutine，超时后会在 provider 返回时记录 `生成超时(...)`，provider panic 会转换为任务失败；provider 内部如需 `io.Pipe`/multipart writer goroutine，也必须监听同一个 context 并在取消时关闭管道
12. **模板市场渲染**：`desktop/src/components/TemplateMarket/TemplateMarketDrawer.tsx` 的模板列表必须保持响应式虚拟网格（2/3/4 列），只渲染可见 `TemplateCard`；修改搜索、筛选、预览或应用逻辑时不得回退为 `filteredTemplates.map(...)` 全量渲染
13. **图片 URL 诊断日志**：`desktop/src/services/api.ts` 的 `getImageUrl` 属于批量图片渲染热路径，URL 转换/回退日志必须通过 `getDiagnosticVerbose()` 或等价诊断开关门控；默认不得在控制台输出每张图片的 URL 生成日志
14. **Zustand 订阅范围**：桌面端组件不得直接调用 `useConfigStore()`、`useGenerateStore()`、`useToastStore()` 等整仓订阅；只读取单字段时使用 selector，读取多个字段/action 时使用 `useShallow` 包裹对象 selector，避免无关状态变化触发重渲染，同时不得改变 store state shape 或 persistence 行为
15. **历史缓存持久化**：`desktop/src/store/historyStore.ts` 的 `history-cache` localStorage 只允许保存轻量、有界的历史列表快照（当前最多 20 条）和分页元信息；持久化与旧缓存合并必须剥离 `url` / `thumbnailUrl` 等派生展示 URL，避免缓存膨胀，并确保 `hasMore` / `page` 仍能从下一页继续加载
16. **Nginx Upgrade 头**：修改 `docker/nginx.conf` 的 `/api/` 代理时不得同时设置多个 `proxy_set_header Connection`；必须保留 `proxy_http_version 1.1`、`Upgrade $http_upgrade`、`Connection $connection_upgrade`、现有 300s 读写超时，以及 `http` 级 `map $http_upgrade $connection_upgrade`，避免普通 API 请求被错误标记为 upgrade 或覆盖升级头
17. **Docker 健康检查覆盖范围**：Dockerfile 与 `docker-compose.yml` 的主容器健康检查必须保持一致，并通过 Nginx 同时验证前端入口 `/` 和后端 API `GET /api/v1/health`；不要只检查直连后端 `:8080`，否则无法发现 Nginx/静态前端不可用的问题
18. **Provider 配置 API 入口**：桌面端 `ProviderConfig` 类型和 `updateProviderConfig` 实现由 `desktop/src/services/providerApi.ts` 统一维护；`configApi.ts` 只能为兼容旧调用重导出这些符号或保留独立的旧接口包装，禁止再次复制 provider 配置类型或 `/providers/config` 更新逻辑
19. **模板市场组件边界**：`TemplateMarketDrawer.tsx` 负责抽屉生命周期、数据加载、过滤状态、预览和应用模板；搜索框、筛选 chip、分类筛选和刷新/数量栏由 `desktop/src/components/TemplateMarket/TemplateMarketFilters.tsx` 维护。继续拆分模板市场时一次只抽一个清晰职责，不得改变现有 Tailwind 样式、虚拟网格、搜索/筛选、预览或应用行为
20. **参考图上传逻辑边界**：`ReferenceImageUpload.tsx` 负责参考图区域 UI、点击/拖拽添加、压缩、持久化、预览和排序；剪贴板图片提取、Tauri 剪贴板兜底、全局 paste 捕获由同目录 `useReferenceImagePaste.ts` 维护。修改粘贴能力时优先调整该 hook，并保持现有 add/delete/drag/paste 行为和 Tailwind 样式不变

## 测试

项目当前无自动化测试套件。验证方式：
- `cd desktop && npm run tauri dev` 启动桌面端手动测试
- `cd backend && go run cmd/server/main.go` 启动后端，用 `curl http://localhost:8080/api/v1/health` 测试健康检查
- Docker: `docker compose up -d` 后访问 `http://localhost:8090`；容器健康检查会通过 Nginx 同时探测 `/` 和 `/api/v1/health`

## CI/CD

- **release.yml**: 推送 `v*` tag 触发，构建 macOS ARM/Universal + Windows x64，生成 latest.json + .sig 签名
- **pr-check.yml**: PR 触发，运行后端 `go vet` + 前端 `npm run build` 检查
- CI 的 Go 版本统一通过 `backend/go.mod` 的 `go` 指令读取，不在 workflow 中写死版本号
- Release 构建在 `desktop/package-lock.json` 存在时使用 `npm ci`，保证依赖安装严格跟随 lockfile
- GitHub Secrets 需配置：`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
