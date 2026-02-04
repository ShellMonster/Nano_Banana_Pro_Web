## 修复完成记录

### 2026-02-04 修复生成区图片弹窗不显示问题

**问题根因**:
1. `ImagePreview.tsx` 直接使用 `image.url` 作为 `<img src>`，而生成区传入的 `image.url` 可能是空字符串
2. `generateStore.ts` 的 `restoreTaskState` 中使用 `img.url || img.filePath`，当 `img.url === ""` 时返回空字符串而非 `filePath`

**修复内容**:
1. `ImagePreview.tsx`:
   - 导入 `getImageUrl` 函数
   - 添加 `fullSrc` 和 `thumbSrc` 两个 `useMemo` 计算可靠的 URL
   - 替换 3 处 `<img src>`：背景模糊层、缩略图占位、高清大图

2. `generateStore.ts`:
   - 修复 `restoreTaskState` 中的空字符串 fallback：`(img.url && img.url.trim()) || img.filePath`

**验证**:
- TypeScript 编译通过
- 代码已提交 (commit d3c053d)

**学习点**:
- JavaScript 的 `||` 运算符：空字符串 `''` 是 falsy 值，但 `'' || 'fallback'` 返回 `''` 而非 `'fallback'`
- 当需要区分空字符串和 undefined 时，应使用 `(value && value.trim()) || fallback`
- 历史记录区能正常显示是因为 `HistoryList.tsx` 每次都重新计算 URL，而生成区直接传递原始对象
