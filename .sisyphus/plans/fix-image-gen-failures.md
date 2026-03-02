# 修复生图失败 & 服务商扣费问题

## TL;DR

> **Quick Summary**: 修复3个导致"API已扣费但图片未生成"的Bug：Gemini nil pointer panic、多图只存第一张缺少警告日志、OpenAI图片URL下载失败静默跳过改为重试。
>
> **Deliverables**:
> - `backend/internal/provider/gemini.go` — 两处 nil pointer 保护
> - `backend/internal/worker/pool.go` — 多图警告日志
> - `backend/internal/provider/openai.go` — fetchImage 失败改为带重试的明确错误
>
> **Estimated Effort**: Quick
> **Parallel Execution**: NO - 三个独立 fix，顺序执行便于回滚
> **Critical Path**: Task 1 → Task 2 → Task 3

---

## Context

### Original Request
用户反映生图总是失败，但服务商还在扣费。Code Review 发现3个直接导致此问题的 Bug。

### Interview Summary
- **Bug2 处理方式**: 只存第一张图 + 打印警告日志，不改数据库 schema
- **Bug3 失败行为**: fetchImage 失败后加重试（最多3次，间隔1秒），重试全部失败才返回 error

### Metis Review
**Identified Gaps** (addressed):
- Bug2 修复方向已由用户确认：只存第一张 + 日志，不扩展 schema
- Bug3 失败行为已由用户确认：重试机制而非直接失败
- 三个 fix 保持独立 commit，便于回滚

---

## Work Objectives

### Core Objective
修复3个导致"API扣费但图片未出现"的 Bug，不引入任何新依赖，不改数据库结构。

### Concrete Deliverables
- `gemini.go` 两处 log.Printf 加 nil 保护
- `pool.go` 多图时打印警告日志
- `openai.go` fetchImage 加最多3次重试，间隔1秒

### Definition of Done
- [ ] 服务能正常编译：`cd backend && go build ./...` 无错误
- [ ] 不传 aspect_ratio 时 Gemini 不 panic
- [ ] count>1 时日志中出现多图警告
- [ ] fetchImage 失败时有重试日志，最终返回明确 error

### Must Have
- nil pointer 保护覆盖 gemini.go 两处（generateWithReferences + generateViaContent）
- fetchImage 重试最多3次，每次间隔1秒，使用传入的 ctx（超时仍然生效）
- 重试时打印日志：第几次重试、失败原因

### Must NOT Have (Guardrails)
- 不得修改 Task struct / model 文件 / 数据库 migration
- 不得引入新的第三方依赖包
- 不得修改三个目标文件之外的任何文件
- 不得在修复过程中"顺手"重构无关逻辑

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None
- **Agent-Executed QA**: 编译验证 + 日志验证

### QA Policy
每个 task 通过 `go build` 编译验证 + grep 检查关键代码存在。

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (顺序执行，独立 commit):
├── Task 1: gemini.go nil pointer 保护 [quick]
├── Task 2: pool.go 多图警告日志 [quick]
└── Task 3: openai.go fetchImage 重试机制 [quick]

Wave FINAL:
└── Task F1: 编译验证 + 整体检查
```

---

## TODOs

- [x] 1. 修复 gemini.go 两处 nil pointer panic

  **What to do**:
  - 在 `generateWithReferences` 函数（约第246行）的 log.Printf 之前，提取 `aspectRatio` 和 `imageSize` 变量，加 `config.ImageConfig != nil` 判断
  - 在 `generateViaContent` 函数（约第318行）的 log.Printf 之前，同样提取变量加 nil 判断
  - 两处修改模式完全一致，变量名用 `aspectRatio` / `imageSize` 即可（两个函数作用域独立，不冲突）

  **Must NOT do**:
  - 不得修改函数签名
  - 不得修改 GenerateContent 调用逻辑
  - 不得改动 nil 判断之外的任何代码

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1, Task 1
  - **Blocks**: Task 2, Task 3（编译依赖）
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `backend/internal/provider/gemini.go:246-247` — generateWithReferences 中的问题 log 行
  - `backend/internal/provider/gemini.go:318-319` — generateViaContent 中的问题 log 行

  **修复后代码样例**（两处相同模式）:
  ```go
  // 安全读取 ImageConfig 字段，避免 nil pointer panic
  var aspectRatio, imageSize string
  if config.ImageConfig != nil {
      aspectRatio = config.ImageConfig.AspectRatio
      imageSize = config.ImageConfig.ImageSize
  }
  log.Printf("[Gemini] 开始调用 GenerateContent, Model: %s, Parts: %d, AspectRatio: %s, ImageSize: %s\n",
      modelID, len(parts), aspectRatio, imageSize)
  ```
  注意：generateViaContent 中没有 `len(parts)` 参数，log 格式略有不同，对应调整即可。

  **Acceptance Criteria**:

  **QA Scenarios**:

  ```
  Scenario: 编译通过
    Tool: Bash
    Steps:
      1. cd backend && go build ./...
    Expected Result: 无任何编译错误输出，exit code 0
    Evidence: .sisyphus/evidence/task-1-build.txt

  Scenario: nil 保护代码存在
    Tool: Bash
    Steps:
      1. grep -n "config.ImageConfig != nil" backend/internal/provider/gemini.go
    Expected Result: 输出至少2行匹配（两处保护）
    Evidence: .sisyphus/evidence/task-1-grep.txt
  ```

  **Commit**: YES
  - Message: `fix(gemini): guard nil ImageConfig before log.Printf to prevent panic`
  - Files: `backend/internal/provider/gemini.go`
  - Pre-commit: `cd backend && go build ./...`

---

- [x] 2. 修复 pool.go 多图静默丢失，补充警告日志

  **What to do**:
  - 在 `processTask` 函数（约第175-207行）找到 `result.Images[0]` 的位置
  - 在 `bytes.NewReader(result.Images[0])` 这行**之前**，加一个判断：如果 `len(result.Images) > 1`，打印警告日志，说明有多少张图被丢弃
  - 日志格式：`log.Printf("任务 %s 生成了 %d 张图片，当前只保存第1张，其余 %d 张已丢弃", task.TaskModel.TaskID, len(result.Images), len(result.Images)-1)`
  - 不改变任何存储逻辑，只加日志

  **Must NOT do**:
  - 不得修改 Task struct
  - 不得修改存储逻辑（仍然只存 Images[0]）
  - 不得修改数据库相关代码

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1, Task 2（Task 1 完成后）
  - **Blocks**: Task 3
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `backend/internal/worker/pool.go:175-207` — processTask 存储图片的完整逻辑
  - `backend/internal/worker/pool.go:178` — `bytes.NewReader(result.Images[0])` 目标行

  **Acceptance Criteria**:

  **QA Scenarios**:

  ```
  Scenario: 编译通过
    Tool: Bash
    Steps:
      1. cd backend && go build ./...
    Expected Result: exit code 0，无错误
    Evidence: .sisyphus/evidence/task-2-build.txt

  Scenario: 警告日志代码存在
    Tool: Bash
    Steps:
      1. grep -n "张图片.*只保存第1张" backend/internal/worker/pool.go
    Expected Result: 输出至少1行匹配
    Evidence: .sisyphus/evidence/task-2-grep.txt
  ```

  **Commit**: YES
  - Message: `fix(worker): log warning when multiple images returned but only first is saved`
  - Files: `backend/internal/worker/pool.go`
  - Pre-commit: `cd backend && go build ./...`

---

- [x] 3. 修复 openai.go fetchImage 失败静默跳过，改为带重试的明确错误

  **What to do**:
  - 在 `openai.go` 中，修改 `fetchImage` 函数，加入最多3次重试逻辑
  - 重试条件：HTTP 请求失败（网络错误）或响应状态码为 5xx / 429
  - 每次重试前 sleep 1秒（使用 `time.Sleep(time.Second)`）
  - 每次失败打印日志：`log.Printf("[OpenAI] fetchImage 第%d次尝试失败, url=%s, err=%v", attempt, url, err)`
  - 3次全部失败后返回最后一次的 error
  - 同时修改 `extractImagesFromData` 中调用 fetchImage 的地方：失败时打印日志（不再静默跳过），但仍然 continue（因为可能有多张图，不因一张失败而放弃其他）

  **Must NOT do**:
  - 不得引入新的第三方重试库
  - 不得修改 fetchImage 函数签名
  - 不得修改 ctx 的使用方式（重试时仍然传入原始 ctx，超时仍然生效）
  - 不得修改 extractImagesFromData 之外的调用方

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1, Task 3（Task 2 完成后）
  - **Blocks**: Task F1
  - **Blocked By**: Task 2

  **References**:

  **Pattern References**:
  - `backend/internal/provider/openai.go:299-313` — 当前 fetchImage 函数完整实现
  - `backend/internal/provider/openai.go:231-236` — extractImagesFromData 中静默跳过的位置

  **修复后 fetchImage 样例**:
  ```go
  func (p *OpenAIProvider) fetchImage(ctx context.Context, url string) ([]byte, error) {
      const maxRetries = 3
      var lastErr error
      for attempt := 1; attempt <= maxRetries; attempt++ {
          req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
          if err != nil {
              return nil, err // 构造请求失败不重试
          }
          resp, err := p.httpClient.Do(req)
          if err != nil {
              lastErr = err
              log.Printf("[OpenAI] fetchImage 第%d次尝试失败, url=%s, err=%v", attempt, url, err)
              if attempt < maxRetries {
                  time.Sleep(time.Second)
              }
              continue
          }
          defer resp.Body.Close()
          if resp.StatusCode == 429 || resp.StatusCode >= 500 {
              lastErr = fmt.Errorf("下载图片失败: %s", resp.Status)
              log.Printf("[OpenAI] fetchImage 第%d次尝试失败, url=%s, status=%s", attempt, url, resp.Status)
              if attempt < maxRetries {
                  time.Sleep(time.Second)
              }
              continue
          }
          if resp.StatusCode < 200 || resp.StatusCode >= 300 {
              return nil, fmt.Errorf("下载图片失败: %s", resp.Status)
          }
          return io.ReadAll(resp.Body)
      }
      return nil, fmt.Errorf("下载图片失败（重试%d次）: %w", maxRetries, lastErr)
  }
  ```

  **extractImagesFromData 中的修改**（原来静默跳过，改为打印日志）:
  ```go
  if url, ok := obj["url"].(string); ok && url != "" {
      imgBytes, err := p.fetchImage(ctx, url)
      if err != nil {
          log.Printf("[OpenAI] 下载图片失败，跳过此图: url=%s, err=%v", url, err)
          continue
      }
      images = append(images, imgBytes)
  }
  ```

  **Acceptance Criteria**:

  **QA Scenarios**:

  ```
  Scenario: 编译通过
    Tool: Bash
    Steps:
      1. cd backend && go build ./...
    Expected Result: exit code 0，无错误
    Evidence: .sisyphus/evidence/task-3-build.txt

  Scenario: 重试逻辑代码存在
    Tool: Bash
    Steps:
      1. grep -n "maxRetries\|第.*次尝试失败" backend/internal/provider/openai.go
    Expected Result: 输出至少3行匹配（maxRetries定义 + 两处日志）
    Evidence: .sisyphus/evidence/task-3-grep.txt
  ```

  **Commit**: YES
  - Message: `fix(openai): retry fetchImage up to 3 times on network/5xx/429 errors`
  - Files: `backend/internal/provider/openai.go`
  - Pre-commit: `cd backend && go build ./...`

---

## Final Verification Wave

- [x] F1. **整体编译 + 修复验证** — `quick`

  ```bash
  cd backend && go build ./...
  # Expected: 无错误

  grep -n "config.ImageConfig != nil" backend/internal/provider/gemini.go
  # Expected: 2行

  grep -n "张图片.*只保存第1张" backend/internal/worker/pool.go
  # Expected: 1行

  grep -n "maxRetries" backend/internal/provider/openai.go
  # Expected: 1行
  ```

---

## Commit Strategy

- Task 1: `fix(gemini): guard nil ImageConfig before log.Printf to prevent panic`
- Task 2: `fix(worker): log warning when multiple images returned but only first is saved`
- Task 3: `fix(openai): retry fetchImage up to 3 times on network/5xx/429 errors`

---

## Success Criteria

### Verification Commands
```bash
cd backend && go build ./...  # Expected: exit code 0，无输出
grep -c "config.ImageConfig != nil" backend/internal/provider/gemini.go  # Expected: 2
grep -c "maxRetries" backend/internal/provider/openai.go  # Expected: >=1
```

### Final Checklist
- [ ] gemini.go 两处 nil 保护存在
- [ ] pool.go 多图警告日志存在
- [ ] openai.go fetchImage 有重试逻辑
- [ ] 整体编译通过
