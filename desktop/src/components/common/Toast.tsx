import React from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useToastStore, ToastType } from '../../store/toastStore';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from './Button';

const iconMap: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 text-green-500" />,
  error: <AlertCircle className="w-4 h-4 text-red-500" />,
  info: <Info className="w-4 h-4 text-blue-500" />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-500" />,
};

const bgMap: Record<ToastType, string> = {
  success: 'bg-white border-green-200 ring-1 ring-green-100/50',
  error: 'bg-white border-red-200 ring-1 ring-red-100/50',
  info: 'bg-white border-blue-200 ring-1 ring-blue-100/50',
  warning: 'bg-white border-amber-200 ring-1 ring-amber-100/50',
};

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore(
    useShallow((s) => ({
      toasts: s.toasts,
      removeToast: s.removeToast
    }))
  );

  // 使用 createPortal 渲染到 body，确保 Toast 始终在最顶层
  // z-index 使用 2147483647（32位有符号整数最大值），确保不会被任何元素遮挡
  return createPortal(
    <div className="fixed top-28 left-1/2 -translate-x-1/2 z-[2147483647] flex flex-col gap-3 pointer-events-none w-full max-w-xs px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl border bg-white shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] animate-in fade-in slide-in-from-top-4 duration-300",
            bgMap[t.type]
          )}
        >
          <div className="flex-shrink-0">{iconMap[t.type]}</div>
          <p className="flex-1 text-[13px] font-bold text-slate-800 leading-tight tracking-tight">
            {t.message}
          </p>
          <button
            onClick={() => removeToast(t.id)}
            className="text-slate-300 hover:text-slate-600 transition-colors p-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
