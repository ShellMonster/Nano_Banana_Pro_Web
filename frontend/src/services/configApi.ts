import api from './api';

export interface ProviderConfig {
  provider_name: string;
  display_name: string;
  api_key: string;
  api_base: string;
  enabled: boolean;
  model_id?: string;
  models?: string;
}

// 更新 Provider 配置
export const updateProviderConfig = (config: Partial<ProviderConfig>) =>
  api.post('/providers/config', config);

// 获取当前 Provider 配置 (后端目前没有直接 GET 接口，这里先预留)
export const getProviderConfigs = () =>
  api.get<ProviderConfig[]>('/providers/config');
