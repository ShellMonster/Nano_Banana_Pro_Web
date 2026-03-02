# 需求梳理：失败图片可点击打开预览

## 📋 最终确定的需求

**只做一件事**：让生成失败的图片可以点击打开预览弹窗

**不做**：
- ❌ 重新生成按钮
- ❌ 参考图标记和展示

**关键问题解决方案**：失败图片没有图片 URL，ImagePreview 该如何展示？

---

## 🔍 ImagePreview 组件结构分析

### 当前布局
```
┌─────────────────────────────────────────────────────────┐
│  ImagePreview 弹窗                                        │
├──────────────────────────────┬──────────────────────────┤
│                              │                          │
│      左侧：图片展示区域        │      右侧：信息面板       │
│      (可缩放、拖拽)           │                          │
│                              │  - 提示词 (可复制)        │
│  - 背景模糊图                 │  - 模型                  │
│  - 缩略图占位                 │  - 尺寸                  │
│  - 高清大图                   │  - 时间                  │
│  - 缩放控制条                 │  - 下载按钮              │
│                              │                          │
└──────────────────────────────┴──────────────────────────┘
```

### 关键代码位置

**文件**: `desktop/src/components/GenerateArea/ImagePreview.tsx`

**图片展示区域**（第620-722行）：
- 背景模糊图：`image.thumbnailUrl || image.url`
- 缩略图占位：`image.thumbnailUrl || image.url`
- 高清大图：`image.url`
- 缩放控制条、拖拽交互

**信息面板**（第800-911行）：
- 提示词：`image.prompt`（第886行）
- 模型：`image.model`（第895行）
- 尺寸：`image.width × image.height`（第899行）
- 时间：`image.createdAt`（第903行）
- 下载按钮（第907-909行）

---

## 💡 失败图片展示方案

### 方案：失败状态占位图

**左侧图片区域改为展示**：

```
┌─────────────────────────────────────────┐
│                                         │
│           ┌─────────────┐               │
│           │             │               │
│           │   ❌ 图标    │               │
│           │             │               │
│           │  生成失败    │               │
│           │             │               │
│           │ 错误信息提示  │               │
│           │             │               │
│           └─────────────┘               │
│                                         │
└─────────────────────────────────────────┘
```

**具体改动**：

1. **条件判断**：当 `!image.url && !image.thumbnailUrl` 时，显示失败占位状态

2. **隐藏图片相关元素**：
   - 隐藏背景模糊图
   - 隐藏缩略图占位
   - 隐藏高清大图
   - 隐藏缩放控制条（底部 缩放/重置 按钮）
   - 隐藏右上角"复制图片"按钮
   - 隐藏右键菜单中的图片相关选项

3. **显示失败占位状态**：
   - 中央显示大图标（如 `XCircle` 或 `AlertCircle`）
   - 显示"生成失败"文字
   - 显示错误信息（如果 `image.errorMessage` 或 `image.status === 'failed'`）

4. **保留信息面板**：
   - ✅ 提示词（最重要！用户需要复制）
   - ✅ 模型、尺寸、时间
   - ❌ 隐藏"下载原图"按钮（因为没有图片）

---

## 📝 实现要点

### 1. ImageCard.tsx - 允许失败图片点击

**位置**: `desktop/src/components/GenerateArea/ImageCard.tsx` 第111-117行

**当前代码**：
```typescript
const handleClick = useCallback(() => {
  if (isSuccess) {    // ← 只有成功才能点击
    onClick(image);
  }
}, [image, isSuccess, onClick]);
```

**改为**：
```typescript
const handleClick = useCallback(() => {
  if (isSuccess || isFailed) {    // ← 成功或失败都可以点击
    onClick(image);
  }
}, [image, isSuccess, isFailed, onClick]);
```

---

### 2. ImagePreview.tsx - 失败状态展示

**A. 添加失败状态判断**（在组件顶部）：
```typescript
const isFailedImage = !image.url && !image.thumbnailUrl && image.status === 'failed';
```

**B. 左侧图片区域条件渲染**（第620-722行）：

```tsx
{/* 图片展示区域 */}
<div className="flex-1 bg-slate-50 relative min-h-[50vh] md:min-h-full overflow-hidden ...">
  
  {isFailedImage ? (
    // 失败状态占位图
    <div className="absolute inset-0 flex flex-col items-center justify-center">
      <div className="w-24 h-24 rounded-full bg-red-50 flex items-center justify-center mb-4">
        <XCircle className="w-12 h-12 text-red-500" />
      </div>
      <p className="text-lg font-bold text-slate-700 mb-2">生成失败</p>
      {image.errorMessage && (
        <p className="text-sm text-slate-500 max-w-md text-center px-4">
          {image.errorMessage}
        </p>
      )}
    </div>
  ) : (
    // 原有图片展示逻辑（不变）
    <>
      {/* 背景模糊图 */}
      {/* 缩略图占位 */}
      {/* 高清大图 */}
      {/* 缩放控制条 */}
    </>
  )}
  
</div>
```

**C. 隐藏右上角"复制图片"按钮**（第638-660行）：
```tsx
{!isFailedImage && (
  <div className="absolute top-6 right-4 z-50 ...">
    <button onClick={handleCopyImage} ...>
      {/* 复制图片按钮 */}
    </button>
  </div>
)}
```

**D. 隐藏底部缩放控制条**（第663-669行）：
```tsx
{!isFailedImage && (
  <div className="absolute bottom-8 left-1/2 ...">
    {/* 缩放控制按钮 */}
  </div>
)}
```

**E. 隐藏右键菜单中的图片相关选项**（第724-769行）：
```tsx
{contextMenu && !isFailedImage && (
  <div ref={contextMenuRef} ...>
    {/* 右键菜单内容 */}
  </div>
)}
```

**F. 右侧信息面板隐藏下载按钮**（第906-910行）：
```tsx
{!isFailedImage && (
  <div className="p-8 pt-3">
    <Button className="w-full h-14 ..." onClick={handleDownload}>
      <Download className="w-5 h-5 mr-3" /> {t('preview.downloadOriginal')}
    </Button>
  </div>
)}
```

---

## ✅ 用户体验流程

### 成功图片（现有流程，不变）
1. 用户点击成功图片卡片
2. 打开 ImagePreview 弹窗
3. 左侧显示生成的图片（可缩放、拖拽）
4. 右侧显示提示词、模型、尺寸、时间
5. 可以复制图片、下载原图

### 失败图片（新增流程）
1. 用户点击失败图片卡片（现在可以点击了）
2. 打开 ImagePreview 弹窗
3. 左侧显示失败占位图（❌ 图标 + "生成失败"）
4. 右侧显示提示词、模型、尺寸、时间
5. **可以复制提示词**（最重要的功能！）
6. 没有下载按钮（因为没有图片）

---

## 🎯 为什么这个方案最好

1. **最小改动**：只修改两处文件，不改动后端
2. **用户体验一致**：成功和失败都用同样的弹窗，降低学习成本
3. **核心需求满足**：用户可以看到失败详情，复制提示词
4. **视觉清晰**：失败状态明确，不会让用户困惑为什么没有图片
5. **功能完整**：保留了所有有用的信息（提示词、参数）

---

## 📊 改动清单

| 文件 | 改动内容 | 行号 |
|------|---------|------|
| `ImageCard.tsx` | 允许失败图片点击 | ~111-117 |
| `ImagePreview.tsx` | 添加 `isFailedImage` 判断 | ~新增 |
| `ImagePreview.tsx` | 左侧显示失败占位图 | ~620-722 |
| `ImagePreview.tsx` | 条件隐藏复制图片按钮 | ~638-660 |
| `ImagePreview.tsx` | 条件隐藏缩放控制条 | ~663-669 |
| `ImagePreview.tsx` | 条件隐藏右键菜单 | ~724-769 |
| `ImagePreview.tsx` | 条件隐藏下载按钮 | ~906-910 |

**预计工作量**：1-2小时

---

## 🤔 确认问题

1. **失败图片显示什么图标？**
   - A) ❌ XCircle（红色，明显表示失败）
   - B) ⚠️ AlertCircle（黄色，表示警告）
   - C) 🖼️ ImageOff（灰色，表示无图片）

2. **是否显示错误信息？**
   - 后端返回的错误信息可能很长且技术性（如"connection timeout"、"rate limit exceeded"）
   - 是否要在弹窗中显示完整错误信息？
   - 还是只显示"生成失败"即可？

3. **是否需要添加"复制错误信息"按钮？**
   - 方便用户反馈问题时提供错误详情

请确认以上问题，然后我可以创建详细的工作计划！
