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
    setProvider(newProvider);
    
    // 切换 provider 时，如果后端有对应的配置，自动填入
    const config = providers.find(p => p.provider_name === newProvider);
    if (config) {
      setApiBaseUrl(config.api_base);
      setApiKey(config.api_key);
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
      const { openPath } = await import('@tauri-apps/plugin-opener');
      await openPath(dir);
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

  return (
    <Modal 
        isOpen={isOpen} 
        onClose={onClose} 
        title="系统设置" 
        className="max-w-md"
    >
      <div className="space-y-8 relative">
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
            className="h-12 bg-slate-100 text-slate-900 font-bold rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
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
            className="h-12 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
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
              type={showKey ? 'text' : 'password'}
              value={apiKey || ''}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-******************"
              className="h-12 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 pr-14 focus:bg-white border border-slate-200 transition-all shadow-none"
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
            className="h-12 bg-slate-100 text-slate-900 font-medium rounded-2xl text-sm px-5 focus:bg-white border border-slate-200 transition-all shadow-none"
          />
        </div>

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
            className="w-full h-12 rounded-2xl"
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
              className="flex-1 h-12 rounded-2xl"
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              打开日志目录
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={handleCopyLogDir}
              className="h-12 rounded-2xl"
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

        <div className="pt-4">
            <Button 
                onClick={handleSave} 
                disabled={loading}
                className="w-full h-14 text-base bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black rounded-2xl shadow-xl shadow-blue-200/50 border-none transition-all duration-300"
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
