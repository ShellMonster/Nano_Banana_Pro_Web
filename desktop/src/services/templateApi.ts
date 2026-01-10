import api, { BASE_URL } from './api';
import { TemplateListResponse } from '../types';

export const getTemplates = async (): Promise<TemplateListResponse> => {
  return api.get<any>('/templates') as unknown as Promise<TemplateListResponse>;
};

export const getTemplateImageProxyUrl = (source: string): string => {
  const trimmed = source?.trim();
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  const baseUrl = api.defaults.baseURL || BASE_URL;
  return `${baseUrl}/template-image?url=${encodeURIComponent(trimmed)}`;
};
