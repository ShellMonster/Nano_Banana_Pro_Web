import React, { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare, Redo2, Sparkles, Undo2 } from 'lucide-react';
import { useConfigStore } from '../../store/configStore';
import { usePromptHistoryStore } from '../../store/promptHistoryStore';
import { optimizePrompt } from '../../services/promptApi';
import { toast } from '../../store/toastStore';
import { useGenerateStore } from '../../store/generateStore';

export function PromptInput() {
  const { prompt, setPrompt, textModel } = useConfigStore();
  const { history, index, record, undo, redo, reset } = usePromptHistoryStore();
  const status = useGenerateStore((s) => s.status);
  const isSubmitting = useGenerateStore((s) => s.isSubmitting);
  const isGenerating = status === 'processing' || isSubmitting;
  const [isOptimizing, setIsOptimizing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipRecordRef = useRef(false);
  const initializedRef = useRef(false);

  const canUndo = index > 0;
  const canRedo = index >= 0 && index < history.length - 1;

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

  const handleOptimize = async () => {
    const raw = prompt.trim();
    if (!raw) {
      toast.error('请输入提示词');
      return;
    }
    if (!textModel.trim()) {
      toast.error('请先在设置中配置文本模型');
      return;
    }
    if (isOptimizing) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    record(prompt);
    setIsOptimizing(true);
    try {
      const res = await optimizePrompt({ model: textModel.trim(), prompt: raw });
      const nextPrompt = String(res?.data?.prompt || '').trim();
      if (!nextPrompt) {
        toast.error('优化失败，未返回内容');
        return;
      }
      record(nextPrompt);
      skipRecordRef.current = true;
      setPrompt(nextPrompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : '优化失败';
      toast.error(message || '优化失败');
    } finally {
      setIsOptimizing(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center justify-between gap-2 flex-shrink-0">
        <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          提示词 (Prompt)
        </label>
        <button
          type="button"
          onClick={handleOptimize}
          disabled={isGenerating || isOptimizing}
          title="优化提示词"
          className={`p-2 rounded-lg transition-all ${
            isGenerating || isOptimizing
              ? 'opacity-50 cursor-not-allowed bg-slate-100'
              : 'bg-slate-100 text-slate-700 hover:bg-white'
          }`}
        >
          {isOptimizing ? (
            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
          ) : (
            <Sparkles className="w-4 h-4 text-blue-600" />
          )}
        </button>
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="描述你想要生成的图片..."
        className="flex-1 w-full rounded-2xl border-none bg-slate-100 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all duration-200 resize-none min-h-[80px]"
      />
      {!isGenerating && (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
            title="撤销"
            className={`p-2 rounded-lg transition-all ${
              canUndo ? 'bg-slate-100 text-slate-700 hover:bg-white' : 'opacity-40 cursor-not-allowed bg-slate-100'
            }`}
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo}
            title="重做"
            className={`p-2 rounded-lg transition-all ${
              canRedo ? 'bg-slate-100 text-slate-700 hover:bg-white' : 'opacity-40 cursor-not-allowed bg-slate-100'
            }`}
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
