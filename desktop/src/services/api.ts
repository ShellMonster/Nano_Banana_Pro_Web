import axios, { AxiosInstance } from 'axios';
import { ApiResponse } from '../types';

// 根据 API 文档，后端地址默认为 http://127.0.0.1:8080
export let BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8080/api/v1';

// 创建 axios 实例
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 60000,
}) as AxiosInstance;

// 标记是否已经获取到了动态端口
let isPortDetected = false;

// 如果在 Tauri 环境中，监听后端实际分配的端口
if (window.__TAURI_INTERNALS__) {
  import('@tauri-apps/api/event').then(({ listen }) => {
    listen<{ port: number }>('backend-port', (event) => {
        console.log('Received new backend port:', event.payload.port);
        // 使用 127.0.0.1 避免 localhost 解析问题
        const newBaseUrl = `http://127.0.0.1:${event.payload.port}/api/v1`;
        BASE_URL = newBaseUrl;
        api.defaults.baseURL = newBaseUrl;
        isPortDetected = true;
        
        console.log('API base URL updated to:', newBaseUrl);
      });
  });
}

// 请求拦截器
api.interceptors.request.use(async (config) => {
  // 如果在 Tauri 环境下且还没检测到端口，且不是第一次尝试 8080，则稍微等待一下
  // 这可以减少刚启动时的竞争
  if (window.__TAURI_INTERNALS__ && !isPortDetected && config.baseURL?.includes(':8080')) {
     // 最多等待 1 秒
     for (let i = 0; i < 10; i++) {
       if (isPortDetected) break;
       await new Promise(resolve => setTimeout(resolve, 100));
     }
  }

  // 确保 config.baseURL 使用最新的 BASE_URL（如果还没设置的话）
  if (isPortDetected && config.baseURL !== BASE_URL) {
    config.baseURL = BASE_URL;
  }

  console.log(`Making request to: ${config.baseURL}${config.url}`);
  return config;
});

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    // 特殊响应（如 responseType: 'blob'）不走统一 ApiResponse 解包
    const data = response.data as unknown;
    if (data instanceof Blob) return data;

    // 统一 JSON 响应格式解包：{ code, message, data }
    if (data && typeof data === 'object' && 'code' in data) {
      const res = data as ApiResponse<any>;
      // 支持 0 或 200 作为成功码
      if (typeof res.code === 'number' && res.code !== 0 && res.code !== 200) {
        return Promise.reject(new Error(res.message || 'Error'));
      }
      return res.data;
    }

    // 非统一结构（或后端直出数据），原样返回
    return data;
  },
  (error) => {
    console.error('API Error:', error);
    return Promise.reject(error);
  }
);

// 构造图片完整 URL 的工具函数
export const getImageUrl = (path: string) => {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  
  // 从 BASE_URL 中提取基础地址（去掉 /api/v1）
  const baseHost = BASE_URL.replace('/api/v1', '');
  // 确保路径以 / 开头
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  return `${baseHost}${normalizedPath}`;
};

// 获取图片下载 URL
export const getImageDownloadUrl = (id: string) => {
    return `${BASE_URL}/images/${id}/download`;
};

export default api;
