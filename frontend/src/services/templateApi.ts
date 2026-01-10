import api from './api';
import { TemplateListResponse } from '../types';

export const getTemplates = async (): Promise<TemplateListResponse> => {
  return api.get<TemplateListResponse>('/templates');
};
