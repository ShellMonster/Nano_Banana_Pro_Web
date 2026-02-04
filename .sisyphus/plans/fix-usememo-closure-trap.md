# Fix: useMemo 闭包陷阱导致图片弹窗不显示

## TL;DR

> **Quick Summary**: 移除 `ImagePreview.tsx` 中的 `useMemo`，修复因 `getImageUrl` 依赖异步初始化的 `appDataDir` 导致的闭包陷阱。
>
> **Deliverables**:
> - 修改 `ImagePreview.tsx`：移除 `fullSrc` 和 `thumbSrc` 的 `useMemo` 包装
>
> **Estimated Effort**: Quick (5分钟)
> **Critical Path**: 单一任务

---

## Context

### Root Cause

`getImageUrl` 函数依赖 `appDataDir`（在 `api.ts` 中异步初始化）：
```typescript
// api.ts 第 25 行
let appDataDir: string | null = null;

// 第 49 行异步赋值
appDataDir = await invoke<string>('get_app_data_dir');
```

当 `useMemo` 首次执行时，`appDataDir` 可能还是 `null`，导致 `getImageUrl` 返回错误的 HTTP fallback URL 而非正确的 `asset://` URL。由于 `appDataDir` 不在依赖数组中，`useMemo` 永远不会重新计算。

---

## TODOs

- [ ] 1. 移除 useMemo，直接计算 URL

  **File**: `desktop/src/components/GenerateArea/ImagePreview.tsx`

  **Find (lines 655-664)**:
  ```typescript
      const fullSrc = useMemo(() => {
          if (image?.url) return image.url;
          return getImageUrl(image?.filePath || image?.thumbnailPath || image?.thumbnailUrl || '');
      }, [image?.url, image?.filePath, image?.thumbnailPath, image?.thumbnailUrl]);

      const thumbSrc = useMemo(() => {
          if (image?.thumbnailUrl) return image.thumbnailUrl;
          if (image?.url) return image.url;
          return getImageUrl(image?.thumbnailPath || image?.filePath || '');
      }, [image?.thumbnailUrl, image?.url, image?.thumbnailPath, image?.filePath]);
  ```

  **Replace with**:
  ```typescript
      const fullSrc = image?.url || getImageUrl(image?.filePath || image?.thumbnailPath || image?.thumbnailUrl || '');
      const thumbSrc = image?.thumbnailUrl || image?.url || getImageUrl(image?.thumbnailPath || image?.filePath || '');
  ```

  **Acceptance Criteria**:
  - [ ] `useMemo` 已移除
  - [ ] TypeScript 编译通过：`cd desktop && npx tsc --noEmit`
  - [ ] 提交 commit

  **Commit**: 
  - Message: `fix(preview): remove useMemo to fix closure trap with async getImageUrl`
  - Files: `desktop/src/components/GenerateArea/ImagePreview.tsx`

---

## Success Criteria

- [ ] 图片弹窗能正常显示大图
- [ ] 控制台显示 `[getImageUrl] Converted to asset URL: asset://...` 而非 HTTP fallback
