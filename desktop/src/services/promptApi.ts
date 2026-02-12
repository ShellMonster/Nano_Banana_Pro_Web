import api from './api';

export interface OptimizePromptResponse {
  prompt: string;
}

export interface OptimizePromptRequest {
  provider?: string;
  model: string;
  prompt: string;
  response_format?: string;
}

// 图片逆向提示词请求参数
export interface ImageToPromptRequest {
  provider?: string;
  model?: string;
  // 图片文件（用于上传）
  imageFile?: File;
  // 本地图片路径（Tauri 桌面端优化）
  imagePath?: string;
  // 输出语言（跟随用户界面语言）
  language?: string;
}

const extractPrompt = (value: any): string => {
  if (!value) return '';
  if (typeof value === 'string') {
    try {
      return extractPrompt(JSON.parse(value));
    } catch {
      return '';
    }
  }
  if (typeof value === 'object') {
    if (typeof value.prompt === 'string') return value.prompt;
    if ('data' in value) return extractPrompt((value as any).data);
  }
  return '';
};

export const optimizePrompt = async (payload: OptimizePromptRequest): Promise<OptimizePromptResponse> => {
  const res = await api.post<any>('/prompts/optimize', payload);
  return { prompt: extractPrompt(res) };
};

/**
 * 图片逆向提示词 - 分析图片生成提示词
 * 支持两种方式：
 * 1. 通过 imageFile 上传图片文件（Web 端）
 * 2. 通过 imagePath 传递本地图片路径（Tauri 桌面端优化）
 * 3. 通过 language 指定输出语言（跟随用户界面语言）
 */
export const imageToPrompt = async (payload: ImageToPromptRequest): Promise<OptimizePromptResponse> => {
  // 如果是本地路径（Tauri 桌面端），使用 JSON 请求
  if (payload.imagePath) {
    const formData = new FormData();
    if (payload.provider) {
      formData.append('provider', payload.provider);
    }
    if (payload.model) {
      formData.append('model', payload.model);
    }
    formData.append('image_path', payload.imagePath);
    if (payload.language) {
      formData.append('language', payload.language);
    }
    const res = await api.post<any>('/prompts/image-to-prompt', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return { prompt: extractPrompt(res) };
  }

  // 如果是文件上传，使用 multipart/form-data
  if (payload.imageFile) {
    const formData = new FormData();
    if (payload.provider) {
      formData.append('provider', payload.provider);
    }
    if (payload.model) {
      formData.append('model', payload.model);
    }
    formData.append('image', payload.imageFile);
    if (payload.language) {
      formData.append('language', payload.language);
    }
    const res = await api.post<any>('/prompts/image-to-prompt', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return { prompt: extractPrompt(res) };
  }

  throw new Error('请提供 imageFile 或 imagePath 参数');
};
