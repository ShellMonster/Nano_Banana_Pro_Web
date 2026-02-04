# Fix: 生成区图片弹窗看不到图片

## TL;DR

> **Quick Summary**: 修复生成区点击图片打开弹窗后图片不显示的问题。根因是弹窗 `ImagePreview` 直接使用 `image.url` 作为 `<img src>`，而生成区传入的 `image.url` 可能是空字符串（图片实际路径在 `filePath` 字段中）。
>
> **Deliverables**:
> - 修复 `ImagePreview.tsx`：添加兜底 URL 计算逻辑
> - 修复 `generateStore.ts`：修复 `restoreTaskState` 中空字符串导致 URL 丢失的 bug
>
> **Estimated Effort**: Quick
> **Parallel Execution**: NO - sequential
> **Critical Path**: Task 1 → Task 2

---

## Context

### Original Request
生成区生成好的图片，点击图片打开弹窗后看不到图片，但历史记录区同样的图片能正常显示。

### Root Cause Analysis

**核心原因**：`ImagePreview.tsx` 弹窗组件直接使用 `image.url` 作为 `<img src>`。

- **历史记录区**能正常显示：因为 `HistoryList.tsx` 在遍历时**每次都重新**计算 URL：
  ```typescript
  url: img.url || getImageUrl(img.filePath || img.thumbnailPath)
  ```

- **生成区**图片弹窗不显示：因为 `ImageGrid.tsx` **直接传递** `generateStore.images` 中的原始对象，不做额外 URL 处理。当 `image.url` 是空字符串 `""` 时（非 `undefined`），JavaScript 的 `||` 运算不会 fallback。

**次要原因**：`generateStore.ts` 的 `restoreTaskState` 中也有空字符串 bug：
```typescript
url: getImageUrl(img.url || img.filePath || ...)
// 当 img.url === "" 时，"" || img.filePath 返回 ""，getImageUrl("") 返回 ""
```

---

## Work Objectives

### Core Objective
让弹窗在 `image.url` 为空/无效时，自动从 `filePath`/`thumbnailPath` 回退获取可用 URL。

### Concrete Deliverables
- `desktop/src/components/GenerateArea/ImagePreview.tsx` — 添加 `fullSrc` / `thumbSrc` 计算
- `desktop/src/store/generateStore.ts` — 修复 `restoreTaskState` 空字符串 fallback

### Definition of Done
- [x] 生成区图片点击弹窗后能正常显示大图
- [x] 历史记录区图片弹窗行为不受影响

### Must Have
- 弹窗中的 3 处 `<img>` 的 `src` 均使用兜底计算后的值
- `restoreTaskState` 中正确处理空字符串

### Must NOT Have (Guardrails)
- 不要修改历史记录区的逻辑（已经正常工作）
- 不要修改 `getImageUrl` 工具函数的行为
- 不要修改生成区卡片的显示逻辑（卡片用的 `thumbnailUrl || url`，没问题）
- 不要改变 `GeneratedImage` 类型定义

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: NO
- **Agent-Executed QA**: Playwright 验证（如有运行环境）

---

## TODOs

- [x] 1. 修复 ImagePreview.tsx — 添加兜底 URL 计算

  **What to do**:

  1. 在 `ImagePreview.tsx` 顶部 import 区域，增加导入 `getImageUrl`：
     ```typescript
     import { getImageDownloadUrl, getImageUrl } from '../../services/api';
     ```
     （原本只导入了 `getImageDownloadUrl`，现在需要 `getImageUrl` 来做路径转换）

  2. 在组件内部、`if (!image) return null;` 之前（大约第 655 行附近），添加两个 `useMemo` 计算可靠的 URL：

     ```typescript
     // ---------- 兜底 URL 计算 ----------
     // 生成区传入的 image.url 可能是空字符串，需要从 filePath/thumbnailPath 回退
     const fullSrc = useMemo(() => {
       if (image?.url) return image.url;
       // url 为空，尝试从其他字段获取
       return getImageUrl(image?.filePath || image?.thumbnailPath || image?.thumbnailUrl || '');
     }, [image?.url, image?.filePath, image?.thumbnailPath, image?.thumbnailUrl]);

     const thumbSrc = useMemo(() => {
       if (image?.thumbnailUrl) return image.thumbnailUrl;
       if (image?.url) return image.url;
       return getImageUrl(image?.thumbnailPath || image?.filePath || '');
     }, [image?.thumbnailUrl, image?.url, image?.thumbnailPath, image?.filePath]);
     ```

     **注意**：这两个 `useMemo` 必须放在所有 hooks 之后、`if (!image) return null;` 之前。确保 hooks 调用顺序不变（React 规则）。

  3. 替换弹窗中 **3 处** `<img>` 标签的 `src`：

     **第 1 处**（背景模糊层，约第 709 行）：
     ```
     旧: src={image.thumbnailUrl || image.url}
     新: src={thumbSrc}
     ```

     **第 2 处**（缩略图占位，约第 761 行）：
     ```
     旧: src={image.thumbnailUrl || image.url}
     新: src={thumbSrc}
     ```

     **第 3 处**（高清大图，约第 774 行）：
     ```
     旧: src={image.url}
     新: src={fullSrc}
     ```

  **Must NOT do**:
  - 不要修改 `getBestSrc()` 函数（那个只用于复制功能，不影响显示）
  - 不要修改 `previewableImages` 的过滤逻辑
  - 不要修改其他组件

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: [Task 2]
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `desktop/src/components/GenerateArea/ImagePreview.tsx:7` — 当前 import 行，需要在这里添加 `getImageUrl`
  - `desktop/src/components/GenerateArea/ImagePreview.tsx:655` — `if (!image) return null;` 行，在它前面添加 useMemo
  - `desktop/src/components/GenerateArea/ImagePreview.tsx:709` — 第 1 处 img src（背景模糊层）
  - `desktop/src/components/GenerateArea/ImagePreview.tsx:761` — 第 2 处 img src（缩略图占位）
  - `desktop/src/components/GenerateArea/ImagePreview.tsx:774` — 第 3 处 img src（高清大图）

  **API/Type References**:
  - `desktop/src/services/api.ts:195-299` — `getImageUrl()` 函数：传入 filePath 返回可用的 URL（asset:// 或 http:// 格式）
  - `desktop/src/types/index.ts:9-26` — `GeneratedImage` 类型定义（url, thumbnailUrl, filePath, thumbnailPath 字段）

  **逻辑参考**:
  - `desktop/src/components/HistoryPanel/HistoryList.tsx:141-142` — 历史区的正确做法：
    ```typescript
    url: img.url || getImageUrl(img.filePath || img.thumbnailPath),
    thumbnailUrl: img.thumbnailUrl || getImageUrl(img.thumbnailPath || img.filePath),
    ```

  **Acceptance Criteria**:

  - [ ] `getImageUrl` 已被正确导入
  - [ ] `fullSrc` 和 `thumbSrc` 两个 `useMemo` 已添加且位置正确（在其他 hooks 之后、return null 之前）
  - [ ] 3 处 `<img>` 的 `src` 已全部替换
  - [ ] 编译无报错：在 desktop 目录下运行 TypeScript 检查通过

  **Commit**: YES
  - Message: `fix(preview): 修复生成区图片弹窗不显示大图的问题`
  - Files: `desktop/src/components/GenerateArea/ImagePreview.tsx`

---

- [x] 2. 修复 generateStore.ts — restoreTaskState 空字符串 fallback

  **What to do**:

  在 `desktop/src/store/generateStore.ts` 的 `restoreTaskState` 方法中（约第 305-311 行），修复空字符串 fallback 问题。

  **当前代码**（有 bug）:
  ```typescript
  images: taskState.images.map((img) => ({
    ...img,
    url: getImageUrl(img.url || img.filePath || img.thumbnailPath || ''),
    thumbnailUrl: img.thumbnailUrl ? getImageUrl(img.thumbnailUrl) : getImageUrl(img.thumbnailPath || img.filePath || ''),
    status: img.status || 'success' as const
  })),
  ```

  **修改后**:
  ```typescript
  images: taskState.images.map((img) => ({
    ...img,
    url: getImageUrl((img.url && img.url.trim()) || img.filePath || img.thumbnailPath || ''),
    thumbnailUrl: getImageUrl((img.thumbnailUrl && img.thumbnailUrl.trim()) || img.thumbnailPath || img.filePath || ''),
    status: img.status || 'success' as const
  })),
  ```

  **改动说明**：
  - `img.url || ...` → `(img.url && img.url.trim()) || ...`
  - 这样当 `img.url` 是空字符串 `""` 或纯空白时，会正确 fallback 到 `filePath`
  - `thumbnailUrl` 同理，且去掉了之前的三元判断，统一用相同的 fallback 链

  **Must NOT do**:
  - 不要修改 `normalizeIncomingImage` 函数（它的逻辑是正确的）
  - 不要修改 store 的其他方法

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocked By**: Task 1（建议一起提交）

  **References**:

  - `desktop/src/store/generateStore.ts:295-317` — `restoreTaskState` 方法
  - `desktop/src/store/generateStore.ts:45-61` — `normalizeIncomingImage` 函数（参考其正确的 fallback 逻辑）

  **Acceptance Criteria**:

  - [ ] `restoreTaskState` 中的 `url` 和 `thumbnailUrl` 使用 `.trim()` 检查空字符串
  - [ ] 编译无报错
  - [ ] 不影响正常的任务恢复流程

  **Commit**: YES (与 Task 1 合并提交)
  - Message: `fix(preview): 修复生成区图片弹窗不显示大图的问题`
  - Files: `desktop/src/components/GenerateArea/ImagePreview.tsx`, `desktop/src/store/generateStore.ts`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 + 2 | `fix(preview): 修复生成区图片弹窗不显示大图的问题` | ImagePreview.tsx, generateStore.ts | TypeScript 编译通过 |

---

## Success Criteria

### Final Checklist
- [x] 生成区图片点击弹窗后大图正常显示
- [x] 历史记录区弹窗行为不受影响
- [x] 背景模糊层、缩略图占位、高清大图三处 src 都有兜底逻辑
- [x] `restoreTaskState` 正确处理空字符串
- [x] TypeScript 编译无报错
