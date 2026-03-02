# fix: CI Backend go vet + Frontend ESLint failures

## TL;DR

> 修复两个导致 CI 失败的已有 bug，与 model-select PR 无关但阻塞后续 PR 的 CI。
>
> **Deliverables**:
> - `backend/internal/provider/gemini.go` — 修复 2 处 `fmt.Errorf` non-constant format string
> - `desktop/eslint.config.js` — 修复 `@typescript-eslint` 规则引用方式
>
> **Estimated Effort**: Quick
> **Parallel Execution**: YES — 2 个任务可并行
> **Critical Path**: Task 1 + Task 2 并行 → Task 3 commit + PR

---

## Context

### 问题来源
PR #13 合并前 CI 一直报两个失败，均为已有 bug，与本次功能无关：

**Bug 1 — Backend go vet**:
```
internal/provider/gemini.go:309:26: non-constant format string in call to fmt.Errorf
internal/provider/gemini.go:381:26: non-constant format string in call to fmt.Errorf
```

**Bug 2 — Frontend ESLint**:
```
A configuration object specifies rule "@typescript-eslint/no-unused-vars",
but could not find plugin "@typescript-eslint".
```

### 根因分析

**Bug 1**: `gemini.go` 两处用了 `fmt.Errorf(reason.String())`，
`reason` 是 `strings.Builder`，`reason.String()` 是变量不是常量，
`go vet` 认为这是潜在格式字符串注入风险。
修复方法：改为 `fmt.Errorf("%s", reason.String())` 或 `errors.New(reason.String())`。

**Bug 2**: `desktop/eslint.config.js` 第 31-35 行直接引用了
`'@typescript-eslint/no-unused-vars'` 和 `'@typescript-eslint/no-explicit-any'` 规则，
但 `plugins` 块里没有注册 `@typescript-eslint` 插件。
项目已安装 `typescript-eslint ^8.19.1`，使用了 `tseslint.config()` 包装，
正确做法是在 `extends` 里加 `...tseslint.configs.recommended`，
或在 `plugins` 里注册 `'@typescript-eslint': tseslint.plugin`，
然后规则名保持 `@typescript-eslint/...`。

最小改动方案：在当前 config 对象的 `plugins` 块里加一行：
```js
'@typescript-eslint': tseslint.plugin,
```

---

## Work Objectives

### Must Have
- `go vet ./...` 在 CI 中通过（exit 0）
- `npm run lint` 在 desktop 中通过（exit 0）

### Must NOT Have
- 不改 gemini.go 的业务逻辑，只改 fmt.Errorf 的调用方式
- 不改 ESLint 规则内容，只修复插件注册方式
- 不动其他文件

---

## Execution Strategy

```
Wave 1 (并行):
├── Task 1: 修复 backend/internal/provider/gemini.go — 2 处 fmt.Errorf
└── Task 2: 修复 desktop/eslint.config.js — 注册 @typescript-eslint 插件

Wave 2 (串行):
└── Task 3: 验证 + commit + push + 创建 PR
```

---

## TODOs

- [ ] 1. 修复 `backend/internal/provider/gemini.go` — fmt.Errorf non-constant format string

  **What to do**:

  找到以下两处代码（第 309 行和第 381 行，两处完全相同）：
  ```go
  return nil, fmt.Errorf(reason.String())
  ```

  全部改为：
  ```go
  return nil, errors.New(reason.String())
  ```

  如果文件顶部 import 块里没有 `"errors"` 包，需要添加。
  检查方式：`grep -n '"errors"' backend/internal/provider/gemini.go`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 2 并行）
  - **Blocked By**: None

  **References**:
  - `backend/internal/provider/gemini.go:309` — 第一处
  - `backend/internal/provider/gemini.go:381` — 第二处

  **Acceptance Criteria**:
  - [ ] `cd backend && go vet ./...` 通过（exit 0，无 gemini.go 相关错误）
  - [ ] 文件中不再含有 `fmt.Errorf(reason.String())`

---

- [ ] 2. 修复 `desktop/eslint.config.js` — 注册 @typescript-eslint 插件

  **What to do**:

  当前文件第 21-24 行的 `plugins` 块：
  ```js
  plugins: {
    'react-hooks': reactHooks,
    'react-refresh': reactRefresh,
  },
  ```

  改为（加一行 `'@typescript-eslint': tseslint.plugin`）：
  ```js
  plugins: {
    'react-hooks': reactHooks,
    'react-refresh': reactRefresh,
    '@typescript-eslint': tseslint.plugin,
  },
  ```

  `tseslint` 已在第 5 行 import，`tseslint.plugin` 是 `typescript-eslint` 包暴露的插件对象，直接可用。

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 1 并行）
  - **Blocked By**: None

  **References**:
  - `desktop/eslint.config.js:5` — `import tseslint from 'typescript-eslint'`
  - `desktop/eslint.config.js:21-24` — plugins 块位置

  **Acceptance Criteria**:
  - [ ] `cd desktop && npm run lint` 通过（exit 0 或只有 warn，无 error）

---

- [ ] 3. 验证 + commit + push + 创建 PR

  **What to do**:
  1. `cd backend && go vet ./...` — exit 0
  2. `cd desktop && npm run lint` — exit 0 或只有 warn
  3. `cd desktop && npm run type-check` — exit 0（确认没引入新问题）
  4. 从最新 main 创建新分支：`git checkout main && git pull && git checkout -b fix/ci-govet-eslint`
  5. `git add backend/internal/provider/gemini.go desktop/eslint.config.js`
  6. `git commit -m "fix(ci): resolve go vet and ESLint failures in CI checks"`
  7. `git push -u origin fix/ci-govet-eslint`
  8. `gh pr create --title "fix(ci): resolve go vet and ESLint failures" --base main`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocked By**: Tasks 1, 2

  **Acceptance Criteria**:
  - [ ] PR 创建成功，有 URL
  - [ ] CI 触发后 Backend Check 和 Frontend Check 均为绿色

---

## Success Criteria

- [ ] `go vet ./...` 通过
- [ ] `npm run lint` 通过
- [ ] PR CI 全绿（Backend Check + Frontend Check）
