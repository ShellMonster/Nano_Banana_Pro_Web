# 需求梳理：生成失败图片与参考图功能增强

## 📋 需求总览

用户提出了4个相关需求：

1. **失败图片可点击查看详情** - 能复制提示词再次生成
2. **失败卡片添加"重新生成"按钮** - 用同参数重新调用生成一次
3. **参考图标记** - 使用了参考图的任务在卡片上标记出来
4. **弹窗展示参考图** - 在图片预览弹窗里展示原本上传的参考图

---

## 🔍 现状分析

### 1. 失败图片当前处理方式

**相关文件**: `desktop/src/components/GenerateArea/ImageCard.tsx`

**当前逻辑**:
```typescript
// 第24-26行
const isFailed = image.status === 'failed';
const isPending = !isFailed && (image.status === 'pending' || !image.url);
const isSuccess = image.status === 'success' && Boolean(image.url);

// 第111-117行：点击处理
const handleClick = useCallback(() => {
  if (isSuccess) {    // ← 只有成功状态才触发预览
    onClick(image);
  }
}, [image, isSuccess, onClick]);

// 第428-436行：失败状态只显示图标+文字
{isFailed && (
  <div className="...">
    <div className="w-10 h-10 rounded-full bg-red-50 ...">
      <X className="w-5 h-5 text-red-500" />
    </div>
    <span className="text-sm text-red-600 font-medium">{t('generate.failed')}</span>
  </div>
)}
```

**问题**: 失败图片无法点击，用户看不到提示词等详情

---

### 2. 生成任务数据结构

**类型定义**: `desktop/src/types/index.ts`

```typescript
// GenerationTask - 任务对象
interface GenerationTask {
  id: string;
  prompt: string;          // ⭐ 提示词
  model: string;           // ⭐ 模型ID
  totalCount: number;      // ⭐ 生成数量
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial';
  options: string;         // ⭐ JSON字符串：{ aspectRatio, imageSize }
  images: GeneratedImage[];
  // ❌ 注意：没有存储参考图信息！
}

// GeneratedImage - 单张图片对象
interface GeneratedImage {
  id: string;
  prompt?: string;         // ⭐ 提示词
  model?: string;          // ⭐ 模型
  options?: string | ImageOptions;  // ⭐ 包含 aspectRatio 和 imageSize
  status?: 'pending' | 'success' | 'failed';
  // ...
}

// ImageOptions
interface ImageOptions {
  aspectRatio: string;     // ⭐ 画幅比例
  imageSize: string;       // ⭐ 图片尺寸
}
```

**关键发现**:
- ✅ `prompt`, `model`, `options` 在失败时仍然保留
- ❌ **参考图信息没有在任务中持久化存储！**

---

### 3. 重新生成机制

**核心Hook**: `desktop/src/hooks/useGenerate.ts`

```typescript
// 第322-610行
generate = async () => {
  // 从 configStore 读取参数
  const {
    prompt,
    imageModel: model_id,
    imageProvider: provider,
    aspectRatio,
    imageSize,
    count,
    refFiles  // ← 参考图
  } = useConfigStore.getState();
  
  // 调用API生成
  if (refFiles?.length > 0) {
    // 图生图模式
    await generateBatchWithImages(formData);
  } else {
    // 文生图模式
    await generateBatch({ prompt, model_id, count, aspectRatio, imageSize });
  }
}
```

**结论**: 目前没有"重新生成"功能，generate() 只能从 configStore 读取参数

---

### 4. 参考图当前处理方式

**类型定义**:
```typescript
// PersistedRefImage - 持久化参考图
interface PersistedRefImage {
  id: string;
  name: string;
  path: string;            // 本地路径
  origin: 'external' | 'appdata';
  mimeType?: string;
  size?: number;
}
```

**当前状态**:
- 参考图存储在 `configStore.refFiles`（临时）
- ❌ **GenerationTask 没有存储参考图信息**
- ❌ 历史记录中无法知道该任务是否使用了参考图
- ❌ 更无法恢复参考图

---

### 5. ImagePreview 组件结构

**文件**: `desktop/src/components/GenerateArea/ImagePreview.tsx`

```typescript
interface ImagePreviewProps {
  image: (GeneratedImage & { model?: string }) | null;
  images?: GeneratedImage[];     // 图片列表用于切换
  onImageChange?: (image: GeneratedImage) => void;
  onClose: () => void;
  // ❌ 没有参考图参数！
}
```

**当前展示字段**:
- 图片（大图）
- 提示词（第879-883行）
- 模型名称（第895行）
- 尺寸（第904行）
- 创建时间（第911行）
- ❌ **没有参考图展示区域**

---

## 💡 方案建议

### 方案A：仅支持失败图片查看详情（最小改动）

**改动点**:
1. 修改 `ImageCard.tsx` - 让失败图片也能点击打开预览
2. `ImagePreview` 已有 `prompt` 展示，只是之前失败图片打不开

**优点**: 改动最小，无后端改动
**缺点**: 只能复制提示词，无法一键重新生成

---

### 方案B：失败图片 + 重新生成按钮（推荐）

**改动点**:

#### 1. ImageCard.tsx - 添加"重新生成"按钮
```typescript
// 在失败状态区域添加按钮
{isFailed && (
  <div className="...">
    <div className="flex flex-col items-center gap-2">
      {/* 原有失败图标 */}
      <div className="w-10 h-10 rounded-full bg-red-50 ...">...</div>
      <span className="text-sm text-red-600">{t('generate.failed')}</span>
      
      {/* 新增：重新生成按钮 */}
      <Button 
        size="sm" 
        variant="secondary"
        onClick={(e) => {
          e.stopPropagation();
          onRegenerate?.(image);
        }}
      >
        <RefreshCw className="w-4 h-4 mr-1" />
        {t('generate.regenerate')}
      </Button>
    </div>
  </div>
)}
```

#### 2. useGenerate.ts - 添加 regenerate 方法
```typescript
const regenerate = async (source: GeneratedImage | GenerationTask) => {
  // 提取参数
  const prompt = source.prompt;
  const model = source.model;
  const options = typeof source.options === 'string' 
    ? JSON.parse(source.options) 
    : source.options;
  
  // 设置到 configStore
  configStore.setPrompt(prompt);
  configStore.setImageModel(model);
  configStore.setAspectRatio(options.aspectRatio);
  configStore.setImageSize(options.imageSize);
  configStore.setCount(1);
  configStore.clearRefFiles(); // 参考图无法恢复
  
  // 调用生成
  await generate();
};
```

#### 3. GenerateArea/index.tsx - 传递回调
```typescript
<ImageCard
  image={image}
  onClick={handleImageClick}
  onRegenerate={handleRegenerate}  // 新增
/>
```

**优点**: 
- 用户体验好，一键重新生成
- 无需后端改动
- 失败图片也能点击查看详情

**缺点**: 
- 参考图无法恢复（因为任务没存储）
- 如果参考图很重要，用户需要重新上传

---

### 方案C：完整版（包含参考图持久化）

**需要后端支持**：修改数据库模型存储参考图信息

**改动点**:

#### 1. Backend - 修改 Task 模型
```go
// backend/internal/models/task.go
type GenerationTask struct {
    // ... 现有字段
    RefImagePaths []string `json:"ref_image_paths"` // 参考图路径
}
```

#### 2. Frontend - 修改 GenerationTask 类型
```typescript
interface GenerationTask {
  // ... 现有字段
  refImagePaths?: string[];  // 参考图路径列表
}
```

#### 3. ImagePreview - 展示参考图
```typescript
interface ImagePreviewProps {
  image: GeneratedImage | null;
  refImages?: string[];  // 新增：参考图路径
  // ...
}

// 在弹窗底部添加参考图展示区域
{refImages && refImages.length > 0 && (
  <div className="border-t border-slate-100 pt-4 mt-4">
    <h4 className="text-sm font-medium text-slate-600 mb-2">{t('preview.refImages')}</h4>
    <div className="flex gap-2">
      {refImages.map((path, idx) => (
        <img key={idx} src={getImageUrl(path)} className="w-16 h-16 object-cover rounded" />
      ))}
    </div>
  </div>
)}
```

#### 4. ImageCard - 参考图标记
```typescript
// 在卡片角落添加标记
{task.refImagePaths && task.refImagePaths.length > 0 && (
  <div className="absolute top-2 left-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
    <ImageIcon className="w-3 h-3" />
    <span>{task.refImagePaths.length}</span>
  </div>
)}
```

**优点**: 
- 完整功能：参考图也能恢复和展示
- 用户体验最佳

**缺点**: 
- 需要后端改动（数据库迁移）
- 改动量大
- 历史任务没有参考图数据（需要处理兼容性）

---

## 🎯 我的建议

### 第一阶段：方案B（失败图片 + 重新生成按钮）

**适合场景**:
- 快速解决问题
- 参考图不是关键因素（或用户可以重新上传）
- 不想改动后端

**具体实现**:
1. ✅ 修改 `ImageCard.tsx` - 失败图片可点击
2. ✅ 修改 `ImageCard.tsx` - 添加"重新生成"按钮
3. ✅ 修改 `useGenerate.ts` - 添加 `regenerate` 方法
4. ✅ 修改 `GenerateArea/index.tsx` - 传递回调

**预计工作量**: 2-3小时

---

### 第二阶段：方案C（参考图持久化）

**适合场景**:
- 参考图是重要的生成参数
- 可以接受后端改动
- 需要完整的历史记录恢复能力

**前置条件**:
- 后端支持存储参考图路径
- 数据库迁移

**预计工作量**: 1-2天（含后端）

---

## 🤔 需要确认的问题

1. **参考图重要吗？**
   - 如果很多任务都依赖参考图，建议做方案C
   - 如果参考图只是偶尔使用，方案B更实用

2. **历史任务的参考图需要恢复吗？**
   - 需要 → 必须做方案C（后端改动）
   - 不需要 → 方案B足够（仅新任务）

3. **重新生成时是否需要让用户确认参数？**
   - 直接生成 → 简单，但可能不符合当前意图
   - 填入表单 → 让用户可以修改后再生成

4. **失败图片的预览弹窗里需要哪些操作？**
   - 仅查看信息
   - 复制提示词按钮
   - 直接重新生成按钮

---

## 📝 下一步

请告诉我：
1. 你想先做哪个方案？（A、B 或 C）
2. 确认上述问题的答案
3. 是否需要我创建详细的工作计划？


---

## 📊 探索任务补充信息

### 从后台探索任务获取的关键发现

#### 1. ImagePreview 调用位置

**两处调用**：
1. `GenerateArea/index.tsx` - 生成区域预览
2. `HistoryPanel/HistoryList.tsx` - 历史记录预览

**结论**：只需要修改一处逻辑，两处都会生效

---

#### 2. 失败任务数据保留情况

| 字段 | 失败时是否保留 | 说明 |
|------|---------------|------|
| `prompt` | ✅ 保留 | 提示词完整 |
| `model` | ✅ 保留 | 模型ID完整 |
| `options` | ✅ 保留 | JSON字符串，包含 aspectRatio 和 imageSize |
| `createdAt` | ✅ 保留 | 创建时间 |
| `errorMessage` | ✅ 保留 | 错误信息 |
| `images` | ❌ 为空 | 失败时没有图片 |

**关键结论**：失败任务保留了完整的生成参数，可以用于重新生成！

---

#### 3. FailedTaskCard 组件

**文件**：`desktop/src/components/HistoryPanel/FailedTaskCard.tsx`

这个组件专门处理失败/处理中的任务展示，已经实现了：
- 解析 `options` 字段获取配置标签（aspectRatio, imageSize）
- 展示错误信息
- 但 `onClick` 回调目前只是打印日志

**可以在此处添加"重试"按钮**

---

#### 4. 当前参考图状态（关键发现）

**configStore.ts 中的参考图**：
```typescript
refFiles: File[]  // 临时存储，页面刷新即丢失
```

**任务对象中**：
```typescript
interface GenerationTask {
  // ... 其他字段
  // ❌ 没有 refImages 或 refImagePaths 字段！
}
```

**结论**：
- 参考图只在生成时临时存储在 configStore
- 任务完成后**没有持久化**参考图信息
- 历史记录无法知道该任务是否使用了参考图
- 更无法恢复参考图

---

## 🎯 最终建议

### 推荐方案：阶段性实现

#### 第一阶段：立即实现（今天就能做）

**功能**：失败图片 + 重新生成按钮

**涉及文件**：
1. `desktop/src/components/GenerateArea/ImageCard.tsx`
   - 修改失败状态的点击逻辑（允许打开预览）
   - 添加"重新生成"按钮

2. `desktop/src/hooks/useGenerate.ts`
   - 添加 `regenerate(image/task)` 方法

3. `desktop/src/components/GenerateArea/index.tsx`
   - 传递 `onRegenerate` 回调

**效果**：
- ✅ 失败图片可以点击打开预览，查看提示词
- ✅ 点击"重新生成"按钮，用相同参数重新生成
- ❌ 参考图无法恢复（需要用户重新上传）

**工作量**：约 2-3 小时

---

#### 第二阶段：可选增强（需要后端支持）

**功能**：参考图持久化 + 标记 + 预览

**需要改动**：
1. **Backend**：Task 模型添加 `ref_image_paths` 字段
2. **Frontend**：GenerationTask 类型添加 `refImagePaths` 字段
3. **Frontend**：ImageCard 添加参考图数量标记
4. **Frontend**：ImagePreview 添加参考图展示区域

**效果**：
- ✅ 卡片上显示"有参考图"标记
- ✅ 预览弹窗展示参考图缩略图
- ✅ 重新生成时恢复参考图

**工作量**：约 1-2 天（含后端）

---

## ❓ 需要你做决定的问题

### 问题 1：先做哪个阶段？

- **选项A**：只做第一阶段（今天完成）
- **选项B**：第一阶段 + 第二阶段后端改动（需要更多时间）
- **选项C**：只做参考图标记（不存储，仅提示用户）

### 问题 2：重新生成的交互方式？

- **选项A**：直接生成（一键重新生成，简单快捷）
- **选项B**：填入表单（把参数填入生成区，让用户可以修改后再生成）

### 问题 3：失败图片的预览弹窗需要什么功能？

- 仅查看信息（提示词、模型、尺寸）
- 复制提示词按钮
- 重新生成按钮
- 其他？

### 问题 4：参考图重要吗？

- **很重要**：很多失败任务是因为参考图问题，需要重新上传
- **不重要**：主要是提示词或模型问题，参考图可以忽略

---

## 📝 我的推荐

**推荐做法**：先做第一阶段

理由：
1. **快速见效**：今天就能完成，解决主要痛点
2. **独立可行**：不需要等待后端改动
3. **用户价值**：失败图片能查看详情+一键重试，体验大幅提升
4. **后续扩展**：第一阶段完成后，第二阶段可以独立进行

**具体功能**：
1. 失败图片可以点击打开预览弹窗
2. 弹窗里显示：提示词、模型、尺寸、错误信息
3. 添加"复制提示词"按钮
4. 添加"重新生成"按钮（直接生成，不填入表单）

---

请回答上述问题，我会根据你的选择创建详细的工作计划！
