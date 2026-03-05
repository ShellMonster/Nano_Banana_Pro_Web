import api from './api';
import { BackendHistoryResponse, BackendImageSource } from '../types';

export interface Folder {
  id: number;
  name: string;
  type: 'manual' | 'month';
  year?: number;
  month?: number;
  created_at: string;
  updated_at?: string;
  image_count?: number;
  cover_image?: string;
  cover_image_source?: BackendImageSource;
}

export interface FolderImagesQuery {
  page?: number;
  pageSize?: number;
}

export interface CreateFolderRequest {
  name: string;
}

export interface MoveImageRequest {
  task_id: string;
  folder_id: string;
}

// 获取所有文件夹
export const getFolders = async (): Promise<Folder[]> => {
  const response = await api.get<Folder[]>('/folders');
  return (response as unknown as Folder[]) || [];
};

// 获取指定文件夹下图片（分页）
export const getFolderImages = async (folderId: number, params: FolderImagesQuery = {}): Promise<BackendHistoryResponse> => {
  const response = await api.get<BackendHistoryResponse>(`/folders/${folderId}/images`, {
    params: {
      page: params.page ?? 1,
      page_size: params.pageSize ?? 20
    }
  });

  const data = response as Partial<BackendHistoryResponse>;
  if (Array.isArray(data.list) && typeof data.total === 'number') {
    return { list: data.list as BackendHistoryResponse['list'], total: data.total };
  }

  console.warn('getFolderImages received an unexpected response shape:', response);
  return { list: [], total: 0 };
};

// 创建手动文件夹
export const createFolder = async (data: CreateFolderRequest): Promise<Folder> => {
  const response = await api.post<Folder>('/folders', data);
  return response as unknown as Folder;
};

// 更新文件夹名称
export const updateFolder = async (id: number, data: CreateFolderRequest): Promise<Folder> => {
  const response = await api.put<Folder>(`/folders/${id}`, data);
  return response as unknown as Folder;
};

// 删除文件夹
export const deleteFolder = async (id: number): Promise<void> => {
  await api.delete(`/folders/${id}`);
};

// 移动图片到指定文件夹
export const moveImageToFolder = async (data: MoveImageRequest): Promise<void> => {
  await api.post('/folders/move-image', data);
};
