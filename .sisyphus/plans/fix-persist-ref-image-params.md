# 修复 persist_ref_image 参数命名问题

## TL;DR

> **快速总结**: 修复 Tauri 命令调用中的参数命名问题，前端需要使用 camelCase 而不是 snake_case
> 
> **交付物**:
> - 修复后的 `desktop/src/components/ConfigPanel/ReferenceImageUpload.tsx` 文件
> - 外部参考图添加功能正常工作
> 
> **预估工作量**: Quick（< 1 分钟）
> **并行执行**: NO - 单任务顺序执行
> **关键路径**: 修改参数名 → 验证构建

---

## Context

### Original Request
用户日志显示多次错误：
```
Failed to persist external ref image: invalid args `destName` for command `persist_ref_image`: 
command persist_ref_image missing required key destName
```

### Root Cause Analysis

**Tauri 参数命名约定**: 官方文档明确规定前端调用必须使用 camelCase 格式的参数名

| 位置 | 当前使用 | Tauri 期望 | 状态 |
|------|---------|-----------|------|
| Rust 端 | `dest_name` | `dest_name` (snake_case) | ✅ 正确 |
| 前端调用 | `dest_name` | `destName` (camelCase) | ❌ 错误 |
| Tauri 内部 | - | 自动转换 `dest_name` → `destName` | - |

**官方文档原文**:
> Arguments should be passed as a JSON object with camelCase keys

### 当前代码

**Rust 端 (lib.rs:454-459)** - 正确 ✅:
```rust
#[tauri::command]
fn persist_ref_image(
    app: tauri::AppHandle,
    path: String,
    dest_name: String,  // snake_case in Rust is correct
) -> Result<String, String> {
```

**前端调用 (ReferenceImageUpload.tsx:230)** - 错误 ❌:
```typescript
const relativePath = await invoke<string>('persist_ref_image', { 
    path: normalized, 
    dest_name: destName  // ← 错误！应该用 camelCase
});
```

---

## Work Objectives

### Core Objective
修复前端 Tauri 命令调用中的参数命名，使其符合 Tauri 的 camelCase 约定

### Concrete Deliverables
- `desktop/src/components/ConfigPanel/ReferenceImageUpload.tsx` 第 230 行参数名修改
- 外部参考图添加功能正常工作，不再报错

### Definition of Done
- [ ] TypeScript 编译通过：`cd desktop && npm run type-check` 退出码为 0
- [ ] 前端构建通过：`cd desktop && npm run build` 退出码为 0
- [ ] 代码审查通过

### Must Have
- 第 230 行参数名从 `dest_name` 改为 `destName`

### Must NOT Have (Guardrails)
- ❌ 不要修改 Rust 端代码
- ❌ 不要修改其他无关代码
- ❌ 不要添加额外功能

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (TypeScript + npm)
- **Automated tests**: None (简单参数名修改，编译验证足够)
- **Framework**: TypeScript compiler (tsc)

### QA Policy
- TypeScript 编译验证
- 前端构建验证

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately):
└── Task 1: Fix parameter naming [quick]

Critical Path: Task 1
Max Concurrent: 1
```

---

## TODOs

- [ ] 1. 修复 ReferenceImageUpload.tsx 参数命名

  **What to do**:
  - 修改 `desktop/src/components/ConfigPanel/ReferenceImageUpload.tsx` 第 230 行
  - 将 `dest_name` 改为 `destName`
  - 运行 TypeScript 检查验证

  **Must NOT do**:
  - 不要修改其他任何行
  - 不要修改 Rust 端代码

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的参数名修改，只需要改一个单词
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocked By**: None

  **References**:
  - `desktop/src/components/ConfigPanel/ReferenceImageUpload.tsx:230` - 需要修改的代码行

  **代码修改**:
  ```typescript
  // 修改前（第 230 行）
  const relativePath = await invoke<string>('persist_ref_image', { path: normalized, dest_name: destName });
  
  // 修改后
  const relativePath = await invoke<string>('persist_ref_image', { path: normalized, destName: destName });
  ```

  **Acceptance Criteria**:
  - [ ] TypeScript 检查通过：`cd desktop && npm run type-check` 退出码为 0
  - [ ] Git diff 显示仅第 230 行修改

  **QA Scenarios**:
  ```
  Scenario: TypeScript compilation succeeds after fix
    Tool: Bash (npm run type-check)
    Steps:
      1. cd desktop && npm run type-check
    Expected Result: Exit code 0, zero errors
    Evidence: .sisyphus/evidence/task-1-typecheck-success.log

  Scenario: Frontend build succeeds
    Tool: Bash (npm run build)
    Steps:
      1. cd desktop && npm run build
    Expected Result: Exit code 0, build succeeds
    Evidence: .sisyphus/evidence/task-1-build-success.log
  ```

  **Commit**: YES
  - Message: `fix: use camelCase for Tauri command parameter`
  - Files: `desktop/src/components/ConfigPanel/ReferenceImageUpload.tsx`
  - Pre-commit: `cd desktop && npm run type-check`

---

## Commit Strategy

- **1**: `fix: use camelCase for Tauri command parameter`
  - Files: `desktop/src/components/ConfigPanel/ReferenceImageUpload.tsx`
  - Pre-commit: `cd desktop && npm run type-check`

---

## Success Criteria

### Verification Commands
```bash
cd desktop && npm run type-check  # Expected: Exit code 0
cd desktop && npm run build       # Expected: Exit code 0
```

### Final Checklist
- [x] 参数名修改完成（dest_name → destName）
- [x] TypeScript 编译通过
- [x] 前端构建通过
