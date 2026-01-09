import React, { useCallback, useMemo, useRef } from 'react';
import { Check, AlertCircle, Loader2, XCircle } from 'lucide-react';
import { GeneratedImage } from '../../types';
import { cn } from '../common/Button';

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
  const isPending = image.status === 'pending' || !image.url;
  const isSuccess = !isPending && image.status !== 'failed';
  const imgRef = useRef<HTMLImageElement>(null);

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

  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (!isSuccess) return;

    try {
      e.dataTransfer.effectAllowed = 'copy';

      const url = image.url || image.thumbnailUrl || '';
      const name = `ref-${image.id || 'unknown'}.jpg`;

      e.dataTransfer.setData('text/plain', url || '');
      if (url) {
        e.dataTransfer.setData('application/x-image-url', url);
        e.dataTransfer.setData('text/uri-list', url);
      }
      e.dataTransfer.setData('application/x-image-name', name);

      if (typeof window !== 'undefined') {
        const dragBlobSymbol = Symbol.for('__dragImageBlob');
        const img = imgRef.current;
        if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
          const createdAt = Date.now();
          const blobPromise = new Promise<Blob | null>((resolve) => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              const ctx = canvas.getContext('2d');
              if (!ctx) return resolve(null);
              ctx.drawImage(img, 0, 0);
              canvas.toBlob((blob) => resolve(blob || null), 'image/jpeg', 0.9);
            } catch {
              resolve(null);
            }
          });

          (window as any)[dragBlobSymbol] = {
            id: image.id,
            name,
            createdAt,
            blobPromise
          };
          e.dataTransfer.setData('application/x-has-blob', 'true');
        }
      }

      if (imgRef.current) {
        e.dataTransfer.setDragImage(imgRef.current, 40, 40);
      }
    } catch {}
  }, [isSuccess, image.id, image.url, image.thumbnailUrl]);

  const handleDragEnd = useCallback(() => {
    setTimeout(() => {
      const dragBlobSymbol = Symbol.for('__dragImageBlob');
      const cached = (window as any)?.[dragBlobSymbol];
      if (cached && cached.id === image.id) {
        delete (window as any)[dragBlobSymbol];
      }
    }, 100);
  }, [image.id]);

  return (
    <div
      className={cn(
        "group relative bg-white rounded-xl overflow-hidden border border-gray-100 shadow-sm transition-all duration-300 cursor-pointer flex flex-col",
        selected ? "ring-2 ring-blue-500 shadow-lg shadow-blue-100/50 scale-[0.98]" : "hover:shadow-md hover:-translate-y-0.5"
      )}
      onClick={() => !isPending && onClick(image)}
      draggable={isSuccess}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {/* 图片/加载区域 - 统一正方形 */}
      <div className={cn(
        "relative w-full aspect-square overflow-hidden transition-colors duration-500",
        isPending ? "bg-blue-50/50" : "bg-slate-50"
      )}>
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
                <span className="text-sm font-bold text-blue-600 tracking-tight">正在生成</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-100/50 rounded-full border border-blue-200/50">
                <span className="text-[10px] font-bold font-mono text-blue-500 tabular-nums">
                  {elapsed}s
                </span>
              </div>
            </div>

            {/* 选择框 (正在生成时也可以选择) */}
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
          </div>
        ) : image.status === 'success' ? (
          <div className="w-full h-full relative">
            <img
              ref={imgRef}
              src={image.thumbnailUrl || image.url}
              alt={image.prompt || '图片'}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            
            {/* 渐变遮罩 - 仅在悬浮时显示更多信息 */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-300" />

            {/* 选择框 */}
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
          <div className="flex items-center gap-1.5">
            <span className="font-mono">{elapsed}s</span>
            <span className="text-gray-300">|</span>
            <span className="truncate max-w-[60px]">{image.model || 'Gemini'}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="bg-blue-50 text-blue-600 px-1 py-0.5 rounded font-black tracking-tighter border border-blue-100/50">
              {specParts[1] || '1K'}
            </span>
            <span className="bg-slate-100 text-slate-500 px-1 py-0.5 rounded font-bold tracking-tighter border border-slate-200/50">
              {specParts[0] || '1:1'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});
