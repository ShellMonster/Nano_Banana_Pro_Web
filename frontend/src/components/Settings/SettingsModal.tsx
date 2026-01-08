import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Key, Globe, Box, Save, Loader2 } from 'lucide-react';
import { useConfigStore } from '../../store/configStore';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { getProviders, updateProviderConfig, ProviderConfig } from '../../services/providerApi';
import { toast } from '../../store/toastStore';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { 
    provider, setProvider,
    apiKey, setApiKey, 
    apiBaseUrl, setApiBaseUrl, 
    model, setModel 
  } = useConfigStore();
  
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [fetching, setFetching] = useState(false);

  // 当弹窗打开时，从后端获取最新的配置
  useEffect(() => {
    if (isOpen) {
      fetchConfigs();
    }
  }, [isOpen]);

  const fetchConfigs = async () => {
    setFetching(true);
    try {
      const data = await getProviders();
      setProviders(data);
      
      // 如果当前选中的 provider 在后端有配置，同步到本地 store
      const currentConfig = data.find(p => p.provider_name === provider);
      if (currentConfig) {
        setApiBaseUrl(currentConfig.api_base);
        setApiKey(currentConfig.api_key);
      }
    } catch (error) {
      console.error('获取配置失败:', error);
      toast.error('获取后端配置失败');
    } finally {
      setFetching(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      // 1. 同步到后端
      await updateProviderConfig({
        provider_name: provider,
        display_name: provider, // 暂时用名字作为显示名
        api_base: apiBaseUrl,
        api_key: apiKey,
        enabled: true
      });

      toast.success('配置已成功同步到服务器');
      onClose();
    } catch (error) {
      console.error('保存失败:', error);
      toast.error('保存失败，请检查网络');
    } finally {
      setLoading(false);
    }
  };

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value;
    setProvider(newProvider);
    
    // 切换 provider 时，如果后端有对应的配置，自动填入
    const config = providers.find(p => p.provider_name === newProvider);
    if (config) {
      setApiBaseUrl(config.api_base);
      setApiKey(config.api_key);
    }
  };

  return (
    <Modal 
        isOpen={isOpen} 
        onClose={onClose} 
        title="系统设置" 
        className="max-w-sm"
        density="compact"
    >
      <div className="space-y-5 relative">
        {fetching && (
          <div className="absolute inset-0 bg-white/50 z-10 flex items-center justify-center rounded-2xl backdrop-blur-[1px]">
            <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
          </div>
        )}
        
        {/* Provider Selection */}
        <div className="space-y-3">
          <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
            <Box className="w-4 h-4 text-blue-600" />
            AI 服务商
          </label>
          <Select 
            value={provider} 
            onChange={handleProviderChange} 
            className="h-10 bg-slate-100 text-slate-900 font-bold rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
          >
            <option value="gemini">Google Gemini</option>
            {/* 后续可扩展更多 provider */}
          </Select>
        </div>

        {/* API Base URL */}
        <div className="space-y-3">
          <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
            <Globe className="w-4 h-4 text-blue-600" />
            Base URL
          </label>
          <Input
            type="text"
            value={apiBaseUrl || ''}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            placeholder="https://generativelanguage.googleapis.com"
            className="h-10 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
          />
          <p className="text-xs text-slate-500 leading-relaxed px-1">
            推荐使用云雾API获取更稳定的接口与价格：
            <a
              href="https://yunwu.ai/register?aff=i4hh"
              target="_blank"
              rel="noreferrer"
              className="ml-1 text-blue-600 hover:text-blue-700 underline underline-offset-2"
            >
              https://yunwu.ai/register?aff=i4hh
            </a>
          </p>
        </div>

        {/* API Key */}
        <div className="space-y-3">
          <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
            <Key className="w-4 h-4 text-blue-600" />
            API Key
          </label>
          <div className="relative">
            <Input
              type={showKey ? 'text' : 'password'}
              value={apiKey || ''}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-******************"
              className="h-10 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 pr-14 focus:bg-white border border-slate-200 transition-all shadow-none"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-blue-600 transition-colors bg-white/80 rounded-xl shadow-sm"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Model Name - 暂时固定，以后可根据 provider 动态获取 */}
        <div className="space-y-3">
          <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
            <Box className="w-4 h-4 text-blue-600" />
            默认模型
          </label>
          <Input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-10 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
          />
        </div>

        <div className="pt-3">
            <Button 
                onClick={handleSave} 
                disabled={loading}
                className="w-full h-12 text-base bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black rounded-2xl shadow-xl shadow-blue-200/50 border-none transition-all duration-300"
            >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    <span>同步并保存</span>
                  </>
                )}
            </Button>
        </div>
      </div>
    </Modal>
  );
}
