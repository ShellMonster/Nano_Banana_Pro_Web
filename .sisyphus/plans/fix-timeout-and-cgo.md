# fix: 前端超时检测 + 后端 CGO 编译

## TL;DR

> 两个 bug 修复：
> 1. 前端添加独立超时检测，防止任务无限等待
> 2. 后端 release.yml 添加 CGO_ENABLED=1，解决 macOS 用户数据库无法连接问题
>
> **Deliverables**:
> - `desktop/src/hooks/useGenerate.ts` — 添加超时检测
> - `.github/workflows/release.yml` — 添加 CGO_ENABLED=1
>
> **Estimated Effort**: Short
> **Parallel Execution**: YES — 2 个改动可并行
> **Critical Path**: Task 1 + Task 2 并行 → Task 3 commit

---

## Context

### Bug 1: 超时 1000+ 秒

**问题**：用户反馈生图生成有时会显示"一千多秒还在生成"

**根因**：前端 `ImageCard.tsx` 只计算并显示经过时间，**没有独立超时检测**。系统完全依赖后端状态更新，但如果后端状态卡住，前端会无限等待。

**代码位置**：
- `desktop/src/hooks/useGenerate.ts` — 生成逻辑，无超时上限
- `desktop/src/components/GenerateArea/ImageCard.tsx:61-82` — 只显示 elapsed，无超时检测

### Bug 2: CGO_ENABLED=0 导致数据库无法连接

**问题**：用户日志显示：
```
无法连接数据库：Binary was compiled with 'CGO_ENABLED=0', go-sqlite3 requires cgo to work. This is a stub
```

**根因**：`.github/workflows/release.yml` 第 150-153 行的 `go build` 命令没有设置 `CGO_ENABLED=1`：

```yaml
cd backend && GOOS=darwin GOARCH=arm64 go build -o ...
```

`go-sqlite3` 是 CGO 库，必须 `CGO_ENABLED=1` 才能正常编译。

---

## Work Objectives

### Must Have
- 前端添加基于 `imageTimeoutSeconds` 的超时检测
- 后端 release.yml 所有 go build 命令前加 `CGO_ENABLED=1`

### Must NOT Have
- 不改变后端超时逻辑
- 不改变前端 UI 样式

---

## Execution Strategy

```
Wave 1 (并行):
├── Task 1: useGenerate.ts — 添加超时检测
└── Task 2: release.yml — 添加 CGO_ENABLED=1

Wave 2 (串行):
└── Task 3: 验证 + commit + push + PR
```

---

## TODOs

- [ ] 1. 修复 `desktop/src/hooks/useGenerate.ts` — 添加超时检测

  **What to do**:

  在 `useGenerate.ts` 中添加基于 `imageTimeoutSeconds` 的超时检测逻辑。

  找到轮询或任务状态检测的位置，添加超时检测：

  ```typescript
  // 在 useGenerate hook 中添加超时检测
  const imageTimeoutSeconds = useConfigStore((s) => s.imageTimeoutSeconds);
  
  // 在轮询/同步任务状态时检测超时
  const checkTimeout = useCallback((taskId: string, startTime: number) => {
    const timeoutMs = (imageTimeoutSeconds || 500) * 1000;
    const elapsed = Date.now() - startTime;
    if (elapsed > timeoutMs) {
      // 标记任务超时失败
      updateTaskStatus(taskId, 'failed', `操作超时（${imageTimeoutSeconds}秒）`);
      return true;
    }
    return false;
  }, [imageTimeoutSeconds]);
  ```

  具体实现需要根据实际代码结构调整，核心是：
  1. 获取 `imageTimeoutSeconds` 配置
  2. 在任务开始时记录 `startTime`
  3. 在轮询/SSE 时检测是否超时
  4. 超时时主动标记任务失败

  **Parallelization**: YES（与 Task 2 并行）

  **References**:
  - `desktop/src/hooks/useGenerate.ts` — 生成逻辑
  - `desktop/src/store/configStore.ts:104` — imageTimeoutSeconds 默认值

---

- [ ] 2. 修复 `.github/workflows/release.yml` — 添加 CGO_ENABLED=1

  **What to do**:

  找到所有 `go build` 命令（约第 150, 151, 153 行），在前面加上 `CGO_ENABLED=1`：

  **改动前**:
  ```yaml
  cd backend && GOOS=darwin GOARCH=arm64 go build -o ../desktop/src-tauri/bin/server-aarch64-apple-darwin cmd/server/main.go
  cd .. && cd backend && GOOS=darwin GOARCH=amd64 go build -o ../desktop/src-tauri/bin/server-x86_64-apple-darwin cmd/server/main.go
  cd .. && cd backend && GOOS=darwin GOARCH=amd64 go build -o ../desktop/src-tauri/bin/server-x86_64-apple-darwin cmd/server/main.go
  ```

  **改动后**:
  ```yaml
  cd backend && CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 go build -o ../desktop/src-tauri/bin/server-aarch64-apple-darwin cmd/server/main.go
  cd .. && cd backend && CGO_ENABLED=1 GOOS=darwin GOARCH=amd64 go build -o ../desktop/src-tauri/bin/server-x86_64-apple-darwin cmd/server/main.go
  cd .. && cd backend && CGO_ENABLED=1 GOOS=darwin GOARCH=amd64 go build -o ../desktop/src-tauri/bin/server-x86_64-apple-darwin cmd/server/main.go
  ```

  **Parallelization**: YES（与 Task 1 并行）

  **References**:
  - `.github/workflows/release.yml:150-153` — go build 命令位置

---

- [ ] 3. 验证 + commit + push + PR

  **What to do**:
  1. `cd desktop && npm run type-check` — exit 0
  2. `git checkout main && git pull && git checkout -b fix/timeout-and-cgo`
  3. `git add desktop/src/hooks/useGenerate.ts .github/workflows/release.yml`
  4. `git commit -m "fix: add frontend timeout detection + enable CGO for SQLite"`
  5. `git push -u origin fix/timeout-and-cgo`
  6. `gh pr create`

---

## Success Criteria

- [ ] 前端任务超过 `imageTimeoutSeconds` 后自动标记失败
- [ ] 后端 release.yml 所有 go build 命令都有 CGO_ENABLED=1
- [ ] TypeScript 检查通过
