import React, { useEffect, useRef, useState } from 'react';
import { FileJson, Loader2, MessageSquare, Redo2, Sparkles, Undo2 } from 'lucide-react';
import { useConfigStore } from '../../store/configStore';
import { usePromptHistoryStore } from '../../store/promptHistoryStore';
import { optimizePrompt } from '../../services/promptApi';
import { toast } from '../../store/toastStore';
import { useGenerateStore } from '../../store/generateStore';
import { useTranslation } from 'react-i18next';

const BACKEND_ERROR_MATCHES = {
  providerMissing: '\u672a\u627e\u5230\u6307\u5b9a\u7684 Provider',
  providerKeyMissing: 'Provider API Key \u672a\u914d\u7f6e',
  modelMissing: '\u672a\u627e\u5230\u53ef\u7528\u7684\u6a21\u578b',
  promptEmpty: 'prompt \u4e0d\u80fd\u4e3a\u7a7a'
};

export function PromptInput() {
  const { t } = useTranslation();
  const { prompt, setPrompt, chatProvider, chatApiBaseUrl, chatApiKey, chatModel, chatSyncedConfig } = useConfigStore();
  const { history, index, record, undo, redo, reset } = usePromptHistoryStore();
  const status = useGenerateStore((s) => s.status);
  const isSubmitting = useGenerateStore((s) => s.isSubmitting);
  const isGenerating = status === 'processing' || isSubmitting;
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizingMode, setOptimizingMode] = useState<'normal' | 'json' | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipRecordRef = useRef(false);
  const initializedRef = useRef(false);

  const canUndo = index > 0;
  const canRedo = index >= 0 && index < history.length - 1;
  const chatSignature = (base: string, key: string, model: string) =>
    `${base.trim()}::${key.trim()}::${model.trim()}`;

  useEffect(() => {
    if (!initializedRef.current) {
      reset(prompt);
      initializedRef.current = true;
      return;
    }
    if (history.length === 1 && history[0] === '' && prompt !== '') {
      reset(prompt);
    }
  }, [prompt, history, reset]);

  useEffect(() => {
    if (skipRecordRef.current) {
      skipRecordRef.current = false;
      return;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      record(prompt);
    }, 600);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [prompt, record]);

  const handleUndo = () => {
    const prev = undo();
    if (prev === null) return;
    skipRecordRef.current = true;
    setPrompt(prev);
  };

  const handleRedo = () => {
    const next = redo();
    if (next === null) return;
    skipRecordRef.current = true;
    setPrompt(next);
  };

  const formatJsonPrompt = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return value;
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
    try {
      const parsed = JSON.parse(candidate);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  };

  const runOptimize = async (mode: 'normal' | 'json') => {
    const raw = prompt.trim();
    if (!raw) {
      toast.error(t('prompt.toast.empty'));
      return;
    }
    const chatBase = chatApiBaseUrl.trim();
    const chatKey = chatApiKey.trim();
    const chatModelValue = chatModel.trim();
    if (!chatBase || !chatKey || !chatModelValue) {
      toast.error(t('prompt.toast.chatConfig'));
      return;
    }
    if (chatSyncedConfig) {
      const currentSignature = chatSignature(chatBase, chatKey, chatModelValue);
      const syncedSignature = chatSignature(chatSyncedConfig.apiBaseUrl, chatSyncedConfig.apiKey, chatSyncedConfig.model);
      if (currentSignature !== syncedSignature) {
        toast.error(t('prompt.toast.chatConfigChanged'));
        return;
      }
    }
    if (isOptimizing) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    record(prompt);
    setIsOptimizing(true);
    setOptimizingMode(mode);
    try {
      const res = await optimizePrompt({
        provider: chatProvider,
        model: chatModelValue,
        prompt: raw,
        response_format: mode === 'json' ? 'json' : undefined,
      });
      let nextPrompt = String(res?.prompt || '').trim();
      if (!nextPrompt) {
        toast.error(t('prompt.toast.optimizeEmpty'));
        return;
      }
      if (mode === 'json') {
        nextPrompt = formatJsonPrompt(nextPrompt);
      }
      record(nextPrompt);
      skipRecordRef.current = true;
      setPrompt(nextPrompt);
    } catch (error: any) {
      const status = error?.response?.status;
      const backendMessage = typeof error?.response?.data?.message === 'string' ? error.response.data.message : '';
      const fallbackMessage = error instanceof Error ? error.message : '';
      const rawMessage = backendMessage || fallbackMessage;
      const isAxiosStatusMessage = rawMessage.startsWith('Request failed with status code');

      let message = rawMessage || t('prompt.toast.optimizeFailed');
      if (status === 400) {
        if (message.includes(BACKEND_ERROR_MATCHES.providerMissing) || message.includes(BACKEND_ERROR_MATCHES.providerKeyMissing)) {
          message = t('prompt.toast.syncChatConfig');
        } else if (message.includes(BACKEND_ERROR_MATCHES.modelMissing)) {
          message = t('prompt.toast.chatModelMissing');
        } else if (message.includes(BACKEND_ERROR_MATCHES.promptEmpty)) {
          message = t('prompt.toast.empty');
        } else if (isAxiosStatusMessage) {
          message = t('prompt.toast.optimizeCheckConfig');
        }
      } else if (status === 401 || status === 403) {
        message = t('prompt.toast.apiKeyInvalid');
      } else if (status === 404) {
        message = t('prompt.toast.baseUrlInvalid');
      } else if (rawMessage.includes('timeout') || rawMessage.includes('context deadline exceeded')) {
        message = t('prompt.toast.timeout');
      } else if (isAxiosStatusMessage) {
        message = t('prompt.toast.optimizeRetry');
      }

      toast.error(message);
    } finally {
      setIsOptimizing(false);
      setOptimizingMode(null);
    }
  };

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center justify-between gap-3 flex-shrink-0">
        <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          {t('prompt.label')}
        </label>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => runOptimize('normal')}
            disabled={isOptimizing}
            title={t('prompt.optimize')}
            className={`p-1.5 rounded-lg transition-all ${
              isOptimizing
                ? 'opacity-50 cursor-not-allowed bg-slate-100'
                : 'bg-slate-100 text-slate-700 hover:bg-white'
            }`}
          >
            {isOptimizing && optimizingMode === 'normal' ? (
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            ) : (
              <Sparkles className="w-4 h-4 text-blue-600" />
            )}
          </button>
          <button
            type="button"
            onClick={() => runOptimize('json')}
            disabled={isOptimizing}
            title={t('prompt.optimizeJson')}
            className={`p-1.5 rounded-lg transition-all ${
              isOptimizing
                ? 'opacity-50 cursor-not-allowed bg-slate-100'
                : 'bg-slate-100 text-slate-700 hover:bg-white'
            }`}
          >
            {isOptimizing && optimizingMode === 'json' ? (
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            ) : (
              <FileJson className="w-4 h-4 text-blue-600" />
            )}
          </button>
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo || isOptimizing}
            title={t('prompt.undo')}
            className={`p-1.5 rounded-lg transition-all ${
              canUndo && !isOptimizing
                ? 'bg-slate-100 text-slate-700 hover:bg-white'
                : 'opacity-40 cursor-not-allowed bg-slate-100'
            }`}
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo || isOptimizing}
            title={t('prompt.redo')}
            className={`p-1.5 rounded-lg transition-all ${
              canRedo && !isOptimizing
                ? 'bg-slate-100 text-slate-700 hover:bg-white'
                : 'opacity-40 cursor-not-allowed bg-slate-100'
            }`}
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="relative flex-1">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('prompt.placeholder')}
          className="w-full h-full rounded-2xl border-none bg-slate-100 px-4 py-3 pt-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all duration-200 resize-none min-h-[80px]"
        />
      </div>
    </div>
  );
}
