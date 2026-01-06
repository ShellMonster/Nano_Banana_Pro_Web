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
// 应用数据目录，用于拼接本地图片路径
let appDataDir: string | null = null;

// 如果在 Tauri 环境中，主动获取端口并监听更新
if (window.__TAURI_INTERNALS__) {
  const initTauri = async () => {
    try {
      const { invoke, convertFileSrc } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      // 将 convertFileSrc 挂载到 window 方便全局使用
      (window as any).convertFileSrc = convertFileSrc;

      // 1. 先尝试获取当前已记录的端口
      const port = await invoke<number>('get_backend_port');
      if (port && port > 0) {
        updateBaseUrl(port);
      }

      // 2. 获取应用数据目录
      appDataDir = await invoke<string>('get_app_data_dir');
      console.log('App Data Dir detected:', appDataDir);

      // 3. 监听后续端口更新事件
      listen<{ port: number }>('backend-port', (event) => {
        updateBaseUrl(event.payload.port);
      });
    } catch (err) {
      console.error('Failed to initialize Tauri API:', err);
    }
  };

  initTauri();
}

function updateBaseUrl(port: number) {
  console.log('Updating backend port to:', port);
  const newBaseUrl = `http://127.0.0.1:${port}/api/v1`;
  BASE_URL = newBaseUrl;
  api.defaults.baseURL = newBaseUrl;
  isPortDetected = true;
  console.log('API base URL updated to:', newBaseUrl);
}

// 请求拦截器
api.interceptors.request.use(async (config) => {
  // 如果在 Tauri 环境下且还没检测到端口，且不是第一次尝试 8080，则稍微等待一下
  // 这可以减少刚启动时的竞争
  if (window.__TAURI_INTERNALS__ && !isPortDetected && config.baseURL?.includes('127.0.0.1:8080')) {
     // 最多等待 2 秒 (Sidecar 启动可能慢)
     for (let i = 0; i < 20; i++) {
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
  async (error) => {
    console.error('API Error Object:', error);
    
    if (error.message === 'Network Error' || error.code === 'ERR_NETWORK') {
      console.error('Detected Network Error. Diagnostics:');
      console.error('- BaseURL:', api.defaults.baseURL);
      console.error('- IsPortDetected:', isPortDetected);
      
      // 尝试 ping 一下健康检查接口
      try {
        const pingUrl = `${api.defaults.baseURL}/health`;
        console.log('Attempting diagnostic ping to:', pingUrl);
        // 使用 fetch 并增加一些配置，尝试穿透可能的拦截
        const response = await fetch(pingUrl, { 
          mode: 'cors',
          cache: 'no-cache',
          headers: { 'Accept': 'application/json' }
        });
        const result = await response.json();
        console.log('Diagnostic ping (fetch) succeeded:', result);
        console.log('This suggests the server is UP and CORS is OK. The issue might be Axios-specific or a race condition.');
      } catch (pingErr) {
        console.error('Diagnostic ping (fetch) failed:', pingErr);
        console.error('This suggests the server is NOT reachable. Possible reasons: Sandbox blocking, Process not running, or wrong IP/Port.');
      }
    }

    return Promise.reject(error);
  }
);

// 构造图片完整 URL 的工具函数
export const getImageUrl = (path: string) => {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  if (path.startsWith('blob:')) return path;
  if (path.startsWith('asset:')) return path;
  
  // 如果在 Tauri 环境下，且我们有 appDataDir，且路径看起来是本地存储路径
  // 优先使用 asset:// 协议直接读取本地磁盘，绕过 HTTP 端口，提升性能
  if (window.__TAURI_INTERNALS__ && appDataDir && (path.startsWith('storage/') || path.includes('/storage/'))) {
    try {
      // 这里的 path 可能是 storage/local/xxx.jpg
      // 我们需要拼接成绝对路径：appDataDir + / + path
      const separator = appDataDir.endsWith('/') || appDataDir.endsWith('\\') ? '' : '/';
      const absolutePath = `${appDataDir}${separator}${path}`;
      
      // 使用 Tauri 提供的 convertFileSrc 将绝对路径转为 asset:// 协议 URL
      // 注意：convertFileSrc 在 v2 中位于 @tauri-apps/api/core
      const { convertFileSrc } = window as any;
      if (typeof convertFileSrc === 'function') {
        return convertFileSrc(absolutePath);
      }
      
      // 如果 window 上没有，尝试手动拼接 (Tauri v2 默认格式)
      // 格式通常为: https://asset.localhost/<encoded_path> 或 asset://localhost/<path>
      // macOS 上常用 asset://localhost/
      return `asset://localhost${absolutePath.startsWith('/') ? '' : '/'}${encodeURIComponent(absolutePath).replace(/%2F/g, '/')}`;
    } catch (err) {
      console.error('Failed to convert local path to asset URL:', err);
    }
  }

  // 回退到 HTTP 方案
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
