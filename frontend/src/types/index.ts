// 统一响应格式
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

// 图片模型
export interface GeneratedImage {
  id: string;
  taskId: string;
  filePath: string;
  thumbnailPath: string;
  fileSize: number;
  width: number;
  height: number;
  mimeType: string;
  createdAt: string;
  // 前端辅助字段
  url?: string;
  thumbnailUrl?: string;
  prompt?: string;
  status?: 'pending' | 'success' | 'failed';
  model?: string;
  options?: string | ImageOptions;
}

// 图片选项配置
export interface ImageOptions {
  aspectRatio: string;
  imageSize: string;
}

// 任务模型
export interface GenerationTask {
  id: string;
  prompt: string;
  model: string;
  totalCount: number;
  completedCount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial';
  options: string;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
  images: GeneratedImage[];
}

// 批量生成请求参数
export interface BatchGenerateRequest {
  prompt: string;
  model: string;
  count: number;
  apiKey: string;
  apiBase?: string;
  options?: string;
  // 正式 API 参数
  imageSize?: string;
  aspectRatio?: string;
}

// 历史记录列表项（通常即为 Task）
export type HistoryItem = GenerationTask;

// 历史查询参数
export interface HistoryQueryParams {
    page?: number;
    pageSize?: number;
    keyword?: string;
}

// 历史列表响应
export interface HistoryListResponse {
    list: GenerationTask[];
    total: number;
    page: number;
    pageSize?: number;  // 每页数量（搜索接口返回）
    keyword?: string;   // 搜索关键词（仅搜索接口返回）
}

// 扩展的 File 类型，用于参考图上传
export interface ExtendedFile extends File {
  // MD5 哈希值，用于去重
  __md5?: string;
  // 是否被压缩过
  __compressed?: boolean;
  // 原始文件大小（压缩前）
  __originalSize?: number;
}

// 模板市场数据
export interface TemplateRequirement {
  minRefs?: number;
  note?: string;
}

export interface TemplateItem {
  id: string;
  title: string;
  channels: string[];
  materials: string[];
  industries: string[];
  ratio: string;
  preview: string;
  image: string;
  prompt?: string;
  tips?: string;
  source?: TemplateSource;
  tags?: string[];
  requirements?: TemplateRequirement;
}

export interface TemplateSource {
  name: string;
  label?: string;
  icon?: string;
  url?: string;
}

export interface TemplateMeta {
  channels: string[];
  materials: string[];
  industries: string[];
  ratios: string[];
  version?: string;
  updated_at?: string;
}

export interface TemplateListResponse {
  meta: TemplateMeta;
  items: TemplateItem[];
}
