import React, { useEffect, useRef, useState } from 'react';
import { FileJson, Loader2, MessageSquare, Redo2, Sparkles, Undo2 } from 'lucide-react';
import { useConfigStore } from '../../store/configStore';
import { usePromptHistoryStore } from '../../store/promptHistoryStore';
import { optimizePrompt } from '../../services/promptApi';
import { toast } from '../../store/toastStore';
import { useGenerateStore } from '../../store/generateStore';

export function PromptInput() {
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
      toast.error('请输入提示词');
      return;
    }
    const chatBase = chatApiBaseUrl.trim();
    const chatKey = chatApiKey.trim();
    const chatModelValue = chatModel.trim();
    if (!chatBase || !chatKey || !chatModelValue) {
      toast.error('请先在设置中配置对话模型');
      return;
    }
    if (chatSyncedConfig) {
      const currentSignature = chatSignature(chatBase, chatKey, chatModelValue);
      const syncedSignature = chatSignature(chatSyncedConfig.apiBaseUrl, chatSyncedConfig.apiKey, chatSyncedConfig.model);
      if (currentSignature !== syncedSignature) {
        toast.error('对话模型配置已修改，请先在设置中同步保存');
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
        toast.error('优化失败，未返回内容');
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

      let message = rawMessage || '优化失败';
      if (status === 400) {
        if (message.includes('未找到指定的 Provider') || message.includes('Provider API Key 未配置')) {
          message = '请先在设置中同步保存对话模型配置';
        } else if (message.includes('未找到可用的模型')) {
          message = '请先在设置中填写对话模型并同步保存';
        } else if (message.includes('prompt 不能为空')) {
          message = '请输入提示词';
        } else if (isAxiosStatusMessage) {
          message = '优化失败，请检查对话模型配置';
        }
      } else if (status === 401 || status === 403) {
        message = 'API Key 无效或权限不足';
      } else if (status === 404) {
        message = 'Base URL 不正确或接口未开启';
      } else if (rawMessage.includes('timeout') || rawMessage.includes('context deadline exceeded')) {
        message = '请求超时，请稍后重试';
      } else if (isAxiosStatusMessage) {
        message = '优化失败，请稍后重试';
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
          提示词 (Prompt)
        </label>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => runOptimize('normal')}
            disabled={isGenerating || isOptimizing}
            title="优化提示词"
            className={`p-1.5 rounded-lg transition-all ${
              isGenerating || isOptimizing
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
            disabled={isGenerating || isOptimizing}
            title="JSON提示词"
            className={`p-1.5 rounded-lg transition-all ${
              isGenerating || isOptimizing
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
          {!isGenerating && (
            <>
              <button
                type="button"
                onClick={handleUndo}
                disabled={!canUndo || isOptimizing}
                title="撤销"
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
                title="重做"
                className={`p-1.5 rounded-lg transition-all ${
                  canRedo && !isOptimizing
                    ? 'bg-slate-100 text-slate-700 hover:bg-white'
                    : 'opacity-40 cursor-not-allowed bg-slate-100'
                }`}
              >
                <Redo2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="relative flex-1">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述你想要生成的图片..."
          className="w-full h-full rounded-2xl border-none bg-slate-100 px-4 py-3 pt-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all duration-200 resize-none min-h-[80px]"
        />
      </div>
    </div>
  );
}
