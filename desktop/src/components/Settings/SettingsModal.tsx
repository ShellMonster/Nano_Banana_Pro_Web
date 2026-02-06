import React, { useState, useEffect, useMemo } from 'react';
import { Eye, EyeOff, Key, Globe, Box, Save, Loader2, FileText, FolderOpen, Copy, RefreshCw, Languages, MessageSquare, Github } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '../../store/configStore';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { getProviders, updateProviderConfig, ProviderConfig } from '../../services/providerApi';
import { toast } from '../../store/toastStore';
import { getDiagnosticVerbose, setDiagnosticVerbose } from '../../utils/diagnosticLogger';
import { useUpdaterStore } from '../../store/updaterStore';
import i18n, { DEFAULT_LANGUAGE } from '../../i18n';
import { getSystemLocale } from '../../i18n/systemLocale';
import appIcon from '../../assets/app-icon.png';

const CHAT_PROVIDER_OPTIONS = [
  { value: 'gemini-chat', label: 'Gemini(/v1beta)', defaultBase: 'https://generativelanguage.googleapis.com' },
  { value: 'openai-chat', label: 'OpenAI(/v1)', defaultBase: 'https://api.openai.com/v1' }
];
const DEFAULT_CHAT_PROVIDER = 'openai-chat';

type SettingsTab = 'language' | 'image' | 'chat' | 'update' | 'logs';

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

const isGeminiProvider = (provider: string) => {
  const normalized = String(provider || '').trim().toLowerCase();
  return normalized === 'gemini' || normalized === 'gemini-chat';
};

const hasGeminiBasePathWarning = (baseUrl: string) => {
  const raw = String(baseUrl || '').trim();
  if (!raw) return false;

  let pathname = '';
  try {
    pathname = new URL(raw).pathname.toLowerCase();
  } catch {
    const withoutOrigin = raw
      .replace(/^[a-z]+:\/\/[^/]+/i, '')
      .split(/[?#]/)[0]
      .toLowerCase();
    pathname = withoutOrigin;
  }

  const path = pathname.replace(/\/+$/, '');
  if (!path) return false;
  return (
    path === '/v1' ||
    path.startsWith('/v1/') ||
    path === '/v1beta' ||
    path.startsWith('/v1beta/') ||
    path.includes('/chat/completions') ||
    path.includes('/responses')
  );
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { t } = useTranslation();
  const {
    imageProvider, setImageProvider,
    imageApiKey, setImageApiKey,
    imageApiBaseUrl, setImageApiBaseUrl,
    imageModel, setImageModel,
    imageTimeoutSeconds, setImageTimeoutSeconds,
    chatProvider, setChatProvider,
    chatApiBaseUrl, setChatApiBaseUrl,
    chatApiKey, setChatApiKey,
    chatModel, setChatModel,
    chatTimeoutSeconds, setChatTimeoutSeconds,
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
  const imageBaseWarn = isGeminiProvider(imageProvider) && hasGeminiBasePathWarning(imageApiBaseUrl);
  const chatBaseWarn = isGeminiProvider(chatProvider) && hasGeminiBasePathWarning(chatApiBaseUrl);
  const [verboseLogs, setVerboseLogs] = useState(getDiagnosticVerbose());
  const [appVersion, setAppVersion] = useState('');
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const openUpdater = useUpdaterStore((s) => s.open);
  const update = useUpdaterStore((s) => s.update);
  const updaterStatus = useUpdaterStore((s) => s.status);
  const updaterError = useUpdaterStore((s) => s.error);
  const [updateHint, setUpdateHint] = useState<{ type: 'checking' | 'latest' | 'available' | 'error'; message: string } | null>(null);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const repoUrl = import.meta.env.VITE_GITHUB_REPO_URL || 'https://github.com/ShellMonster/Nano_Banana_Pro_Web';
  const normalizeTimeout = (value?: number | null, fallback = 150) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
    return Math.round(value);
  };
  const parseTimeoutInput = (value: string, fallback: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(5, Math.round(parsed));
  };

  // 当弹窗打开时，从后端获取最新的配置
  useEffect(() => {
    if (isOpen) {
      setActiveTab('image');
      setShowImageKey(false);
      setShowChatKey(false);
      fetchConfigs();
      setUpdateHint(null);
    }
  }, [isOpen]);

  useEffect(() => {
    let canceled = false;
    const loadVersion = async () => {
      try {
        if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
          const { getVersion } = await import('@tauri-apps/api/app');
          const v = await getVersion();
          if (!canceled) setAppVersion(v);
          return;
        }
      } catch {}

      if (!canceled) setAppVersion(import.meta.env.DEV ? 'dev' : '');
    };

    loadVersion();
    return () => {
      canceled = true;
    };
  }, []);

  const updateHintStyle = useMemo(() => {
    if (!updateHint) return 'text-slate-500';
    if (updateHint.type === 'checking') return 'text-blue-600';
    if (updateHint.type === 'available') return 'text-amber-600';
    if (updateHint.type === 'error') return 'text-red-600';
    return 'text-emerald-600';
  }, [updateHint]);

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
        setImageTimeoutSeconds(normalizeTimeout(imageConfig.timeout_seconds, 500));
      } else {
        setImageTimeoutSeconds(500);
      }

      const chatConfig = data.find((p) => p.provider_name === chatProvider);
      if (chatConfig) {
        setChatApiBaseUrl(chatConfig.api_base);
        setChatApiKey(chatConfig.api_key);
        const modelFromConfig = getDefaultModelId(chatConfig.models);
        if (modelFromConfig) {
          setChatModel(modelFromConfig);
        }
        setChatTimeoutSeconds(normalizeTimeout(chatConfig.timeout_seconds));
        setChatSyncedConfig({
          apiBaseUrl: chatConfig.api_base || '',
          apiKey: chatConfig.api_key || '',
          model: modelFromConfig || '',
          timeoutSeconds: normalizeTimeout(chatConfig.timeout_seconds)
        });
      } else {
        const defaults = getChatProviderDefaults(chatProvider);
        setChatApiBaseUrl(defaults.baseUrl);
        setChatModel(defaults.model);
        setChatTimeoutSeconds(150);
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
    const imageTimeoutValue = normalizeTimeout(imageTimeoutSeconds, 500);
    if (!imageBase || !imageKey || !imageModelValue) {
      toast.error(t('settings.toast.imageConfigIncomplete'));
      return;
    }

    const chatBase = chatApiBaseUrl.trim();
    const chatKey = chatApiKey.trim();
    const chatModelValue = chatModel.trim();
    const chatTimeoutValue = normalizeTimeout(chatTimeoutSeconds);
    const wantsChat = Boolean(chatKey);
    const imageSaveWarn = isGeminiProvider(imageProvider) && hasGeminiBasePathWarning(imageBase);
    const chatSaveWarn = wantsChat && isGeminiProvider(chatProvider) && hasGeminiBasePathWarning(chatBase);
    if (wantsChat && (!chatBase || !chatModelValue)) {
      toast.error(t('settings.toast.chatConfigIncomplete'));
      return;
    }
    if (imageSaveWarn || chatSaveWarn) {
      toast.warning(t('settings.toast.geminiBasePathWarning'));
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
        model_id: imageModelValue,
        timeout_seconds: imageTimeoutValue
      });

      if (wantsChat) {
        await updateProviderConfig({
          provider_name: chatProvider,
          display_name: chatProvider,
          api_base: chatBase,
          api_key: chatKey,
          enabled: false,
          model_id: chatModelValue,
          timeout_seconds: chatTimeoutValue
        });
        setChatSyncedConfig({ apiBaseUrl: chatBase, apiKey: chatKey, model: chatModelValue, timeoutSeconds: chatTimeoutValue });
      } else {
        setChatSyncedConfig(null);
      }

      toast.success(t('settings.toast.saveSuccess'));
      onClose();
    } catch (error: any) {
      console.error('Save failed:', error);
      const msg = error.response?.data?.message || error.message || t('settings.toast.checkNetwork');
      toast.error(t('settings.toast.saveFailed', { msg }));
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
      setImageTimeoutSeconds(normalizeTimeout(config.timeout_seconds, 500));
    } else {
      setImageTimeoutSeconds(500);
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
      setChatTimeoutSeconds(normalizeTimeout(config.timeout_seconds));
      setChatSyncedConfig({
        apiBaseUrl: config.api_base || '',
        apiKey: config.api_key || '',
        model: modelFromConfig || '',
        timeoutSeconds: normalizeTimeout(config.timeout_seconds)
      });
    } else {
      const defaults = getChatProviderDefaults(newProvider);
      setChatApiBaseUrl(defaults.baseUrl);
      setChatApiKey('');
      setChatModel(defaults.model);
      setChatTimeoutSeconds(150);
      setChatSyncedConfig(null);
    }
  };

  const getLogDir = async () => {
    const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
    if (!isTauri) return '';
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('get_log_dir');
  };

  const copyText = async (text: string) => {
    if (!text) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const handleOpenLogDir = async () => {
    try {
      const dir = await getLogDir();
      if (!dir) {
        toast.info(t('settings.toast.logDirDesktopOnly'));
        return;
      }
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('open_log_dir');
        return;
      } catch (err) {
        console.warn('open_log_dir failed:', err);
      }
      try {
        const { openPath } = await import('@tauri-apps/plugin-opener');
        await openPath(dir);
        return;
      } catch (err) {
        console.warn('openPath failed:', err);
      }

      try {
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(dir);
        return;
      } catch (err) {
        console.warn('shell open failed:', err);
      }

      toast.error(t('settings.toast.logDirOpenFailed'));
    } catch (err) {
      console.error('Open log folder failed:', err);
      toast.error(t('settings.toast.logDirOpenFailed'));
    }
  };

  const handleCopyLogDir = async () => {
    try {
      const dir = await getLogDir();
      if (!dir) {
        toast.info(t('settings.toast.logDirDesktopOnly'));
        return;
      }
      const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
      if (isTauri) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('copy_text_to_clipboard', { text: dir });
          toast.success(t('settings.toast.logDirCopied'));
          return;
        } catch (err) {
          console.warn('tauri clipboard failed:', err);
        }
      }

      const ok = await copyText(dir);
      if (ok) toast.success(t('settings.toast.logDirCopied'));
      else toast.error(t('settings.toast.logDirCopyFailedManual'));
    } catch (err) {
      console.error('Copy log path failed:', err);
      toast.error(t('settings.toast.logDirCopyFailed'));
    }
  };

  const handleToggleVerboseLogs = (next: boolean) => {
    setVerboseLogs(next);
    setDiagnosticVerbose(next);
    toast.success(next ? t('settings.toast.verboseEnabled') : t('settings.toast.verboseDisabled'));
  };

  const handleOpenYunwu = async () => {
    const url = 'https://yunwu.ai/register?aff=i4hh';
    try {
      const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
      if (isTauri) {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('Open Yunwu link failed:', err);
      toast.error(t('settings.toast.openLinkFailed'));
    }
  };

  const handleOpenRepo = async () => {
    if (!repoUrl) return;
    try {
      const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
      if (isTauri) {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(repoUrl);
        return;
      }
      window.open(repoUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('Open repo failed:', err);
      toast.error(t('settings.toast.openLinkFailed'));
    }
  };

  const handleCheckUpdates = async () => {
    if (isCheckingUpdates) return;
    const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
    if (!isTauri) {
      setUpdateHint({ type: 'error', message: t('settings.update.desktopOnly') });
      return;
    }

    setIsCheckingUpdates(true);
    setUpdateHint({ type: 'checking', message: t('settings.update.checking') });

    try {
      await checkForUpdates({ silent: true, openIfAvailable: false });
    } catch {}

    const latest = useUpdaterStore.getState();
    if (latest.status === 'available' && latest.update) {
      setUpdateHint({ type: 'available', message: t('settings.update.available', { version: latest.update.version }) });
    } else if (latest.status === 'error') {
      const msg = latest.error
        ? t('settings.update.failedWith', { error: latest.error })
        : t('settings.update.failed');
      setUpdateHint({ type: 'error', message: msg });
    } else {
      setUpdateHint({ type: 'latest', message: t('settings.update.latest') });
    }

    setIsCheckingUpdates(false);
  };

  const handleOpenUpdater = () => {
    openUpdater();
    onClose();
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
    { id: 'chat' as const, label: t('settings.tabs.chat'), icon: MessageSquare },
    { id: 'update' as const, label: t('settings.update.title'), icon: RefreshCw },
    { id: 'logs' as const, label: t('settings.logs.title'), icon: FileText }
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
                <button
                  type="button"
                  onClick={handleOpenYunwu}
                  className="text-blue-600 hover:text-blue-700 underline underline-offset-2"
                >
                  {t('settings.provider.yunwu')}
                </button>
              </span>
            </div>
              <Input
                type="text"
                value={imageApiBaseUrl || ''}
                onChange={(e) => setImageApiBaseUrl(e.target.value)}
                placeholder="https://generativelanguage.googleapis.com"
                className="h-10 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
              />
              {imageBaseWarn && (
                <p className="text-xs text-amber-600 px-1">{t('settings.provider.geminiBasePathHint')}</p>
              )}
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

            {/* Timeout */}
            <div className="space-y-3">
              <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
                <Box className="w-4 h-4 text-blue-600" />
                {t('settings.timeout.image')}
              </label>
              <Input
                type="number"
                min={5}
                step={1}
                value={imageTimeoutSeconds}
                onChange={(e) => setImageTimeoutSeconds(parseTimeoutInput(e.target.value, imageTimeoutSeconds))}
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
                  <button
                    type="button"
                    onClick={handleOpenYunwu}
                    className="text-blue-600 hover:text-blue-700 underline underline-offset-2"
                  >
                    {t('settings.provider.yunwu')}
                  </button>
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
              {chatBaseWarn && (
                <p className="text-xs text-amber-600 px-1">{t('settings.provider.geminiBasePathHint')}</p>
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

            {/* Timeout */}
            <div className="space-y-3">
              <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
                <Box className="w-4 h-4 text-blue-600" />
                {t('settings.timeout.chat')}
              </label>
              <Input
                type="number"
                min={5}
                step={1}
                value={chatTimeoutSeconds}
                onChange={(e) => setChatTimeoutSeconds(parseTimeoutInput(e.target.value, chatTimeoutSeconds))}
                className="h-10 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
              />
            </div>
                </>
              )}

              {activeTab === 'update' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded-2xl bg-white/70 border border-slate-200/60 p-3">
                    <div className="w-12 h-12 rounded-2xl overflow-hidden bg-white/80 border border-slate-200/60 shadow-lg shadow-blue-200">
                      <img src={appIcon} alt={t('app.title')} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">{t('app.title')}</span>
                        <span className="text-xs font-semibold text-slate-500 font-mono">v{appVersion || '-'}</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleOpenRepo}
                        className="mt-1 inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 hover:underline underline-offset-2 max-w-full"
                      >
                        <Github className="w-3.5 h-3.5" />
                        <span className="truncate">{repoUrl}</span>
                      </button>
                    </div>
                  </div>
                  <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
                    <RefreshCw className="w-4 h-4 text-blue-600" />
                    {t('settings.update.title')}
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleCheckUpdates}
                    className="w-full h-10 rounded-2xl"
                    disabled={isCheckingUpdates}
                  >
                    {isCheckingUpdates ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    {isCheckingUpdates ? t('settings.update.checkingShort') : t('settings.update.check')}
                  </Button>
                  {updateHint && (
                    <div className={`text-xs font-semibold px-1 flex items-center gap-2 ${updateHintStyle}`}>
                      <span>{updateHint.message}</span>
                      {updateHint.type === 'available' && (
                        <button
                          type="button"
                          onClick={handleOpenUpdater}
                          className="underline underline-offset-2 text-amber-700 hover:text-amber-800"
                        >
                          {t('settings.update.view')}
                        </button>
                      )}
                    </div>
                  )}
                  {!updateHint && updaterStatus === 'available' && update && (
                    <div className="text-xs font-semibold px-1 flex items-center gap-2 text-amber-600">
                      <span>{t('settings.update.available', { version: update.version })}</span>
                      <button
                        type="button"
                        onClick={handleOpenUpdater}
                        className="underline underline-offset-2 text-amber-700 hover:text-amber-800"
                      >
                        {t('settings.update.view')}
                      </button>
                    </div>
                  )}
                  {!updateHint && updaterStatus === 'error' && updaterError && (
                    <div className="text-xs font-semibold px-1 text-red-600">
                      {t('settings.update.failedWith', { error: updaterError })}
                    </div>
                  )}
                  <p className="text-xs text-slate-500 leading-relaxed px-1">
                    {t('settings.update.autoNote')}
                  </p>
                </div>
              )}

              {activeTab === 'logs' && (
                <div className="space-y-3">
                  <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
                    <FileText className="w-4 h-4 text-blue-600" />
                    {t('settings.logs.title')}
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleOpenLogDir}
                      className="flex-1 h-10 rounded-2xl"
                    >
                      <FolderOpen className="w-4 h-4 mr-2" />
                      {t('settings.logs.openDir')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleCopyLogDir}
                      className="h-10 rounded-2xl"
                      title={t('settings.logs.copyDirTitle')}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600 select-none">
                    <input
                      type="checkbox"
                      checked={verboseLogs}
                      onChange={(e) => handleToggleVerboseLogs(e.target.checked)}
                      className="accent-blue-600"
                    />
                    <span>{t('settings.logs.verboseLabel')}</span>
                  </label>
                  <p className="text-xs text-slate-500 leading-relaxed px-1">
                    {t('settings.logs.help')}
                  </p>
                </div>
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
