import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Key, Globe, Box, Save, Loader2, Languages, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '../../store/configStore';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { getProviders, updateProviderConfig, ProviderConfig } from '../../services/providerApi';
import { toast } from '../../store/toastStore';
import i18n, { DEFAULT_LANGUAGE } from '../../i18n';
import { getSystemLocale } from '../../i18n/systemLocale';

const CHAT_PROVIDER_OPTIONS = [
  { value: 'gemini-chat', label: 'Gemini(/v1beta)', defaultBase: 'https://generativelanguage.googleapis.com' },
  { value: 'openai-chat', label: 'OpenAI(/v1)', defaultBase: 'https://api.openai.com/v1' }
];
const DEFAULT_CHAT_PROVIDER = 'openai-chat';

type SettingsTab = 'language' | 'image' | 'chat';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const getDefaultModelId = (models?: string): string => {
  if (!models) return '';
  try {
    const parsed = typeof models === 'string' ? JSON.parse(models) : models;
    if (!Array.isArray(parsed)) return '';
    const preferred = parsed.find((item) => item && item.default && typeof item.id === 'string');
    if (preferred?.id) return preferred.id;
    const fallback = parsed.find((item) => item && typeof item.id === 'string');
    return fallback?.id || '';
  } catch {
    return '';
  }
};

const getChatProviderDefaults = (provider: string) => {
  const fallback = CHAT_PROVIDER_OPTIONS.find((item) => item.value === DEFAULT_CHAT_PROVIDER);
  const current = CHAT_PROVIDER_OPTIONS.find((item) => item.value === provider) || fallback;
  return {
    baseUrl: current?.defaultBase || 'https://api.openai.com/v1',
    model: 'gemini-3-flash-preview'
  };
};

const resolveSystemLanguage = (locale: string | null) => {
  if (!locale) return DEFAULT_LANGUAGE;
  const lower = locale.toLowerCase();
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('ja')) return 'ja-JP';
  if (lower.startsWith('ko')) return 'ko-KR';
  if (lower.startsWith('en')) return 'en-US';
  return 'en-US';
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { t } = useTranslation();
  const {
    imageProvider, setImageProvider,
    imageApiKey, setImageApiKey,
    imageApiBaseUrl, setImageApiBaseUrl,
    imageModel, setImageModel,
    chatProvider, setChatProvider,
    chatApiBaseUrl, setChatApiBaseUrl,
    chatApiKey, setChatApiKey,
    chatModel, setChatModel,
    setChatSyncedConfig,
    language,
    languageResolved,
    setLanguage,
    setLanguageResolved
  } = useConfigStore();

  const [activeTab, setActiveTab] = useState<SettingsTab>('image');
  const [showImageKey, setShowImageKey] = useState(false);
  const [showChatKey, setShowChatKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [fetching, setFetching] = useState(false);

  // 当弹窗打开时，从后端获取最新的配置
  useEffect(() => {
    if (isOpen) {
      setActiveTab('image');
      setShowImageKey(false);
      setShowChatKey(false);
      fetchConfigs();
    }
  }, [isOpen]);

  const fetchConfigs = async () => {
    setFetching(true);
    try {
      const data = await getProviders();
      setProviders(data);

      const imageConfig = data.find((p) => p.provider_name === imageProvider);
      if (imageConfig) {
        setImageApiBaseUrl(imageConfig.api_base);
        setImageApiKey(imageConfig.api_key);
        const modelFromConfig = getDefaultModelId(imageConfig.models);
        if (modelFromConfig) {
          setImageModel(modelFromConfig);
        }
      }

      const chatConfig = data.find((p) => p.provider_name === chatProvider);
      if (chatConfig) {
        setChatApiBaseUrl(chatConfig.api_base);
        setChatApiKey(chatConfig.api_key);
        const modelFromConfig = getDefaultModelId(chatConfig.models);
        if (modelFromConfig) {
          setChatModel(modelFromConfig);
        }
        setChatSyncedConfig({
          apiBaseUrl: chatConfig.api_base || '',
          apiKey: chatConfig.api_key || '',
          model: modelFromConfig || ''
        });
      } else {
        const defaults = getChatProviderDefaults(chatProvider);
        setChatApiBaseUrl(defaults.baseUrl);
        setChatModel(defaults.model);
        setChatSyncedConfig(null);
      }
    } catch (error) {
      console.error('Failed to fetch config:', error);
      toast.error(t('settings.toast.fetchFailed'));
    } finally {
      setFetching(false);
    }
  };

  const handleSave = async () => {
    const imageBase = imageApiBaseUrl.trim();
    const imageKey = imageApiKey.trim();
    const imageModelValue = imageModel.trim();
    if (!imageBase || !imageKey || !imageModelValue) {
      toast.error(t('settings.toast.imageConfigIncomplete'));
      return;
    }

    const chatBase = chatApiBaseUrl.trim();
    const chatKey = chatApiKey.trim();
    const chatModelValue = chatModel.trim();
    const wantsChat = Boolean(chatKey);
    if (wantsChat && (!chatBase || !chatModelValue)) {
      toast.error(t('settings.toast.chatConfigIncomplete'));
      return;
    }
    if (
      wantsChat &&
      chatProvider === DEFAULT_CHAT_PROVIDER &&
      chatModelValue.toLowerCase().startsWith('gemini') &&
      chatBase.includes('api.openai.com')
    ) {
      toast.error(t('settings.toast.openaiGeminiUnsupported'));
      return;
    }

    setLoading(true);
    try {
      await updateProviderConfig({
        provider_name: imageProvider,
        display_name: imageProvider,
        api_base: imageBase,
        api_key: imageKey,
        enabled: true,
        model_id: imageModelValue
      });

      if (wantsChat) {
        await updateProviderConfig({
          provider_name: chatProvider,
          display_name: chatProvider,
          api_base: chatBase,
          api_key: chatKey,
          enabled: false,
          model_id: chatModelValue
        });
        setChatSyncedConfig({ apiBaseUrl: chatBase, apiKey: chatKey, model: chatModelValue });
      } else {
        setChatSyncedConfig(null);
      }

      toast.success(t('settings.toast.saveSuccess'));
      onClose();
    } catch (error) {
      console.error('Save failed:', error);
      toast.error(t('settings.toast.saveFailed', { msg: t('settings.toast.checkNetwork') }));
    } finally {
      setLoading(false);
    }
  };

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value;
    setImageProvider(newProvider);

    // 切换 provider 时，如果后端有对应的配置，自动填入
    const config = providers.find(p => p.provider_name === newProvider);
    if (config) {
      setImageApiBaseUrl(config.api_base);
      setImageApiKey(config.api_key);
      const modelFromConfig = getDefaultModelId(config.models);
      if (modelFromConfig) {
        setImageModel(modelFromConfig);
      }
    }
  };

  const handleLanguageChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextLanguage = e.target.value;
    if (nextLanguage === 'system') {
      setLanguage('system');
      const systemLocale = await getSystemLocale();
      const resolved = resolveSystemLanguage(systemLocale);
      setLanguageResolved(resolved);
      if (i18n.language !== resolved) {
        void i18n.changeLanguage(resolved);
      }
      return;
    }

    setLanguage(nextLanguage);
    if (languageResolved) {
      setLanguageResolved(null);
    }
    if (i18n.language !== nextLanguage) {
      void i18n.changeLanguage(nextLanguage);
    }
  };

  const handleChatProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value;
    setChatProvider(newProvider);

    const config = providers.find(p => p.provider_name === newProvider);
    if (config) {
      setChatApiBaseUrl(config.api_base);
      setChatApiKey(config.api_key);
      const modelFromConfig = getDefaultModelId(config.models);
      if (modelFromConfig) {
        setChatModel(modelFromConfig);
      }
      setChatSyncedConfig({
        apiBaseUrl: config.api_base || '',
        apiKey: config.api_key || '',
        model: modelFromConfig || ''
      });
    } else {
      const defaults = getChatProviderDefaults(newProvider);
      setChatApiBaseUrl(defaults.baseUrl);
      setChatApiKey('');
      setChatModel(defaults.model);
      setChatSyncedConfig(null);
    }
  };

  const tabClass = (tab: SettingsTab) => {
    const isActive = activeTab === tab;
    return [
      'w-full flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold transition-all',
      isActive ? 'bg-slate-900 text-white shadow-sm' : 'bg-white/70 text-slate-600 hover:bg-white'
    ].join(' ');
  };

  const menuItems = [
    { id: 'language' as const, label: t('settings.language.label'), icon: Languages },
    { id: 'image' as const, label: t('settings.tabs.image'), icon: Box },
    { id: 'chat' as const, label: t('settings.tabs.chat'), icon: MessageSquare }
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('settings.title')}
      className="max-w-4xl h-[78vh]"
      density="compact"
      contentScrollable={false}
      contentClassName="h-full min-h-0"
    >
      <div className="relative h-full min-h-0">
        <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-8 h-full min-h-0">
          <div className="space-y-2">
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={tabClass(item.id)}
                  aria-pressed={activeTab === item.id}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-6 min-w-0 h-full min-h-0 relative">
            {fetching && (
              <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center rounded-3xl backdrop-blur-[1px]">
                <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
              </div>
            )}
            <div className="space-y-5 flex-1 min-h-0 overflow-y-auto pr-2">
              {activeTab === 'language' && (
                <div className="space-y-3">
                  <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
                    <Languages className="w-4 h-4 text-blue-600" />
                    {t('settings.language.label')}
                  </label>
                  <Select
                    value={language || i18n.language}
                    onChange={handleLanguageChange}
                    className="h-10 bg-slate-100 text-slate-900 font-bold rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
                  >
                    <option value="system">{t('language.system')}</option>
                    <option value="zh-CN">{t('language.zhCN')}</option>
                    <option value="en-US">{t('language.enUS')}</option>
                    <option value="ja-JP">{t('language.jaJP')}</option>
                    <option value="ko-KR">{t('language.koKR')}</option>
                  </Select>
                  <p className="text-xs text-slate-500 px-1">
                    {t('settings.language.hint')}
                  </p>
                </div>
              )}

              {activeTab === 'image' && (
                <>
            {/* Provider Selection */}
            <div className="space-y-3">
              <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
                <Box className="w-4 h-4 text-blue-600" />
                {t('settings.provider.label')}
              </label>
              <Select
                value={imageProvider}
                onChange={handleProviderChange}
                className="h-10 bg-slate-100 text-slate-900 font-bold rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
              >
                <option value="gemini">Gemini(/v1beta)</option>
                <option value="openai">OpenAI(/v1)</option>
                {/* 后续可扩展更多 provider */}
              </Select>
            </div>

            {/* API Base URL */}
            <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-600" />
                Base URL
              </label>
              <span className="text-xs text-slate-500">
                {t('settings.provider.recommended')}
                <a
                  href="https://yunwu.ai/register?aff=i4hh"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:text-blue-700 underline underline-offset-2"
                >
                  {t('settings.provider.yunwu')}
                </a>
              </span>
            </div>
              <Input
                type="text"
                value={imageApiBaseUrl || ''}
                onChange={(e) => setImageApiBaseUrl(e.target.value)}
                placeholder="https://generativelanguage.googleapis.com"
                className="h-10 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
              />
              {imageProvider === 'openai' && (
                <p className="text-xs text-red-500 px-1">{t('settings.provider.openaiImageLimit')}</p>
              )}
            </div>

            {/* API Key */}
            <div className="space-y-3">
              <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
                <Key className="w-4 h-4 text-blue-600" />
                API Key
              </label>
              <div className="relative">
                <Input
                  type={showImageKey ? 'text' : 'password'}
                  value={imageApiKey || ''}
                  onChange={(e) => setImageApiKey(e.target.value)}
                  placeholder="sk-******************"
                  className="h-10 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 pr-14 focus:bg-white border border-slate-200 transition-all shadow-none"
                />
                <button
                  type="button"
                  onClick={() => setShowImageKey(!showImageKey)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-blue-600 transition-colors bg-white/80 rounded-xl shadow-sm"
                >
                  {showImageKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Model Name */}
            <div className="space-y-3">
              <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
                <Box className="w-4 h-4 text-blue-600" />
                {t('settings.model.default')}
              </label>
              <Input
                type="text"
                value={imageModel}
                onChange={(e) => setImageModel(e.target.value)}
                className="h-10 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
              />
            </div>
                </>
              )}

              {activeTab === 'chat' && (
                <>
            {/* Provider Selection */}
            <div className="space-y-3">
              <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
                <Box className="w-4 h-4 text-blue-600" />
                {t('settings.provider.label')}
              </label>
              <Select
                value={chatProvider}
                onChange={handleChatProviderChange}
                className="h-10 bg-slate-100 text-slate-900 font-bold rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
              >
                {CHAT_PROVIDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            {/* API Base URL */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-600" />
                  Base URL
                </label>
                <span className="text-xs text-slate-500">
                  {t('settings.provider.recommended')}
                  <a
                    href="https://yunwu.ai/register?aff=i4hh"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:text-blue-700 underline underline-offset-2"
                  >
                    {t('settings.provider.yunwu')}
                  </a>
                </span>
              </div>
              <Input
                type="text"
                value={chatApiBaseUrl || ''}
                onChange={(e) => setChatApiBaseUrl(e.target.value)}
                placeholder={
                  chatProvider === 'gemini-chat'
                    ? 'https://generativelanguage.googleapis.com'
                    : 'https://api.openai.com/v1'
                }
                className="h-10 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
              />
            </div>

            {/* API Key */}
            <div className="space-y-3">
              <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
                <Key className="w-4 h-4 text-blue-600" />
                API Key
              </label>
              <div className="relative">
                <Input
                  type={showChatKey ? 'text' : 'password'}
                  value={chatApiKey || ''}
                  onChange={(e) => setChatApiKey(e.target.value)}
                  placeholder="sk-******************"
                  className="h-10 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 pr-14 focus:bg-white border border-slate-200 transition-all shadow-none"
                />
                <button
                  type="button"
                  onClick={() => setShowChatKey(!showChatKey)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-blue-600 transition-colors bg-white/80 rounded-xl shadow-sm"
                >
                  {showChatKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Chat Model */}
            <div className="space-y-3">
              <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
                <Box className="w-4 h-4 text-blue-600" />
                {t('settings.model.chat')}
              </label>
              <Input
                type="text"
                value={chatModel}
                onChange={(e) => setChatModel(e.target.value)}
                placeholder="gemini-3-flash-preview"
                className="h-10 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
              />
            </div>
                </>
              )}
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
                    <span>{t('settings.save')}</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
