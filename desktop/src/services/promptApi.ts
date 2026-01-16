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
