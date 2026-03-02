# 修复 TypeScript 语法错误 + Windows CGO 配置

## TL;DR

> **快速总结**: 修复 `desktop/src/hooks/useGenerate.ts` 第 131 行对象字面量缺少逗号的语法错误，同时修复 `release.yml` 中 Windows 平台缺少 `CGO_ENABLED=1` 的问题。
> 
> **交付物**:
> - 修复后的 `desktop/src/hooks/useGenerate.ts` 文件（仅第 131 行）
> - 修复后的 `.github/workflows/release.yml` 文件（Windows 构建添加 CGO_ENABLED=1）
> - TypeScript 编译通过（零错误）
> 
> **预估工作量**: Quick（< 2 分钟）
> **并行执行**: YES - 2 个独立任务可并行
> **关键路径**: Task 1 (语法修复) → TypeScript 检查 | Task 2 (CGO 配置) → 验证

---

## Context

### Original Request
1. **语法错误**: 用户在运行 `npm run type-check` 时发现语法错误：
   ```
   src/hooks/useGenerate.ts(132,13): error TS1005: ',' expected.
   ```
   错误位置在第 131 行的对象字面量中，缺少逗号分隔符。

2. **CGO 问题**: 用户日志显示 `Binary was compiled with 'CGO_ENABLED=0', go-sqlite3 requires cgo to work`。
   经排查发现 Windows 平台的 release.yml 构建命令缺少 `CGO_ENABLED=1`。

### Interview Summary
**关键讨论**:
- 之前已添加超时检测逻辑到 `pollTaskUntilFinished` 和 `startActiveSync` 函数
- 运行 TypeScript 检查后发现语法错误
- 用户反馈 CGO 问题，经排查确认 Windows 平台需要启用 CGO
- 项目依赖 `gorm.io/driver/sqlite` → `github.com/mattn/go-sqlite3`（CGO 库）

**研究发现**:
- **语法错误**: 第 131 行 `local: latestState.status` 后缺少逗号
- **CGO 问题**: 
  - macOS 平台已正确设置 `CGO_ENABLED=1`
  - Windows 平台缺少此设置，导致 SQLite 无法工作
  - GitHub Actions 的 `windows-latest` runner 已包含 MinGW，支持 CGO

### Metis Review
**识别的差距**（已解决）:
- **问题**: 是否应该检查其他 TypeScript 错误？
  - **解决**: 先修复此错误，然后运行完整 type-check
- **问题**: Windows CGO 是否需要额外安装 C 编译器？
  - **解决**: GitHub Actions `windows-latest` runner 已包含 MinGW，无需额外安装
- **问题**: 提交策略？
  - **解决**: 两个修复作为同一个 PR 的两个 commit

---

## Work Objectives

### Core Objective
1. 修复 TypeScript 语法错误，使代码能够通过类型检查
2. 修复 Windows 平台 CGO 配置，确保 SQLite 功能正常

### Concrete Deliverables
- `desktop/src/hooks/useGenerate.ts` 第 131 行添加逗号
- `.github/workflows/release.yml` 第 150 行添加 `CGO_ENABLED=1`
- `npm run type-check` 通过（退出码 0，零错误）

### Definition of Done
- [ ] TypeScript 检查通过：`cd desktop && npm run type-check` 退出码为 0
- [ ] Git diff 显示两处修改：useGenerate.ts 和 release.yml

### Must Have
- 第 131 行添加逗号：`local: latestState.status,`
- 第 150 行添加 CGO_ENABLED=1：`CGO_ENABLED=1 GOOS=windows GOARCH=amd64 go build...`

### Must NOT Have (Guardrails)
- ❌ 不要修改其他任何行
- ❌ 不要重构代码逻辑
- ❌ 不要添加额外的日志或错误处理
- ❌ 不要修改其他文件

---

## Verification Strategy (MANDATORY)

> **零人工干预** — 所有验证均由代理执行。无例外。

### Test Decision
- **Infrastructure exists**: YES (TypeScript + npm)
- **Automated tests**: None (纯语法/配置修复，不需要单元测试)
- **Framework**: TypeScript compiler (tsc)
- **If TDD**: 不适用

### QA Policy
每个任务必须包含代理执行的 QA 场景。
证据保存到 `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`。

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — 两个独立任务并行):
├── Task 1: Fix missing comma in useGenerate.ts [quick]
└── Task 2: Fix Windows CGO config in release.yml [quick]

Critical Path: Task 1 | Task 2 (并行)
Parallel Speedup: 50% faster than sequential
Max Concurrent: 2
```

### Dependency Matrix

- **1**: — — —
- **2**: — — —
- **F1-F4**: 1, 2 — —

> 两个任务无依赖关系，可并行执行。

### Agent Dispatch Summary

- **1**: **1** — T1 → `quick`
- **2**: **1** — T2 → `quick`

---

## TODOs

- [ ] 1. 修复 useGenerate.ts 语法错误

  **What to do**:
  - 在 `desktop/src/hooks/useGenerate.ts` 第 131 行添加逗号
  - 原代码：`local: latestState.status`
  - 修改后：`local: latestState.status,`
  - 运行 TypeScript 检查验证修复

  **Must NOT do**:
  - 不要修改其他任何行
  - 不要重构 console.log 语句

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的语法修复，只需要添加一个逗号
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `desktop/src/hooks/useGenerate.ts:130-133` - console.log 语句结构

  **Acceptance Criteria**:
  - [ ] TypeScript 检查通过：`cd desktop && npm run type-check` 退出码为 0
  - [ ] Git diff 仅显示第 131 行的逗号添加

  **QA Scenarios**:
  ```
  Scenario: TypeScript compilation succeeds after fix
    Tool: Bash (npm run type-check)
    Steps:
      1. cd desktop && npm run type-check
    Expected Result: Exit code 0, zero errors
    Evidence: .sisyphus/evidence/task-1-typecheck-success.log

  Scenario: Git diff shows only the comma addition
    Tool: Bash (git diff)
    Steps:
      1. git diff desktop/src/hooks/useGenerate.ts
    Expected Result: Only line 131 modified, comma added
    Evidence: .sisyphus/evidence/task-1-git-diff.log
  ```

  **Commit**: NO (与 Task 2 一起提交)

---

- [ ] 2. 修复 release.yml Windows CGO 配置

  **What to do**:
  - 在 `.github/workflows/release.yml` 第 150 行添加 `CGO_ENABLED=1`
  - 原代码：`cd backend && GOOS=windows GOARCH=amd64 go build -o ...`
  - 修改后：`cd backend && CGO_ENABLED=1 GOOS=windows GOARCH=amd64 go build -o ...`
  - 验证 YAML 语法正确

  **Must NOT do**:
  - 不要修改其他任何行
  - 不要修改 macOS 的构建配置

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的配置修改，只需要添加一个环境变量
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `.github/workflows/release.yml:149-153` - Windows 构建命令
  - `.github/workflows/release.yml:152-153` - macOS 构建命令（参考 CGO_ENABLED=1 格式）

  **Acceptance Criteria**:
  - [ ] YAML 语法正确，文件可被解析
  - [ ] Git diff 仅显示第 150 行添加 `CGO_ENABLED=1`

  **QA Scenarios**:
  ```
  Scenario: YAML syntax is valid
    Tool: Bash (python)
    Steps:
      1. python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"
    Expected Result: Exit code 0, no syntax errors
    Evidence: .sisyphus/evidence/task-2-yaml-valid.log

  Scenario: Git diff shows only CGO_ENABLED=1 addition
    Tool: Bash (git diff)
    Steps:
      1. git diff .github/workflows/release.yml
    Expected Result: Only line 150 modified, CGO_ENABLED=1 added
    Evidence: .sisyphus/evidence/task-2-git-diff.log
  ```

  **Commit**: YES (与 Task 1 一起提交)
  - Message: `fix: add missing comma and enable CGO for Windows build`
  - Files: `desktop/src/hooks/useGenerate.ts`, `.github/workflows/release.yml`
  - Pre-commit: `cd desktop && npm run type-check`

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Verify both fixes implemented, no forbidden changes.
  Output: `Must Have [2/2] | Must NOT Have [0/0] | Tasks [2/2] | VERDICT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run type-check, verify YAML syntax, review diffs.
  Output: `Build [PASS] | Files [2 clean] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Execute all QA scenarios, capture evidence.
  Output: `Scenarios [4/4 pass] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  Verify 1:1 mapping between spec and implementation.
  Output: `Tasks [2/2 compliant] | VERDICT`

---

## Commit Strategy

- **1**: `fix: add missing comma and enable CGO for Windows build`
  - Files: `desktop/src/hooks/useGenerate.ts`, `.github/workflows/release.yml`
  - Pre-commit: `cd desktop && npm run type-check`

---

## Success Criteria

### Verification Commands
```bash
cd desktop && npm run type-check  # Expected: Exit code 0, zero errors
python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"  # Expected: Exit code 0
git diff --stat  # Expected: 2 files changed, 2 insertions
```

### Final Checklist
- [x] TypeScript 语法修复完成
- [x] Windows CGO 配置修复完成
- [x] TypeScript 编译通过
- [x] YAML 语法正确
- [x] Git diff 显示最小化修改
