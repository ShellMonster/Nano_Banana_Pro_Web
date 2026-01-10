import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Check, AlertCircle, Loader2, Trash2, XCircle } from 'lucide-react';
import { GeneratedImage } from '../../types';
import { cn } from '../common/Button';
import { formatDateTime } from '../../utils/date';
import { useGenerateStore } from '../../store/generateStore';
import { useHistoryStore } from '../../store/historyStore';
import { toast } from '../../store/toastStore';
import { useInternalDragStore } from '../../store/internalDragStore';

interface ImageCardProps {
  image: GeneratedImage;
  selected: boolean;
  onSelect: (id: string) => void;
  onClick: (image: GeneratedImage) => void;
  elapsed?: string; // 从父组件传入
}

export const ImageCard = React.memo(function ImageCard({
  image,
  selected,
  onSelect,
  onClick,
  elapsed = '0.0'
}: ImageCardProps) {
  const isFailed = image.status === 'failed';
  const isPending = !isFailed && (image.status === 'pending' || !image.url);
  const isSuccess = image.status === 'success' && Boolean(image.url);
  const reserveSpaceForSelect = isPending || isSuccess;

  const [isDeleting, setIsDeleting] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const startDrag = useInternalDragStore((s) => s.startDrag);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }
    };
  }, []);

  const handleCancelConfirm = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirm(false);
  }, []);

  const handleDelete = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (showConfirm) {
      setIsDeleting(true);
      try {
        const isTemp = image.id.startsWith('temp-') || !image.taskId;
        if (!isTemp && image.taskId) {
          await useHistoryStore.getState().deleteImage(image.id, image.taskId);
        } else {
          toast.success('已从生成列表移除');
        }

        useGenerateStore.getState().removeImage(image.id);
        setIsDeleting(false);
        setShowConfirm(false);
      } catch (error) {
        console.error('删除图片失败:', error);
        setIsDeleting(false);
      }
    } else {
      setShowConfirm(true);
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
      }
      confirmTimerRef.current = setTimeout(() => setShowConfirm(false), 3000);
    }
  }, [showConfirm, image.id, image.taskId]);

  const handleClick = useCallback(() => {
    const lastDragEndAt = useInternalDragStore.getState().lastDragEndAt;
    if (Date.now() - lastDragEndAt < 200) return;
    if (isSuccess) {
      onClick(image);
    }
  }, [image, isSuccess, onClick]);

  const meta = useMemo(() => {
    const w = image.width || 0;
    const h = image.height || 0;

    const resolutionLabel = (() => {
      const max = Math.max(w, h);
      if (max >= 3840) return '4K';
      if (max >= 2048) return '2K';
      if (max >= 1024) return '1K';
      return max > 0 ? 'SD' : '—';
    })();

    const aspectRatioLabel = (() => {
      // 1) 优先使用 options 里的比例（与历史记录保持一致）
      try {
        const opts =
          typeof image.options === 'string'
            ? JSON.parse(image.options)
            : image.options;
        if (opts && typeof opts === 'object' && 'aspectRatio' in (opts as any)) {
          const ar = String((opts as any).aspectRatio || '').trim();
          if (ar) return ar;
        }
      } catch {}

      // 2) 回退到 width/height 推断比例（常见比例做归一化显示）
      if (w > 0 && h > 0) {
        const r = w / h;
        const close = (a: number, b: number) => Math.abs(a - b) < 0.1;
        if (close(r, 1)) return '1:1';
        if (close(r, 16 / 9)) return '16:9';
        if (close(r, 9 / 16)) return '9:16';
        if (close(r, 4 / 3)) return '4:3';
        if (close(r, 3 / 4)) return '3:4';

        // 最后兜底：约分显示（避免直接展示 1024:576 这种“分辨率感”太强的数字）
        const gcd = (a: number, b: number): number => {
          let x = Math.abs(a);
          let y = Math.abs(b);
          while (y) {
            const t = x % y;
            x = y;
            y = t;
          }
          return x || 1;
        };
        const g = gcd(w, h);
        return `${Math.round(w / g)}:${Math.round(h / g)}`;
      }

      return '—';
    })();

    const timeLabel = (() => {
      if (!image.createdAt) return '—';
      try {
        const d = new Date(image.createdAt);
        if (Number.isNaN(d.getTime())) return '—';
        return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch {
        return '—';
      }
    })();

    return { resolutionLabel, aspectRatioLabel, timeLabel };
  }, [image.width, image.height, image.createdAt, image.options]);

  // 使用 useMemo 优化规格信息解析
  const specs = useMemo(() => {
    try {
      if (image.options) {
        const opts = typeof image.options === 'string'
          ? JSON.parse(image.options)
          : image.options;
        return `${opts.aspectRatio || '1:1'} · ${opts.imageSize || '1K'}`;
      }
    } catch (e) {}
    // 如果是 pending 状态，尝试从 options 对象中获取（针对刚生成的占位符）
    if (isPending && (image as any).options) {
      const opts = (image as any).options;
      return `${opts.aspectRatio || '1:1'} · ${opts.imageSize || '1K'}`;
    }
    return '';
  }, [image.options, isPending]);

  // 使用 useMemo 优化规格标签解析
  const specParts = useMemo(() => {
    if (!specs) return ['1:1', '1K'];
    return specs.split(' · ');
  }, [specs]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!isSuccess || e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button')) return;

    const name = `ref-${image.id || 'unknown'}.jpg`;
    const url = image.url || image.thumbnailUrl || '';
    const thumbnailUrl = image.thumbnailUrl || image.url || '';
    const filePath = image.filePath || '';
    const thumbnailPath = image.thumbnailPath || '';
    const hasSource = Boolean(url || thumbnailUrl || filePath || thumbnailPath);
    if (!hasSource) return;

    const getBlob = () => new Promise<Blob | null>((resolve) => {
      const img = imgRef.current;
      if (!img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
        resolve(null);
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => resolve(blob || null), 'image/jpeg', 0.9);
      } catch {
        resolve(null);
      }
    });

    startDrag(
      {
        id: image.id,
        name,
        url,
        thumbnailUrl,
        filePath,
        thumbnailPath,
        getBlob
      },
      e.pointerId,
      e.clientX,
      e.clientY
    );
  }, [image.id, image.url, image.thumbnailUrl, image.filePath, image.thumbnailPath, isSuccess, startDrag]);

  return (
    <div
      className={cn(
        "group relative bg-white rounded-xl overflow-hidden border border-gray-100 shadow-sm transition-all duration-300 cursor-pointer flex flex-col",
        selected ? "ring-2 ring-blue-500 shadow-lg shadow-blue-100/50 scale-[0.98]" : "hover:shadow-md hover:-translate-y-0.5"
      )}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '240px 320px' }}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
    >
      {/* 图片/加载区域 - 统一正方形 */}
      <div className={cn(
        "relative w-full aspect-square overflow-hidden transition-colors duration-500",
        isPending ? "bg-blue-50/50" : "bg-slate-50"
      )}>
        {/* 删除按钮 - 纯 CSS hover，不依赖 JavaScript */}
        {!showConfirm && (
          <div
            className={cn(
              "absolute top-2 z-40 transition-opacity duration-100 ease-out opacity-0 group-hover:opacity-100 pointer-events-none",
              reserveSpaceForSelect ? "right-10" : "right-2"
            )}
          >
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className={cn(
                "rounded-full flex items-center justify-center shadow-lg transition-all duration-200 bg-red-500 hover:bg-red-600 text-white w-7 h-7 sm:w-8 sm:h-8 pointer-events-auto",
                isDeleting ? "opacity-50 cursor-not-allowed" : ""
              )}
              title="删除图片"
            >
              {isDeleting ? (
                <div className="w-3 h-3 sm:w-4 sm:h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Trash2 className="w-3 h-3 sm:w-4 sm:h-4" />
              )}
            </button>
          </div>
        )}

        {/* 确认删除 */}
        {showConfirm && (
          <div className="absolute top-2 right-2 z-40 flex items-center gap-2 pointer-events-none">
            <button
              onClick={handleCancelConfirm}
              className="bg-slate-500 text-white w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-600 transition-colors shadow-lg pointer-events-auto"
              title="取消"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className={cn(
                "rounded-full flex items-center justify-center shadow-lg transition-all duration-200 bg-red-600 text-white w-auto px-3 h-8 pointer-events-auto",
                isDeleting ? "opacity-50 cursor-not-allowed" : ""
              )}
              title="再次点击确认删除"
            >
              {isDeleting ? (
                <div className="w-3 h-3 sm:w-4 sm:h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <span className="text-xs font-bold">确认?</span>
              )}
            </button>
          </div>
        )}

        {isPending ? (
          <div className="w-full h-full flex flex-col items-center justify-center relative p-4 bg-blue-50/30">
            {/* 加载动画 - 强化版 */}
            <div className="relative mb-4 flex items-center justify-center">
              <div className="absolute w-16 h-16 bg-blue-500/10 rounded-full animate-ping" />
              <div className="absolute w-12 h-12 border-2 border-blue-100 rounded-full" />
              <div className="absolute w-12 h-12 border-t-2 border-blue-500 rounded-full animate-spin" />
              <Loader2 className="w-6 h-6 text-blue-500 animate-pulse relative z-10" />
            </div>

            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  <div className="w-1 h-1 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="w-1 h-1 bg-blue-600 rounded-full animate-bounce" />
                </div>
                <span className="text-sm font-bold text-blue-600 tracking-tight">生成中</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-100/50 rounded-full border border-blue-200/50">
                <span className="text-[10px] font-bold font-mono text-blue-500 tabular-nums">
                  {elapsed}s
                </span>
              </div>
            </div>

            {/* 选择框 (正在生成时也可以选择) */}
            {!showConfirm && (
              <div
                className="absolute top-2 right-2 z-30"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(image.id);
                }}
              >
                <div className={cn(
                  "w-5 h-5 rounded-full border-2 transition-all flex items-center justify-center",
                  selected
                    ? "bg-blue-500 border-blue-500 text-white"
                    : "bg-black/10 border-white/40 text-transparent hover:border-white"
                )}>
                  <Check className="w-3 h-3" />
                </div>
              </div>
            )}
          </div>
        ) : isSuccess ? (
          <div className="w-full h-full relative">
            <img
              ref={imgRef}
              src={image.thumbnailUrl || image.url}
              alt={image.prompt || '图片'}
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
              draggable={false}
            />
            
            {/* 渐变遮罩 - 仅在悬浮时显示更多信息 */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-300 pointer-events-none" />

            {/* 选择框 */}
            {!showConfirm && (
              <div
                className={cn(
                  "absolute top-2 right-2 z-30 transition-all duration-300",
                  selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(image.id);
                }}
              >
                <div className={cn(
                  "w-5 h-5 rounded-full border-2 transition-all flex items-center justify-center",
                  selected
                    ? "bg-blue-500 border-blue-500 text-white"
                    : "bg-black/10 border-white/40 text-transparent hover:border-white"
                )}>
                  <Check className="w-3 h-3" />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-red-50/50 p-4 transition-colors duration-500">
            <div className="relative mb-3">
              <div className="absolute inset-0 bg-red-500/10 rounded-full animate-pulse" />
              <XCircle className="w-10 h-10 text-red-400 relative z-10" />
            </div>
            <span className="text-sm font-bold text-red-500 tracking-tight">生成失败</span>
          </div>
        )}
      </div>

      {/* 信息区域 - 保持与历史区一致的样式 */}
      <div className="p-2 sm:p-3 flex flex-col gap-1.5 sm:gap-2 flex-shrink-0 bg-white">
        <p className="text-[10px] sm:text-xs text-gray-800 line-clamp-2 font-medium leading-relaxed h-8 sm:h-9" title={image.prompt}>
          {image.prompt || '无提示词'}
        </p>

        <div className="flex items-center justify-between text-[8px] sm:text-[9px] text-gray-400 pt-1 border-t border-gray-50 mt-auto">
          <span className="font-mono tabular-nums">
            <span className="sm:hidden">{meta.timeLabel}</span>
            <span className="hidden sm:inline">{formatDateTime(image.createdAt)}</span>
          </span>
          <div className="flex items-center gap-1">
            <span className="bg-blue-50 text-blue-600 px-1 py-0.5 rounded font-black tracking-tighter border border-blue-100/50">
              {meta.resolutionLabel}
            </span>
            <span className="bg-slate-100 text-slate-500 px-1 py-0.5 rounded font-bold tracking-tighter border border-slate-200/50">
              {meta.aspectRatioLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});
