# P0-P2 优化执行设计

## 背景

当前项目是 React 桌面前端、Tauri 容器、Go Sidecar 后端以及 Docker Web 版并存的三层架构。代码体检发现的 P0-P2 问题横跨前端渲染、后端内存与日志、CI 发布可靠性、Docker/Nginx 配置和文档维护。

用户要求：P0-P2 全部逐一处理；每个优化项完成后都要更新 `CLAUDE.md` 与 `README.md`，并单独提交 commit。

## 目标

1. 用小步、可验证、可回滚的方式处理所有 P0-P2 优化项。
2. 每个提交只解决一个清晰问题，避免跨模块大杂烩提交。
3. 每项改动都同步项目说明，保证后续 AI/开发者能理解新的约束与验证方式。
4. 优先处理低风险、高收益、对后续工作有铺垫作用的项目。

## 非目标

1. 不一次性重构整个前端或后端。
2. 不引入大型新框架。
3. 不改变图片生成核心业务行为，除非该行为本身存在稳定性风险。
4. 不把所有 P0-P2 混成一个大 commit。

## 执行顺序

### 第一阶段：CI 与发布可靠性

#### P1-01：统一 Go CI 版本

- 改动范围：`.github/workflows/pr-check.yml`、`.github/workflows/release.yml`、`CLAUDE.md`、`README.md`。
- 验收标准：CI 中 Go 版本来源与 `backend/go.mod` 一致，不再固定为旧版本。
- 必跑验证：人工核对 GitHub Actions YAML；本地执行 `cd backend && go test ./... && go vet ./...`。
- 文档更新点：说明 CI Go 版本应跟随 `backend/go.mod`。
- commit 示例：`ci: align go workflow version`

#### P1-02：修正 PR smoke test 健康检查

- 改动范围：`.github/workflows/pr-check.yml`、`CLAUDE.md`、`README.md`。
- 验收标准：smoke test 检查 `/api/v1/health`，失败会阻断 PR。
- 必跑验证：人工核对 GitHub Actions YAML；本地启动后端时用 `curl -sf http://localhost:8080/api/v1/health` 验证。
- 文档更新点：记录标准健康检查路径。
- commit 示例：`ci: fix backend smoke health check`

#### P1-03：发布流程使用可复现安装

- 改动范围：`.github/workflows/release.yml`、`CLAUDE.md`、`README.md`。
- 验收标准：发布构建阶段使用 `npm ci`，不使用 `npm install` 生成发布产物。
- 必跑验证：人工核对 GitHub Actions YAML；本地执行 `cd desktop && npm ci --prefer-offline` 如依赖环境允许。
- 文档更新点：说明发布构建必须尊重 lockfile。
- commit 示例：`ci: use npm ci for release builds`

理由：这些改动风险低，可以先提高后续每个优化项的验证可信度。

### 第二阶段：后端稳定性与资源边界

#### P0-01：限制参考图上传和本地读取大小

- 改动范围：`backend/internal/api/multipart_helper.go`、相关本地参考图读取逻辑、`CLAUDE.md`、`README.md`。
- 验收标准：单图大小、总大小、参考图数量都有明确限制；超限返回清晰错误。
- 必跑验证：`cd backend && go test ./... && go vet ./...`；必要时用超大文件做手动验证。
- 文档更新点：说明参考图上传限制和错误行为。
- commit 示例：`fix: limit reference image upload size`

#### P0-02：Provider 响应日志摘要化

- 改动范围：`backend/internal/provider/*.go`、诊断日志辅助逻辑、`CLAUDE.md`、`README.md`。
- 验收标准：默认日志不写完整 base64 响应体；保留状态码、耗时、request id、body 长度和安全摘要。
- 必跑验证：`cd backend && go test ./... && go vet ./...`。
- 文档更新点：说明诊断日志默认脱敏和限长。
- commit 示例：`fix: summarize provider response logs`

#### P1-04：HTTP Server 增加基础超时

- 改动范围：`backend/cmd/server/main.go`、`CLAUDE.md`、`README.md`。
- 验收标准：Server 配置 `ReadHeaderTimeout`、`ReadTimeout`、`WriteTimeout`、`IdleTimeout`；SSE 不被误伤。
- 必跑验证：`cd backend && go test ./... && go vet ./...`；本地启动后端并验证 `/api/v1/health`。
- 文档更新点：说明服务端连接超时策略。
- commit 示例：`fix: add backend server timeouts`

#### P2-01：降低 Worker 超时后资源占用风险

- 改动范围：`backend/internal/worker/pool.go`、必要的 Provider 调用约束、`CLAUDE.md`、`README.md`。
- 验收标准：超时后不会无限积累后台 Provider goroutine；失败状态保持准确。
- 必跑验证：`cd backend && go test ./... && go vet ./...`。
- 文档更新点：说明 Worker 超时与 Provider context 约束。
- commit 示例：`fix: tighten worker timeout handling`

理由：这些项直接影响内存、磁盘日志、异常请求防护和长时间运行稳定性。

### 第三阶段：前端性能

#### P0-03：模板市场虚拟化

- 改动范围：`desktop/src/components/TemplateMarket/TemplateMarketDrawer.tsx` 及必要子组件、`CLAUDE.md`、`README.md`。
- 验收标准：模板列表不再一次性渲染全部模板；搜索、筛选、预览、应用模板保持可用。
- 必跑验证：`cd desktop && npm run type-check && npm run build`。
- 文档更新点：说明模板市场使用虚拟化以支撑大规模模板。
- commit 示例：`perf: virtualize template market grid`

#### P1-05：关闭图片 URL 热路径默认日志

- 改动范围：`desktop/src/services/api.ts`、诊断开关相关逻辑、`CLAUDE.md`、`README.md`。
- 验收标准：默认批量图片渲染不刷控制台；开启诊断时仍可排查图片 URL。
- 必跑验证：`cd desktop && npm run type-check && npm run build`。
- 文档更新点：说明图片 URL 日志只在诊断模式输出。
- commit 示例：`perf: gate image url diagnostics`

#### P1-06：收敛 Zustand 宽订阅

- 改动范围：宽订阅组件，例如 `SettingsModal`、`BatchSettings`、`BatchActions`、`Toast`，以及 `CLAUDE.md`、`README.md`。
- 验收标准：组件只订阅实际使用字段；不改变 UI 行为。
- 必跑验证：`cd desktop && npm run type-check && npm run build`。
- 文档更新点：说明 Zustand 新代码应使用 selector 和浅比较。
- commit 示例：`perf: narrow zustand subscriptions`

#### P1-07：历史缓存瘦身

- 改动范围：`desktop/src/store/historyStore.ts`、相关缓存迁移逻辑、`CLAUDE.md`、`README.md`。
- 验收标准：localStorage 不再持久化过重派生数据；历史列表加载和同步行为保持正确。
- 必跑验证：`cd desktop && npm run type-check && npm run build`。
- 文档更新点：说明历史缓存只保存轻量字段。
- commit 示例：`perf: slim persisted history cache`

理由：这些项收益明显，但前端 UI 改动需要更谨慎验证，所以放在 CI/后端边界之后。

### 第四阶段：Docker/Web 部署

#### P2-02：处理 Docker Web 版版本滞后

- 改动范围：`frontend/package.json`、Docker 构建入口或版本同步检查、`CLAUDE.md`、`README.md`。
- 验收标准：明确 Web 版是继续独立还是跟随桌面版；如果跟随，版本和关键说明同步。
- 必跑验证：`cd frontend && npm run type-check && npm run build`；必要时 `docker compose config`。
- 文档更新点：说明 Web 版与桌面版的同步策略。
- commit 示例：`chore: align web frontend version strategy`

#### P2-03：修复 Nginx Upgrade 头配置

- 改动范围：`docker/nginx.conf`、`CLAUDE.md`、`README.md`。
- 验收标准：`Connection` 头不被重复覆盖；长连接代理配置清晰。
- 必跑验证：`docker compose config`；必要时构建 Docker 镜像。
- 文档更新点：说明 Nginx 长连接代理配置。
- commit 示例：`fix: correct nginx upgrade headers`

#### P2-04：增强 Docker 健康检查

- 改动范围：`Dockerfile`、`docker-compose.yml`、`docker/nginx.conf`、`CLAUDE.md`、`README.md`。
- 验收标准：健康检查能覆盖后端 API 和前端/Nginx 静态服务，不只检查单一路径。
- 必跑验证：`docker compose config`；必要时 `docker compose build`。
- 文档更新点：说明 Docker 健康检查覆盖范围。
- commit 示例：`fix: improve docker health checks`

理由：这些项影响 Web 版部署体验，需要结合当前 Web/桌面分支策略小步推进。

### 第五阶段：可维护性整理

#### P2-05：合并重复 Provider/config API

- 改动范围：`desktop/src/services/configApi.ts`、`desktop/src/services/providerApi.ts`、相关调用方、`CLAUDE.md`、`README.md`。
- 验收标准：Provider 配置类型和更新方法只有一个权威来源；调用方通过统一入口使用。
- 必跑验证：`cd desktop && npm run type-check && npm run build`。
- 文档更新点：说明 Provider API 类型维护入口。
- commit 示例：`refactor: consolidate provider config api`

#### P2-06：超大组件轻量拆分

- 改动范围：模板市场、参考图上传、设置弹窗中当前正在触碰的文件，及 `CLAUDE.md`、`README.md`。
- 验收标准：每次只拆一个明确职责；UI 行为不变；不做整文件重写。
- 必跑验证：`cd desktop && npm run type-check && npm run build`。
- 文档更新点：说明大组件拆分原则。
- commit 示例：`refactor: split template market components`

#### P2-07：清理或明确 React Query 策略

- 改动范围：`desktop/src/App.tsx`、`desktop/package.json`、可能的服务层调用、`CLAUDE.md`、`README.md`。
- 验收标准：如果不用 React Query，则移除无效 Provider/依赖；如果保留，则明确后续迁移入口。
- 必跑验证：`cd desktop && npm run type-check && npm run build`。
- 文档更新点：说明数据请求策略。
- commit 示例：`chore: clarify react query usage`

#### P2-08：i18n 语言包延迟加载

- 改动范围：`desktop/src/i18n/index.ts`、语言切换逻辑、`CLAUDE.md`、`README.md`。
- 验收标准：默认语言可正常启动，其它语言切换时加载；四种语言仍可用。
- 必跑验证：`cd desktop && npm run type-check && npm run build`。
- 文档更新点：说明语言包加载策略。
- commit 示例：`perf: lazy load desktop locales`

#### P2-09：收敛 Tauri asset scope 与 CSP

- 改动范围：`desktop/src-tauri/tauri.conf.json`、必要的资源访问说明、`CLAUDE.md`、`README.md`。
- 验收标准：asset scope 尽量限制到应用数据/存储目录；CSP 不再完全关闭，且图片加载仍可用。
- 必跑验证：`cd desktop && npm run type-check && npm run build`；必要时 `npm run tauri build`。
- 文档更新点：说明 Tauri 安全边界。
- commit 示例：`fix: tighten tauri asset security`

理由：这些项更偏长期维护，收益稳定但需要避免牵连过广。

## 每项交付标准

每个优化项都必须满足以下条件后才能 commit：

1. 代码改动完成。
2. `CLAUDE.md` 更新对应开发约束、验证命令或注意事项。
3. `README.md` 更新用户/开发者可见说明。
4. 运行该优化项列出的必跑验证命令。
5. 验证通过后立即单独 commit，再进入下一项；禁止连续完成多项后批量提交。
6. 提交信息使用项目既有语义化风格，例如 `fix: align ci go version`。

## 风险与回滚

1. CI 版本变更可能暴露旧代码对新 Go toolchain 的不兼容；回滚方式是恢复原 workflow 版本并单独排查后端兼容性。
2. 健康检查失败阻断 PR 后，已有不稳定启动逻辑会更早暴露；回滚方式是临时恢复容错，但必须记录原因。
3. 上传大小限制可能影响用户超大参考图；需要给出清晰错误信息，而不是静默失败。
4. 日志摘要化不能丢失排障关键信息；需要保留 request id、状态码、耗时和响应长度。
5. Worker 超时调整可能改变失败时序；回滚方式是恢复原 goroutine 模式并补充监控。
6. 前端虚拟化可能影响模板市场滚动和响应式布局；需要重点验证搜索、筛选、预览、应用模板。
7. Nginx 头配置调整可能影响 SSE/WebSocket 兼容；回滚方式是恢复旧配置并保留失败案例。
8. i18n 延迟加载可能影响语言切换首屏；回滚方式是恢复静态导入。
9. Tauri CSP/asset scope 收敛可能阻断合法图片加载；回滚方式是扩大到上一个可用 scope，并记录缺失路径。
10. Docker Web 版本同步可能涉及 `frontend/` 与 `desktop/` 分叉策略；如范围扩大，应拆成独立提交处理。

每个 commit 都应能独立 revert，且不影响其他已完成优化项。

## 验证路线

1. 第一阶段完成后，确认 GitHub Actions 配置逻辑正确，本地命令能通过。
2. 第二阶段完成后，用后端测试与基础 API 启动检查验证。
3. 第三阶段完成后，用桌面前端 type-check/build 验证，并手动说明需重点回归的 UI 流程。
4. 第四阶段完成后，用 Docker 构建或配置检查验证。
5. 第五阶段完成后，做一次完整前后端验证。

## 提交策略

采用逐项提交：

- 每个优化项一个 commit。
- 文档与对应代码同 commit。
- 不把多个无依赖优化合并提交。
- 如果某项必须跨多个模块，先说明原因，并保持文件数量尽量少。
