# 修复计划：图片预览中添加模型名称全文提示

## TL;DR

> **快速总结**: 在图片预览的模型名称上添加鼠标悬停提示，显示完整模型名称
> 
> **交付物**:
> - 修改后的 `desktop/src/components/GenerateArea/ImagePreview.tsx`
> - 鼠标悬停时显示完整模型名称的 tooltip
> 
> **预估工作量**: Quick（< 5 分钟）
> **风险等级**: Low（仅添加 UI 提示，无业务逻辑变更）

---

## Context

### 问题描述
用户在图片预览弹窗中查看图片信息时，模型名称显示不完整。例如 `gemini-3.1-flash-image-preview` 会被截断显示为 `gemini-3.1-flash-im...`。

### 问题代码位置
`desktop/src/components/GenerateArea/ImagePreview.tsx` 第 895 行：
```tsx
<span className="font-bold text-slate-900 truncate max-w-[200px]">
  {image.model || t('preview.meta.unknown')}
</span>
```

### 解决方案
添加 `title` 属性，让浏览器原生 tooltip 显示完整模型名称。这是最简单且无需引入额外组件的方案。

---

## Work Objectives

### Must Have
- [ ] 在模型名称的 span 元素上添加 `title` 属性
- [ ] 当模型名称被截断时，鼠标悬停显示完整文本

### Must NOT Have
- [ ] 不要引入新的 UI 组件库
- [ ] 不要修改样式布局
- [ ] 不要修改业务逻辑

---

## TODOs

### Wave 1: 代码修改与提交

- [ ] 1. 创建分支 `fix/model-name-tooltip`

  **Commands**:
  ```bash
  git checkout main
  git pull origin main
  git checkout -b fix/model-name-tooltip
  ```

- [ ] 2. 修改 `desktop/src/components/GenerateArea/ImagePreview.tsx`

  **What to do**:
  - 找到第 895 行的模型名称显示代码
  - 添加 `title` 属性显示完整模型名称
  
  **修改前**:
  ```tsx
  <span className="font-bold text-slate-900 truncate max-w-[200px]">
    {image.model || t('preview.meta.unknown')}
  </span>
  ```
  
  **修改后**:
  ```tsx
  <span 
    className="font-bold text-slate-900 truncate max-w-[200px]"
    title={image.model || t('preview.meta.unknown')}
  >
    {image.model || t('preview.meta.unknown')}
  </span>
  ```

  **Verification**:
  - [ ] TypeScript 编译通过
  - [ ] 无语法错误

  **Commit**: YES
  - Message: `fix: add tooltip for model name in image preview`
  - Files: `desktop/src/components/GenerateArea/ImagePreview.tsx`

- [ ] 3. 推送分支

  **Commands**:
  ```bash
  git push -u origin fix/model-name-tooltip
  ```

---

### Wave 2: 创建 PR

- [ ] 4. 创建 PR

  **PR 标题**: `fix: add tooltip for model name in image preview`
  
  **PR 描述**:
  ```markdown
  ## Summary
  
  修复图片预览中模型名称显示不全的问题，添加鼠标悬停提示显示完整模型名称。
  
  ## Changes
  
  - 在模型名称显示区域添加 `title` 属性
  - 鼠标悬停时显示完整模型名称
  
  ## Example
  
  **Before**: 模型名称 `gemini-3.1-flash-image-preview` 显示为 `gemini-3.1-flash-im...`
  
  **After**: 鼠标悬停时显示完整名称 `gemini-3.1-flash-image-preview`
  ```

  **Commands**:
  ```bash
  gh pr create --title "fix: add tooltip for model name in image preview" --body "..."
  ```

---

### Wave 3: 等待审查与合并

- [ ] 5. 等待 CI 检查通过

  **Commands**:
  ```bash
  gh pr checks --watch
  ```

- [ ] 6. 合并 PR

  **Commands**:
  ```bash
  gh pr merge <pr-number> --squash --delete-branch
  ```

---

### Wave 4: 清理

- [ ] 7. 切回 main 并清理

  **Commands**:
  ```bash
  git checkout main
  git pull origin main
  git branch -d fix/model-name-tooltip
  ```

---

## Success Criteria

### Verification
- [ ] PR 已创建并合并
- [ ] 模型名称悬停时显示完整文本

---

## Notes

- **最小改动**: 仅添加 `title` 属性，无其他变更
- **浏览器原生支持**: 无需引入额外组件
- **可回滚**: 如有问题可随时回滚
