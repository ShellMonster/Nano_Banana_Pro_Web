import React, { useState, useEffect, useMemo } from 'react';
import { Eye, EyeOff, Key, Globe, Box, Save, Loader2, FileText, FolderOpen, Copy, RefreshCw } from 'lucide-react';
import { useConfigStore } from '../../store/configStore';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { getProviders, updateProviderConfig, ProviderConfig } from '../../services/providerApi';
import { toast } from '../../store/toastStore';
import { getDiagnosticVerbose, setDiagnosticVerbose } from '../../utils/diagnosticLogger';
import { useUpdaterStore } from '../../store/updaterStore';

const CHAT_PROVIDER_NAME = 'openai-chat';

type SettingsTab = 'image' | 'chat';

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

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const {
    imageProvider, setImageProvider,
    imageApiKey, setImageApiKey,
    imageApiBaseUrl, setImageApiBaseUrl,
    imageModel, setImageModel,
    chatApiBaseUrl, setChatApiBaseUrl,
    chatApiKey, setChatApiKey,
    chatModel, setChatModel
  } = useConfigStore();

  const [activeTab, setActiveTab] = useState<SettingsTab>('image');
  const [showImageKey, setShowImageKey] = useState(false);
  const [showChatKey, setShowChatKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [fetching, setFetching] = useState(false);
  const [verboseLogs, setVerboseLogs] = useState(getDiagnosticVerbose());
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const openUpdater = useUpdaterStore((s) => s.open);
  const update = useUpdaterStore((s) => s.update);
  const updaterStatus = useUpdaterStore((s) => s.status);
  const updaterError = useUpdaterStore((s) => s.error);
  const [updateHint, setUpdateHint] = useState<{ type: 'checking' | 'latest' | 'available' | 'error'; message: string } | null>(null);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);

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
      }

      const chatConfig = data.find((p) => p.provider_name === CHAT_PROVIDER_NAME);
      if (chatConfig) {
        setChatApiBaseUrl(chatConfig.api_base);
        setChatApiKey(chatConfig.api_key);
        const modelFromConfig = getDefaultModelId(chatConfig.models);
        if (modelFromConfig) {
          setChatModel(modelFromConfig);
        }
      }
    } catch (error) {
      console.error('获取配置失败:', error);
      toast.error('获取后端配置失败');
    } finally {
      setFetching(false);
    }
  };

  const handleSave = async () => {
    const imageBase = imageApiBaseUrl.trim();
    const imageKey = imageApiKey.trim();
    const imageModelValue = imageModel.trim();
    if (!imageBase || !imageKey || !imageModelValue) {
      toast.error('请先完整配置生图模型');
      return;
    }

    const chatBase = chatApiBaseUrl.trim();
    const chatKey = chatApiKey.trim();
    const chatModelValue = chatModel.trim();
    const wantsChat = Boolean(chatKey);
    if (wantsChat && (!chatBase || !chatModelValue)) {
      toast.error('请完整配置对话模型');
      return;
    }
    if (wantsChat && chatModelValue.toLowerCase().startsWith('gemini') && chatBase.includes('api.openai.com')) {
      toast.error('OpenAI 官方 Base URL 不支持 Gemini 模型，请更换兼容接口');
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
          provider_name: CHAT_PROVIDER_NAME,
          display_name: CHAT_PROVIDER_NAME,
          api_base: chatBase,
          api_key: chatKey,
          enabled: false,
          model_id: chatModelValue
        });
      }

      toast.success('配置已成功同步到服务器');
      onClose();
    } catch (error: any) {
      console.error('保存失败:', error);
      const msg = error.response?.data?.message || error.message || '请检查网络';
      toast.error(`保存失败: ${msg}`);
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
        toast.info('日志目录仅在桌面端可用');
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

      toast.error('打开日志目录失败');
    } catch (err) {
      console.error('打开日志目录失败:', err);
      toast.error('打开日志目录失败');
    }
  };

  const handleCopyLogDir = async () => {
    try {
      const dir = await getLogDir();
      if (!dir) {
        toast.info('日志目录仅在桌面端可用');
        return;
      }
      const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
      if (isTauri) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('copy_text_to_clipboard', { text: dir });
          toast.success('日志路径已复制');
          return;
        } catch (err) {
          console.warn('tauri clipboard failed:', err);
        }
      }

      const ok = await copyText(dir);
      if (ok) toast.success('日志路径已复制');
      else toast.error('复制失败，请手动打开日志目录');
    } catch (err) {
      console.error('复制日志路径失败:', err);
      toast.error('复制日志路径失败');
    }
  };

  const handleToggleVerboseLogs = (next: boolean) => {
    setVerboseLogs(next);
    setDiagnosticVerbose(next);
    toast.success(next ? '已启用详细日志' : '已关闭详细日志');
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
      console.error('打开云雾API链接失败:', err);
      toast.error('打开链接失败');
    }
  };

  const handleCheckUpdates = async () => {
    if (isCheckingUpdates) return;
    const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
    if (!isTauri) {
      setUpdateHint({ type: 'error', message: '仅桌面端可用' });
      return;
    }

    setIsCheckingUpdates(true);
    setUpdateHint({ type: 'checking', message: '正在检查更新...' });

    try {
      await checkForUpdates({ silent: true, openIfAvailable: false });
    } catch {}

    const latest = useUpdaterStore.getState();
    if (latest.status === 'available' && latest.update) {
      setUpdateHint({ type: 'available', message: `发现新版本 v${latest.update.version}` });
    } else if (latest.status === 'error') {
      const msg = latest.error ? `检查失败：${latest.error}` : '检查失败';
      setUpdateHint({ type: 'error', message: msg });
    } else {
      setUpdateHint({ type: 'latest', message: '已是最新版本' });
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
      'rounded-full px-3 py-1.5 text-xs font-semibold transition-all',
      isActive ? 'bg-slate-900 text-white shadow-sm' : 'bg-white/70 text-slate-600 hover:bg-white'
    ].join(' ');
  };

  const headerActions = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setActiveTab('image')}
        className={tabClass('image')}
        aria-pressed={activeTab === 'image'}
      >
        生图模型
      </button>
      <button
        type="button"
        onClick={() => setActiveTab('chat')}
        className={tabClass('chat')}
        aria-pressed={activeTab === 'chat'}
      >
        对话模型
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="系统设置"
      headerActions={headerActions}
      className="max-w-sm"
      density="compact"
    >
      <div className="space-y-5 relative">
        {fetching && (
          <div className="absolute inset-0 bg-white/50 z-10 flex items-center justify-center rounded-2xl backdrop-blur-[1px]">
            <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
          </div>
        )}

        {activeTab === 'image' ? (
          <>
            {/* Provider Selection */}
            <div className="space-y-3">
              <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
                <Box className="w-4 h-4 text-blue-600" />
                AI对接方式
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
                推荐平台：
                <button
                  type="button"
                  onClick={handleOpenYunwu}
                  className="text-blue-600 hover:text-blue-700 underline underline-offset-2"
                >
                  云雾API
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
              {imageProvider === 'openai' && (
                <p className="text-xs text-red-500 px-1">OpenAI 类型当前仅支持生成 1K 图片</p>
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
                默认模型
              </label>
              <Input
                type="text"
                value={imageModel}
                onChange={(e) => setImageModel(e.target.value)}
                className="h-10 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
              />
            </div>
          </>
        ) : (
          <>
            {/* API Base URL */}
            <div className="space-y-3">
              <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
                <Globe className="w-4 h-4 text-blue-600" />
                Base URL
              </label>
              <Input
                type="text"
                value={chatApiBaseUrl || ''}
                onChange={(e) => setChatApiBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
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
                对话模型
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

        {/* Updater */}
        <div className="space-y-3">
          <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
            <RefreshCw className="w-4 h-4 text-blue-600" />
            软件更新
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
            {isCheckingUpdates ? '检查中...' : '检查更新'}
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
                  查看更新
                </button>
              )}
            </div>
          )}
          {!updateHint && updaterStatus === 'available' && update && (
            <div className="text-xs font-semibold px-1 flex items-center gap-2 text-amber-600">
              <span>{`发现新版本 v${update.version}`}</span>
              <button
                type="button"
                onClick={handleOpenUpdater}
                className="underline underline-offset-2 text-amber-700 hover:text-amber-800"
              >
                查看更新
              </button>
            </div>
          )}
          {!updateHint && updaterStatus === 'error' && updaterError && (
            <div className="text-xs font-semibold px-1 text-red-600">
              {`检查失败：${updaterError}`}
            </div>
          )}
          <p className="text-xs text-slate-500 leading-relaxed px-1">
            开启应用会自动检查更新；如有新版本会弹窗提示，一键下载安装。
          </p>
        </div>

        {/* Diagnostic Logs */}
        <div className="space-y-3">
          <label className="text-[13px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2 px-1">
            <FileText className="w-4 h-4 text-blue-600" />
            诊断日志
          </label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleOpenLogDir}
              className="flex-1 h-10 rounded-2xl"
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              打开日志目录
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={handleCopyLogDir}
              className="h-10 rounded-2xl"
              title="复制日志目录路径"
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
            <span>启用详细日志（记录更多调试信息）</span>
          </label>
          <p className="text-xs text-slate-500 leading-relaxed px-1">
            遇到问题时，请将 <span className="font-mono">app.log</span> 和 <span className="font-mono">server.log</span> 提交给开发者（注意日志可能包含提示词等信息）。
          </p>
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
