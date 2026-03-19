import { GenerationTask, GeneratedImage, BackendTask, BackendHistoryResponse } from '../types';
import { getImageUrlFromSource } from '../services/api';
import { localizeErrorSummary, sanitizeBackendErrorMessage } from './errorI18n';

/**
 * 将后端 Task 模型映射为前端 GenerationTask 模型
 */
export const mapBackendTaskToFrontend = (task: BackendTask): GenerationTask => {
  const getFullUrl = (path: string | undefined, source?: BackendTask['image_source']) => {
    return getImageUrlFromSource(source, path || '');
  };

  const localizedErrorMessage = localizeErrorSummary(task).errorMessage;
  const rawErrorMessage = sanitizeBackendErrorMessage(task.error_message);
  const rawErrorDetail = sanitizeBackendErrorMessage(task.error_detail);
  const rawErrorRawMessage = sanitizeBackendErrorMessage(task.error_raw_message);
  const promptOriginal = task.prompt_original || '';
  const promptOptimized = task.prompt_optimized || '';
  const promptOptimizeMode = task.prompt_optimize_mode || 'off';

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
    promptOriginal,
    promptOptimized,
    promptOptimizeMode,
    // 生成弹窗需要展示模型：对齐历史记录的 task.model 显示逻辑
    model: task.model_id || task.provider_name || '',
    errorMessage: localizedErrorMessage || rawErrorMessage,
    errorRawMessage: rawErrorRawMessage,
    errorCode: task.error_code || '',
    errorCategory: task.error_category || '',
    errorRequestId: task.error_request_id || '',
    errorRetryable: task.error_retryable,
    errorDetail: rawErrorDetail,
    status: task.status === 'completed' ? 'success' : (task.status === 'failed' ? 'failed' : 'pending'),
    // 弹窗预览使用原图
    url: getFullUrl(task.local_path || task.image_url || task.thumbnail_path || task.thumbnail_url, task.image_source),
    // 卡片展示优先使用缩略图
    thumbnailUrl: getFullUrl(task.thumbnail_path || task.local_path || task.thumbnail_url || task.image_url, task.thumbnail_source || task.image_source)
  };

  return {
    id: task.task_id,
    prompt: task.prompt,
    promptOriginal,
    promptOptimized,
    promptOptimizeMode,
    model: task.model_id || task.provider_name || '',
    totalCount: task.total_count || 1,
    completedCount: task.status === 'completed' ? (task.total_count || 1) : 0,
    status: task.status as GenerationTask['status'],
    errorMessage: localizedErrorMessage || rawErrorMessage,
    errorRawMessage: rawErrorRawMessage,
    errorCode: task.error_code || '',
    errorCategory: task.error_category || '',
    errorRequestId: task.error_request_id || '',
    errorRetryable: task.error_retryable,
    errorDetail: rawErrorDetail,
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
