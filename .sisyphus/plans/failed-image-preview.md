# 工作计划：失败图片可点击打开预览

## 📋 需求确认

| 项目 | 确认内容 |
|------|---------|
| **目标** | 让生成失败的图片可以点击打开预览弹窗 |
| **图标** | 🖼️ ImageOff（灰色）表示无图片 |
| **错误信息** | 显示完整后端返回的错误信息 |
| **复制按钮** | 添加"复制错误信息"按钮，方便反馈问题 |
| **不做** | 重新生成按钮、参考图功能 |

---

## 🎯 改动文件清单

### 1. ImageCard.tsx
**路径**: `desktop/src/components/GenerateArea/ImageCard.tsx`

**改动**: 允许失败图片点击打开预览
- 修改 `handleClick` 函数，让 `isFailed` 状态也能触发 `onClick`

### 2. ImagePreview.tsx
**路径**: `desktop/src/components/GenerateArea/ImagePreview.tsx`

**改动**:
1. 导入 `ImageOff` 图标
2. 添加 `isFailedImage` 状态判断
3. 左侧图片区域：无图片时显示失败占位状态
4. 隐藏图片相关控件（复制图片按钮、缩放控制、右键菜单）
5. 右侧底部：隐藏下载按钮
6. 添加"复制错误信息"按钮（在错误信息旁边）

---

## 🔧 详细实现步骤

### 步骤 1: 修改 ImageCard.tsx

**位置**: 第 111-117 行的 `handleClick` 函数

**当前代码**:
```typescript
const handleClick = useCallback(() => {
  const lastDragEndAt = useInternalDragStore.getState().lastDragEndAt;
  if (Date.now() - lastDragEndAt < 200) return;
  if (isSuccess) {    // ← 只有成功才能点击
    onClick(image);
  }
}, [image, isSuccess, onClick]);
```

**改为**:
```typescript
const handleClick = useCallback(() => {
  const lastDragEndAt = useInternalDragStore.getState().lastDragEndAt;
  if (Date.now() - lastDragEndAt < 200) return;
  if (isSuccess || isFailed) {    // ← 成功或失败都可以点击
    onClick(image);
  }
}, [image, isSuccess, isFailed, onClick]);
```

---

### 步骤 2: 修改 ImagePreview.tsx

#### 2.1 导入 ImageOff 图标

**位置**: 第 5 行的 import 语句

**当前**:
```typescript
import { Download, Copy, Calendar, Box, Maximize2, X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Trash2, Check } from 'lucide-react';
```

**添加**:
```typescript
import { Download, Copy, Calendar, Box, Maximize2, X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Trash2, Check, ImageOff } from 'lucide-react';
```

#### 2.2 添加失败状态判断

**位置**: 第 26 行后（在 `const { t } = useTranslation();` 之后）

**添加代码**:
```typescript
// 判断是否为失败图片（没有图片URL且状态为失败）
const isFailedImage = !image?.url && !image?.thumbnailUrl && image?.status === 'failed';
```

#### 2.3 修改左侧图片展示区域

**位置**: 第 620-722 行左右

**当前结构**:
```tsx
<div className="flex-1 bg-slate-50 relative min-h-[50vh] md:min-h-full overflow-hidden cursor-grab active:cursor-grabbing"
  onWheel={handleWheel}
  onMouseDown={handleMouseDown}
  ...
>
  {/* 背景模糊图 */}
  {/* 缩略图占位 */}
  {/* 高清大图 */}
  {/* 加载指示器 */}
  {/* 加载失败提示 */}
</div>
```

**改为条件渲染**:
```tsx
<div 
  className={`flex-1 bg-slate-50 relative min-h-[50vh] md:min-h-full overflow-hidden ${isFailedImage ? '' : 'cursor-grab active:cursor-grabbing'}`}
  onWheel={isFailedImage ? undefined : handleWheel}
  onMouseDown={isFailedImage ? undefined : handleMouseDown}
  onMouseMove={isFailedImage ? undefined : handleMouseMove}
  onMouseUp={isFailedImage ? undefined : () => setIsDragging(false)}
  onMouseLeave={isFailedImage ? undefined : () => setIsDragging(false)}
>
  {isFailedImage ? (
    // 失败状态占位图
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50">
      <div className="w-24 h-24 rounded-full bg-slate-100 flex items-center justify-center mb-5">
        <ImageOff className="w-12 h-12 text-slate-400" />
      </div>
      <p className="text-lg font-bold text-slate-700 mb-3">{t('preview.failed.title', '生成失败')}</p>
      {image?.errorMessage && (
        <div className="max-w-md mx-8">
          <p className="text-sm text-slate-500 text-center mb-3 leading-relaxed">
            {image.errorMessage}
          </p>
          <button
            onClick={() => {
              navigator.clipboard.writeText(image.errorMessage || '');
              toast.success(t('preview.failed.errorCopied', '错误信息已复制'));
            }}
            className="mx-auto flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            <Copy className="w-3.5 h-3.5" />
            {t('preview.failed.copyError', '复制错误信息')}
          </button>
        </div>
      )}
    </div>
  ) : (
    <>
      {/* 原有图片展示逻辑保持不变 */}
      {/* 背景模糊图 */}
      {/* 缩略图占位 */}
      {/* 高清大图 */}
      {/* 加载指示器 */}
      {/* 加载失败提示 */}
    </>
  )}
</div>
```

#### 2.4 隐藏右上角复制图片按钮

**位置**: 第 637-661 行左右

**修改**: 用条件包裹
```tsx
{!isFailedImage && (
  <div className="absolute top-6 right-4 z-50 flex flex-col items-end gap-2 pointer-events-auto">
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleCopyImage();
      }}
      disabled={!image.url && !image.thumbnailUrl && !image.filePath && !image.thumbnailPath}
      ...
    >
      {/* 按钮内容 */}
    </button>
  </div>
)}
```

#### 2.5 隐藏底部缩放控制条

**位置**: 第 663-669 行左右

**修改**: 用条件包裹
```tsx
{!isFailedImage && (
  <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 p-1.5 bg-white/90 backdrop-blur-xl border border-white/50 rounded-2xl shadow-2xl">
    {/* 缩放控制按钮 */}
  </div>
)}
```

#### 2.6 修改右键菜单

**位置**: 第 724-769 行左右

**修改**: 用条件包裹整个右键菜单
```tsx
{contextMenu && !isFailedImage && (
  <div ref={contextMenuRef} ...>
    {/* 右键菜单内容 */}
  </div>
)}
```

#### 2.7 隐藏下载按钮

**位置**: 第 906-910 行左右（右侧底部）

**修改**: 用条件包裹
```tsx
{!isFailedImage && (
  <div className="p-8 pt-3">
    <Button className="w-full h-14 bg-slate-900 hover:bg-black text-white" onClick={handleDownload}>
      <Download className="w-5 h-5 mr-3" /> {t('preview.downloadOriginal')}
    </Button>
  </div>
)}
```

---

## 📝 需要添加的翻译键

**文件**: 语言文件（如 `desktop/src/locales/zh-CN.json`）

添加以下翻译：
```json
{
  "preview": {
    "failed": {
      "title": "生成失败",
      "copyError": "复制错误信息",
      "errorCopied": "错误信息已复制"
    }
  }
}
```

---

## ✅ 验证清单

- [ ] ImageCard.tsx: 失败图片可以点击
- [ ] ImagePreview.tsx: 失败状态显示灰色占位图
- [ ] ImagePreview.tsx: 显示完整错误信息
- [ ] ImagePreview.tsx: "复制错误信息"按钮可用
- [ ] ImagePreview.tsx: 图片相关控件已隐藏
- [ ] 右侧信息面板: 提示词可复制
- [ ] 右侧信息面板: 下载按钮已隐藏
- [ ] TypeScript 编译通过
- [ ] 无运行时错误

---

## 🎨 UI 预览

### 失败图片弹窗
```
┌─────────────────────────────────────────────────────────┐
│  图片预览                                    [X]        │
├──────────────────────────────┬──────────────────────────┤
│                              │  提示词            [复制] │
│        ┌─────────┐           │  ┌─────────────────────┐ │
│        │  🖼️    │           │  │ A cat sitting on... │ │
│        │ 无图片  │           │  └─────────────────────┘ │
│        │         │           │                          │
│        │生成失败 │           │  模型: gemini-1.5-flash  │
│        │         │           │  尺寸: 0 × 0            │
│        │错误信息 │           │  时间: 2024-01-01       │
│        │显示在这里│           │                          │
│        │         │           │  (没有下载按钮)          │
│        └─────────┘           │                          │
│        [复制错误信息]         │                          │
│                              │                          │
└──────────────────────────────┴──────────────────────────┘
```

---

## 🚀 执行命令

### 创建分支
```bash
git checkout main
git pull origin main
git checkout -b feat/failed-image-preview
```

### 提交信息
```
feat: allow failed images to open preview

- Allow clicking on failed images to open preview modal
- Show placeholder state when image URL is missing
- Display full error message with copy button
- Hide image-specific controls (zoom, download, etc.) for failed images
```

### 推送和 PR

```bash
git push -u origin feat/failed-image-preview
gh pr create --title "feat: allow failed images to open preview" --body "..."
```

### PR 审查流程

**重要**：Code Review 通过后，**不能自动合并**，必须等待用户确认。

**流程**：
1. ✅ 创建 PR 并推送
2. ✅ 等待 CI 检查通过
3. ✅ 等待 Code Review 通过
4. ⏸️ **暂停** - 通知用户审查结果
5. ❓ **等待用户确认** - 是否合并到 main？
6. ✅ 用户确认后，执行合并

**禁止**：
- ❌ 不要在 Code Review 通过后自动合并
- ❌ 不要跳过用户确认步骤

**必须**：
- ✅ Code Review 通过后，主动通知用户
- ✅ 等待用户明确回复"可以合并"后再操作
```bash
git push -u origin feat/failed-image-preview
gh pr create --title "feat: allow failed images to open preview" --body "..."
```
