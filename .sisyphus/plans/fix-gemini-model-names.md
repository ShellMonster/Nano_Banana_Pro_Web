# 修复 Gemini Flash 生图模型名称

## TL;DR

> **快速总结**: 修复生图模型下拉选择器中的 Flash 模型名称
> 
> **交付物**:
> - 修复后的 `desktop/src/store/configStore.ts`
> - Flash 模型: `gemini-3.1-flash-image-preview`
> 
> **预估工作量**: Quick（< 5 分钟）

---

## Context

### Original Request
用户反馈生图模型的 Flash 模型名称不正确，应该是 `gemini-3.1-flash-image-preview`

### 修改范围

| 模型类型 | 当前 | 修改后 | 是否修改 |
|---------|------|--------|---------|
| Flash 生图 | `gemini-3-flash-image-preview` | `gemini-3.1-flash-image-preview` | ✅ 是 |
| Pro 生图 | `gemini-3-pro-image-preview` | 不变 | ❌ 否 |
| Flash 识图 | `gemini-3-flash-preview` | 不变 | ❌ 否 |

---

## Work Objectives

### Must Have
- Flash 生图模型: `gemini-3.1-flash-image-preview`

### Must NOT Have
- ❌ 不要修改 Pro 生图模型名称 (`gemini-3-pro-image-preview`)
- ❌ 不要修改识图模型名称 (`gemini-3-flash-preview`)
- ❌ 不要修改其他无关代码

---

## TODOs

- [ ] 1. 修复 configStore.ts 中的 Flash 模型名称

  **What to do**:
  - 修改 `desktop/src/store/configStore.ts`
  - 全局替换 `gemini-3-flash-image-preview` → `gemini-3.1-flash-image-preview`
  - 运行 TypeScript 检查验证

  **Must NOT do**:
  - 不要修改 `gemini-3-pro-image-preview`（Pro 生图模型）
  - 不要修改 `gemini-3-flash-preview`（识图模型）

  **Commit**: YES
  - Message: `fix: update Gemini Flash image model name to 3.1 version`
  - Files: `desktop/src/store/configStore.ts`

---

## Success Criteria

### Verification Commands
```bash
cd desktop && npm run type-check  # Expected: Exit code 0
grep -r "gemini-3.1-flash-image-preview" desktop/src/  # Expected: 找到多处
grep -r "gemini-3-pro-image-preview" desktop/src/  # Expected: Pro 保持不变
grep -r "gemini-3-flash-preview" desktop/src/  # Expected: 识图模型保持不变
```

### Final Checklist
- [x] Flash 生图模型名称更新
- [x] Pro 生图模型名称不变
- [x] 识图模型名称不变
- [x] TypeScript 编译通过
