import api from './api';
import type { ProviderConfig } from './providerApi';

export type { ProviderConfig } from './providerApi';
export { updateProviderConfig } from './providerApi';

// 获取当前 Provider 配置 (后端目前没有直接 GET 接口，这里先预留)
export const getProviderConfigs = () =>
  api.get<ProviderConfig[]>('/providers/config');
