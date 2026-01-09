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
let portDetectedResolve: (() => void) | null = null;
const portDetectedPromise = new Promise<void>((resolve) => {
  portDetectedResolve = resolve;
});
let tauriInvoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
// 应用数据目录，用于拼接本地图片路径
let appDataDir: string | null = null;
let resolveInit: (value: void | PromiseLike<void>) => void;
export const tauriInitPromise = new Promise<void>((resolve) => {
  resolveInit = resolve;
});

// 如果在 Tauri 环境中，主动获取端口并监听更新
if (window.__TAURI_INTERNALS__) {
  const initTauri = async () => {
    try {
      const { invoke, convertFileSrc } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      // 将 convertFileSrc 挂载到 window 方便全局使用
      (window as any).convertFileSrc = convertFileSrc;
      tauriInvoke = invoke;

      // 1. 先尝试获取当前已记录的端口
      const port = await invoke<number>('get_backend_port');
      if (port && port > 0) {
        updateBaseUrl(port);
      }

      // 2. 获取应用数据目录
      appDataDir = await invoke<string>('get_app_data_dir');
      console.log('App Data Dir detected:', appDataDir);

      // 初始化完成
      resolveInit();

      // 3. 监听后续端口更新事件
      listen<{ port: number }>('backend-port', (event) => {
        updateBaseUrl(event.payload.port);
      });
    } catch (err) {
      console.error('Failed to initialize Tauri API:', err);
      resolveInit();
    }
  };

  initTauri();
} else {
  // 非 Tauri 环境立即完成
  setTimeout(() => resolveInit?.(), 0);
}

function updateBaseUrl(port: number) {
  console.log('Updating backend port to:', port);
  const newBaseUrl = `http://127.0.0.1:${port}/api/v1`;
  BASE_URL = newBaseUrl;
  api.defaults.baseURL = newBaseUrl;
  isPortDetected = true;
  if (portDetectedResolve) {
    portDetectedResolve();
    portDetectedResolve = null;
  }
  console.log('API base URL updated to:', newBaseUrl);
}

async function waitForBackendPort(timeoutMs = 10000) {
  if (!window.__TAURI_INTERNALS__) return;

  await tauriInitPromise;
  if (isPortDetected) return;

  if (!tauriInvoke) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      tauriInvoke = invoke;
    } catch (err) {
      console.warn('Failed to load Tauri invoke API:', err);
    }
  }

  const start = Date.now();
  while (!isPortDetected && Date.now() - start < timeoutMs) {
    if (tauriInvoke) {
      try {
        const port = await tauriInvoke('get_backend_port');
        if (typeof port === 'number' && port > 0) {
          updateBaseUrl(port);
          break;
        }
      } catch (err) {
        console.warn('Failed to fetch backend port:', err);
      }
    }

    await Promise.race([
      portDetectedPromise,
      new Promise((resolve) => setTimeout(resolve, 200)),
    ]);
  }

  if (!isPortDetected) {
    console.warn('Backend port not detected within timeout, continuing with default base URL.');
  }
}

// 请求拦截器
api.interceptors.request.use(async (config) => {
  if (window.__TAURI_INTERNALS__ && !isPortDetected) {
    await waitForBackendPort();
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

  const trimmed = path.trim();
  if (!trimmed) return '';

  // 已经是可直接加载的 URL，直接返回
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('asset:') ||
    trimmed.startsWith('tauri:') ||
    trimmed.startsWith('ipc:') ||
    trimmed.startsWith('http://asset.localhost')
  ) {
    return trimmed;
  }

  // file:// URL 在 WebView 中通常不可直接访问；在 Tauri 环境下尽量转换成 asset 协议
  const fileUrlPath = (() => {
    if (!trimmed.startsWith('file://')) return null;
    try {
      // 兼容 file:///xxx 和 file://localhost/xxx
      const withoutScheme = trimmed.replace(/^file:\/\//, '');
      const withoutHost = withoutScheme.replace(/^localhost\//, '');
      return decodeURIComponent(withoutHost);
    } catch {
      return null;
    }
  })();
  
  // 如果在 Tauri 环境下，且我们有 appDataDir，且路径看起来是本地存储路径
  // 优先使用 asset:// 协议直接读取本地磁盘，绕过 HTTP 端口，提升性能
  const tauriInternals = (window as any).__TAURI_INTERNALS__ as
    | { convertFileSrc?: (filePath: string, protocol?: string) => string }
    | undefined;

  const isWindowsAbsolutePath = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');
  const isPosixAbsolutePath = (p: string) => p.startsWith('/');
  const looksLikeAbsolutePath = (p: string) => isPosixAbsolutePath(p) || isWindowsAbsolutePath(p);

  const convertFileSrcSync: ((filePath: string) => string) | null = (() => {
    const globalConvert = (window as any).convertFileSrc;
    if (typeof globalConvert === 'function') return (filePath: string) => globalConvert(filePath);
    if (tauriInternals?.convertFileSrc) return (filePath: string) => tauriInternals.convertFileSrc!(filePath, 'asset');
    return null;
  })();

  const canUseAssetProtocol = Boolean(tauriInternals && convertFileSrcSync);

  // 1) 直接是文件路径（绝对路径或 file://）时，优先走 asset 协议
  if (canUseAssetProtocol && (fileUrlPath || looksLikeAbsolutePath(trimmed))) {
    try {
      let absolutePath = (fileUrlPath || trimmed).replace(/\\/g, '/').replace(/\/+/g, '/');
      // macOS/Linux 绝对路径必须以 / 开头；Windows 盘符路径不能补 /
      if (!looksLikeAbsolutePath(absolutePath) && !isWindowsAbsolutePath(absolutePath)) {
        absolutePath = '/' + absolutePath;
      }
      const url = convertFileSrcSync!(absolutePath);
      console.log('[getImageUrl] Converted absolute path to asset URL:', url, 'from:', absolutePath);
      return url;
    } catch (err) {
      console.error('[getImageUrl] Failed to convert absolute path to asset URL:', err);
    }
  }

  // 2) 典型的本地存储相对路径：尽量在 appDataDir 已获取后走 asset 协议
  if (canUseAssetProtocol && appDataDir && (trimmed.startsWith('storage/') || trimmed.includes('/storage/') || trimmed.includes('\\storage\\'))) {
    try {
      // 这里的 path 可能是 storage/local/xxx.jpg
      // 我们需要拼接成绝对路径：appDataDir + / + path
      const separator = appDataDir.endsWith('/') || appDataDir.endsWith('\\') ? '' : '/';
      // 如果 path 已经包含 appDataDir (可能是绝对路径)，则不重复拼接
      let absolutePath = trimmed.includes(appDataDir) ? trimmed : `${appDataDir}${separator}${trimmed}`;
      
      // 规范化路径：去掉重复的斜杠，处理相对路径
      absolutePath = absolutePath.replace(/\\/g, '/').replace(/\/+/g, '/');
      // macOS/Linux 绝对路径必须以 / 开头；Windows 盘符路径不能补 /
      if (!looksLikeAbsolutePath(absolutePath) && !isWindowsAbsolutePath(absolutePath)) {
        absolutePath = '/' + absolutePath;
      }

      // 使用 Tauri 提供的 convertFileSrc 将绝对路径转为 asset:// 协议 URL
      const url = convertFileSrcSync!(absolutePath);
      console.log('[getImageUrl] Converted to asset URL:', url, 'from:', absolutePath);
      return url;
    } catch (err) {
      console.error('[getImageUrl] Failed to convert local path to asset URL:', err);
    }
  }

  // 回退到 HTTP 方案
  // 从 BASE_URL 中提取基础地址（去掉 /api/v1）
  const baseUrl = api.defaults.baseURL || BASE_URL;
  const baseHost = baseUrl.replace('/api/v1', '');
  // 确保路径以 / 开头
  const normalizedInputPath = trimmed.replace(/\\/g, '/');
  const normalizedPath = normalizedInputPath.startsWith('/') ? normalizedInputPath : `/${normalizedInputPath}`;
  
  const url = `${baseHost}${normalizedPath}`;
  console.log('[getImageUrl] HTTP Fallback URL:', url);
  return url;
};

// 获取图片下载 URL
export const getImageDownloadUrl = (id: string) => {
    return `${BASE_URL}/images/${id}/download`;
};

export default api;
