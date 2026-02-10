import api from './api';
import { BatchGenerateRequest, BackendTask } from '../types';
import { mapBackendTaskToFrontend } from '../utils/mapping';

// 批量生成图片 (JSON 版)
// 后端接口为 /tasks/generate
// 注意：API 拦截器已解包 response.data，返回的是实际数据
export const generateBatch = async (params: BatchGenerateRequest) => {
  const res = await api.post<BackendTask>('/tasks/generate', params);
  return mapBackendTaskToFrontend(res as unknown as BackendTask);
};

// 批量图生图 (FormData 版)
// 后端接口为 /tasks/generate-with-images
export const generateBatchWithImages = async (formData: FormData) => {
  const res = await api.post<BackendTask>('/tasks/generate-with-images', formData);
  return mapBackendTaskToFrontend(res as unknown as BackendTask);
};

// 查询任务状态 (后端接口为 /tasks/:task_id)
export const getTaskStatus = async (taskId: string) => {
  const res = await api.get<BackendTask>(`/tasks/${taskId}`);
  return mapBackendTaskToFrontend(res as unknown as BackendTask);
};