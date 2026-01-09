import api from './api';

export interface ProviderConfig {
    provider_name: string;
    display_name: string;
    api_base: string;
    api_key: string;
    enabled: boolean;
    model_id?: string;
    models?: string;
}

export const getProviders = async (): Promise<ProviderConfig[]> => {
    return api.get('/providers');
};

export const updateProviderConfig = async (config: ProviderConfig): Promise<void> => {
    return api.post('/providers/config', config);
};
