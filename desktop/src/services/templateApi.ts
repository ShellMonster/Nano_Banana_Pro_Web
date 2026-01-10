import api from './api';
import { TemplateListResponse } from '../types';

export const getTemplates = async (): Promise<TemplateListResponse> => {
  return api.get<any>('/templates') as unknown as Promise<TemplateListResponse>;
};
