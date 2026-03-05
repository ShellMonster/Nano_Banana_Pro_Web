import { GenerationTask, GeneratedImage, BackendTask, BackendHistoryResponse } from '../types';
import { getImageUrlFromSource } from '../services/api';

function sanitizeBackendErrorMessage(message?: string): string {
  if (!message) return '';
  const cleaned = message
    .split('\n')
    .filter((line) => !/^\s*at\s+.+/i.test(line))
    .join('\n')
    .trim();
  return cleaned.slice(0, 500);
}

/**
 * 将后端 Task 模型映射为前端 GenerationTask 模型
 */
export const mapBackendTaskToFrontend = (task: BackendTask): GenerationTask => {
  const getFullUrl = (path: string | undefined, source?: BackendTask['image_source']) => {
    return getImageUrlFromSource(source, path || '');
  };

  const sanitizedErrorMessage = sanitizeBackendErrorMessage(task.error_message);

  const image: GeneratedImage = {
    id: task.task_id,
    taskId: task.task_id,
    filePath: task.local_path || '',
    thumbnailPath: task.thumbnail_path || '',
    fileSize: 0,
    width: task.width || 0,
    height: task.height || 0,
    mimeType: 'image/jpeg',
    createdAt: task.created_at,
    prompt: task.prompt,
    // 生成弹窗需要展示模型：对齐历史记录的 task.model 显示逻辑
    model: task.model_id || task.provider_name || '',
    errorMessage: sanitizedErrorMessage,
    status: task.status === 'completed' ? 'success' : (task.status === 'failed' ? 'failed' : 'pending'),
    // 弹窗预览使用原图
    url: getFullUrl(task.local_path || task.image_url || task.thumbnail_path || task.thumbnail_url, task.image_source),
    // 卡片展示优先使用缩略图
    thumbnailUrl: getFullUrl(task.thumbnail_path || task.local_path || task.thumbnail_url || task.image_url, task.thumbnail_source || task.image_source)
  };

  return {
    id: task.task_id,
    prompt: task.prompt,
    model: task.model_id || task.provider_name || '',
    totalCount: task.total_count || 1,
    completedCount: task.status === 'completed' ? (task.total_count || 1) : 0,
    status: task.status as GenerationTask['status'],
    errorMessage: sanitizedErrorMessage,
    options: task.config_snapshot || '',
    createdAt: task.created_at,
    updatedAt: task.updated_at || '',
    images: [image]
  };
};

/**
 * 将后端列表响应映射为前端列表格式
 */
export const mapBackendHistoryResponse = (response: BackendHistoryResponse) => {
  // 后端现在返回格式为 { list: [], total: 0 }
  const { list, total } = response;
  return {
    list: (list || []).map(mapBackendTaskToFrontend),
    total: total || 0
  };
};
