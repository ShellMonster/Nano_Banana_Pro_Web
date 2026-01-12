import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  AtSign,
  Banknote,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Folder,
  Github,
  Landmark,
  Loader2,
  Maximize2,
  MessageCircle,
  Printer,
  RefreshCw,
  Search,
  ShoppingBag,
  Smile,
  Sparkles,
  Utensils,
  Video,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { useConfigStore } from '../../store/configStore';
import { useGenerateStore } from '../../store/generateStore';
import { toast } from '../../store/toastStore';
import { getTemplateImageProxyUrl, getTemplates } from '../../services/templateApi';
import { TemplateItem, TemplateListResponse, TemplateMeta, TemplateSource } from '../../types';
import { cacheImageResponse, getCachedImageUrl } from '../../utils/imageCache';
import { useShallow } from 'zustand/react/shallow';
import {
  templateChannels,
  templateIndustries,
  templateItems,
  templateMaterials,
  templateRatios
} from '../../data/templateMarket';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const hashString = async (value: string) => {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-1', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
};

const mimeToExtension = (mime: string) => {
  const lower = (mime || '').toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  return 'jpg';
};
const DEFAULT_TEMPLATE_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#e2e8f0"/>
      <stop offset="100%" stop-color="#cbd5f5"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="72" fill="url(#bg)"/>
  <text x="512" y="540" font-size="72" font-family="Arial, sans-serif" font-weight="700" fill="#1e3a8a" text-anchor="middle">无图展示</text>
</svg>`
)}`;

const resolveTemplateImageSrc = (source?: string) => {
  const trimmed = source?.trim();
  if (!trimmed) return DEFAULT_TEMPLATE_IMAGE;
  if (/^https?:\/\//i.test(trimmed)) return getTemplateImageProxyUrl(trimmed);
  return trimmed;
};

const fallbackMeta: TemplateMeta = {
  channels: templateChannels,
  materials: templateMaterials,
  industries: templateIndustries,
  ratios: templateRatios
};

const dedupeList = (items: string[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item || seen.has(item)) return false;
    seen.add(item);
    return true;
  });
};

const ensureAllFirst = (items: string[]) => {
  if (items.length === 0) return ['全部'];
  return ['全部', ...items.filter((item) => item !== '全部')];
};

const normalizeMeta = (meta?: TemplateMeta) => {
  const channels = ensureAllFirst(dedupeList(meta?.channels?.length ? meta.channels : fallbackMeta.channels));
  const materials = ensureAllFirst(dedupeList(meta?.materials?.length ? meta.materials : fallbackMeta.materials));
  const industries = ensureAllFirst(dedupeList(meta?.industries?.length ? meta.industries : fallbackMeta.industries));
  const ratios = ensureAllFirst(dedupeList(meta?.ratios?.length ? meta.ratios : fallbackMeta.ratios));
  return { channels, materials, industries, ratios };
};

const sourceIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  github: Github,
  xhs: Sparkles,
  wechat: MessageCircle,
  shop: ShoppingBag,
  video: Video,
  print: Printer,
  gov: Landmark,
  meme: Smile,
  finance: Banknote,
  food: Utensils,
  local: Folder
};

const isIconUrl = (value?: string) => {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('asset:') ||
    trimmed.startsWith('tauri:') ||
    trimmed.startsWith('blob:')
  );
};

const renderSourceIcon = (source?: TemplateSource) => {
  if (!source) return <AtSign className="w-3.5 h-3.5 text-slate-500" />;
  if (isIconUrl(source.icon)) {
    return (
      <img
        src={source.icon}
        alt={source.label || source.name || 'source'}
        className="w-4 h-4 rounded-full object-cover"
      />
    );
  }
  const key = (source.icon || '').trim().toLowerCase();
  const Icon = sourceIconMap[key] || AtSign;
  return <Icon className="w-3.5 h-3.5 text-slate-500" />;
};

const formatSourceName = (name: string) => (name.startsWith('@') ? name : `@${name}`);

const openExternalUrl = async (url: string) => {
  if (!url) return;
  if ((window as any).__TAURI_INTERNALS__) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch (err) {
      console.warn('openUrl failed:', err);
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
};

const ActiveFilterChip = ({
  label,
  onClear
}: {
  label: string;
  onClear: () => void;
}) => (
  <button
    type="button"
    onClick={onClear}
    className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/80 border border-white/60 px-3 py-1 text-xs text-slate-600 hover:bg-white"
  >
    <span>{label}</span>
    <X className="w-3 h-3" />
  </button>
);

const FilterChip = ({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
      active
        ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
        : 'bg-white/70 text-slate-600 hover:bg-white'
    }`}
  >
    {label}
  </button>
);

const buildSearchText = (item: TemplateItem) => {
  const tags = item.tags ? item.tags.join(' ') : '';
  const channels = Array.isArray(item.channels) ? item.channels.join(' ') : '';
  const materials = Array.isArray(item.materials) ? item.materials.join(' ') : '';
  const industries = Array.isArray(item.industries) ? item.industries.join(' ') : '';
  return `${item.title} ${tags} ${channels} ${materials} ${industries}`;
};

const createFileFromUrl = async (url: string, filename: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('download failed');
  }
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || 'image/png' });
};

const useCachedImage = (src: string) => {
  const [resolvedSrc, setResolvedSrc] = useState('');

  useEffect(() => {
    let active = true;
    if (!src) {
      setResolvedSrc('');
      return;
    }
    setResolvedSrc('');
    getCachedImageUrl(src).then((cached) => {
      if (!active) return;
      setResolvedSrc(cached || src);
    });
    return () => {
      active = false;
    };
  }, [src]);

  return resolvedSrc;
};

const TemplatePreviewModal = ({
  template,
  templates,
  onTemplateChange,
  onClose,
  onUse,
  applying
}: {
  template: TemplateItem | null;
  templates?: TemplateItem[];
  onTemplateChange?: (template: TemplateItem) => void;
  onClose: () => void;
  onUse: (template: TemplateItem) => void;
  applying: boolean;
}) => {
  const rawImageSrc = template?.image || template?.preview || '';
  const hasImage = Boolean(rawImageSrc);
  const defaultScale = hasImage ? 1 : 0.5;
  const [previewStatus, setPreviewStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [scale, setScale] = useState(defaultScale);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isCopying, setIsCopying] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; adjusted: boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const imageSrc = resolveTemplateImageSrc(rawImageSrc);
  const resolvedImageSrc = useCachedImage(imageSrc);
  const errorText = hasImage ? '图片加载失败' : '暂无图片';
  const items = templates ?? [];
  const currentIndex = template ? items.findIndex((item) => item.id === template.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < items.length - 1;
  const isZoomed = scale > 1.01;

  const handleReset = useCallback(() => {
    setScale(defaultScale);
    setPosition({ x: 0, y: 0 });
    setIsDragging(false);
  }, [defaultScale]);

  const performZoom = useCallback((nextScale: number) => {
    setScale(clamp(nextScale, 0.5, 5));
  }, []);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.2 : -0.2;
    setScale((prev) => clamp(prev + delta, 0.5, 5));
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (contextMenu) {
      setContextMenu(null);
      return;
    }
    if (!isZoomed) return;
    setIsDragging(true);
    setDragStart({ x: event.clientX - position.x, y: event.clientY - position.y });
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setPosition({ x: event.clientX - dragStart.x, y: event.clientY - dragStart.y });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleOpenContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    setContextMenu({ x: event.clientX, y: event.clientY, adjusted: false });
  };

  const goToPrev = useCallback(() => {
    if (!hasPrev || !onTemplateChange) return;
    onTemplateChange(items[currentIndex - 1]);
    handleReset();
  }, [hasPrev, onTemplateChange, items, currentIndex, handleReset]);

  const goToNext = useCallback(() => {
    if (!hasNext || !onTemplateChange) return;
    onTemplateChange(items[currentIndex + 1]);
    handleReset();
  }, [hasNext, onTemplateChange, items, currentIndex, handleReset]);

  const handleCopyImage = useCallback(async () => {
    if (!rawImageSrc || isCopying) return;
    setIsCopying(true);
    try {
      const copySrc = resolveTemplateImageSrc(rawImageSrc);
      const response = await fetch(copySrc);
      if (!response.ok) {
        throw new Error('copy failed');
      }
      const blob = await response.blob();

      const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
      if (isTauri) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const { writeFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
          const dir = 'template_clipboard';
          await mkdir(dir, { recursive: true, baseDir: BaseDirectory.AppData });
          const hash = await hashString(rawImageSrc);
          const ext = mimeToExtension(blob.type);
          const relativePath = `${dir}/${hash}.${ext}`;
          const bytes = new Uint8Array(await blob.arrayBuffer());
          await writeFile(relativePath, bytes, { baseDir: BaseDirectory.AppData });
          await invoke('copy_image_to_clipboard', { path: relativePath });
          toast.success('图片已复制到剪贴板');
          return;
        } catch (err) {
          console.warn('template copy (tauri) failed, fallback to web clipboard:', err);
        }
      }

      const ClipboardItemCtor = (window as any).ClipboardItem as typeof ClipboardItem | undefined;
      if (ClipboardItemCtor && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type || 'image/png']: blob })]);
        toast.success('图片已复制到剪贴板');
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(rawImageSrc);
        toast.info('当前环境不支持复制图片，已复制图片链接');
        return;
      }
      throw new Error('clipboard unavailable');
    } catch (error) {
      console.error('copy template image failed:', error);
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(rawImageSrc);
          toast.success('已复制图片链接');
          return;
        } catch (fallbackError) {
          console.error('copy template url failed:', fallbackError);
        }
      }
      toast.error('复制失败');
    } finally {
      setIsCopying(false);
    }
  }, [rawImageSrc, isCopying]);

  const copyText = useCallback(async (value: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }, []);

  const handleCopyImagePath = useCallback(async () => {
    if (!rawImageSrc) {
      toast.info('图片路径为空');
      return;
    }
    const ok = await copyText(rawImageSrc);
    if (ok) toast.success('图片路径已复制');
    else toast.error('复制失败');
  }, [copyText, rawImageSrc]);

  const handleDownload = useCallback(async () => {
    if (!rawImageSrc) {
      toast.info('暂无可下载图片');
      return;
    }
    try {
      const downloadSrc = resolveTemplateImageSrc(rawImageSrc);
      const response = await fetch(downloadSrc);
      if (!response.ok) throw new Error('download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const ext = mimeToExtension(blob.type);
      const filename = `${template?.id || 'template'}.${ext}`;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('下载已开始');
    } catch (error) {
      console.error('download template image failed:', error);
      toast.error('下载失败');
    }
  }, [rawImageSrc, template?.id]);

  useEffect(() => {
    if (!template) return;
    handleReset();
    setContextMenu(null);
    if (!hasImage) {
      setPreviewStatus('loaded');
      return;
    }
    setPreviewStatus('loading');
  }, [template?.id, hasImage, imageSrc, handleReset]);

  useEffect(() => {
    if (!template) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') goToPrev();
      if (event.key === 'ArrowRight') goToNext();
      if (event.key === 'Escape') {
        if (contextMenu) {
          setContextMenu(null);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [template, goToPrev, goToNext, onClose, contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      const menuEl = contextMenuRef.current;
      if (menuEl && menuEl.contains(event.target as Node)) return;
      setContextMenu(null);
    };

    const handleScroll = () => setContextMenu(null);
    const handleResize = () => setContextMenu(null);

    window.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu || contextMenu.adjusted) return;
    const menuEl = contextMenuRef.current;
    if (!menuEl) return;
    const rect = menuEl.getBoundingClientRect();
    const padding = 8;
    let nextX = contextMenu.x;
    let nextY = contextMenu.y;
    if (nextX + rect.width + padding > window.innerWidth) {
      nextX = window.innerWidth - rect.width - padding;
    }
    if (nextY + rect.height + padding > window.innerHeight) {
      nextY = window.innerHeight - rect.height - padding;
    }
    nextX = Math.max(padding, nextX);
    nextY = Math.max(padding, nextY);
    setContextMenu({ x: nextX, y: nextY, adjusted: true });
  }, [contextMenu]);

  if (!template) return null;

  return (
    <Modal
      isOpen={Boolean(template)}
      onClose={onClose}
      title="模板预览"
      className="max-w-5xl"
    >
      <div className="grid md:grid-cols-[minmax(0,1fr)_320px] gap-6">
        <div className="bg-slate-900/5 rounded-3xl p-4 relative overflow-hidden min-h-[360px]">
          <div
            ref={containerRef}
            className={`relative w-full h-full rounded-2xl overflow-hidden bg-white/70 flex items-center justify-center ${
              isZoomed ? 'cursor-grab active:cursor-grabbing' : ''
            }`}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onContextMenu={handleOpenContextMenu}
          >
            {resolvedImageSrc && (
              <img
                src={resolvedImageSrc}
                alt={template.title}
                className={`max-h-[60vh] w-full object-contain transition-opacity duration-300 ${
                  previewStatus === 'loaded' ? 'opacity-100' : 'opacity-0'
                }`}
                style={{
                  transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                  transition: isDragging ? 'none' : 'transform 0.12s cubic-bezier(0.2, 0, 0.2, 1)'
                }}
                decoding="async"
                onLoad={() => {
                  setPreviewStatus('loaded');
                  if (hasImage) {
                    cacheImageResponse(imageSrc);
                  }
                }}
                onError={() => setPreviewStatus('error')}
                draggable={false}
              />
            )}
            {previewStatus !== 'loaded' && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-2xl">
                {previewStatus === 'error' ? (
                  <span className="text-xs text-slate-500">{errorText}</span>
                ) : (
                  <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
                )}
              </div>
            )}
          </div>

          {hasPrev && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                goToPrev();
              }}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          {hasNext && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                goToNext();
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}

          <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleCopyImage();
              }}
              disabled={!hasImage || isCopying}
              className="px-3 py-2 rounded-full bg-white/90 text-slate-600 text-xs font-semibold flex items-center gap-1.5 shadow-sm hover:bg-white disabled:opacity-60 disabled:cursor-not-allowed"
              title={hasImage ? '复制图片' : '暂无可复制图片'}
            >
              {isCopying ? (
                <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              复制图片
            </button>
          </div>

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-2 py-1.5 bg-white/90 border border-white/70 rounded-full shadow-sm">
            <button
              type="button"
              onClick={() => performZoom(scale - 0.2)}
              className="p-1.5 rounded-full text-slate-600 hover:bg-white"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="px-3 py-1 text-[11px] font-semibold text-slate-700"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              onClick={() => performZoom(scale + 0.2)}
              className="p-1.5 rounded-full text-slate-600 hover:bg-white"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>

        </div>
        {contextMenu && typeof document !== 'undefined'
          ? createPortal(
              <div
                ref={contextMenuRef}
                className="fixed z-[1000] min-w-[180px] bg-white/95 backdrop-blur-xl border border-slate-200/70 rounded-2xl shadow-[0_18px_60px_-18px_rgba(0,0,0,0.35)] overflow-hidden"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                role="menu"
                aria-label="模板图片操作菜单"
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <button
                  type="button"
                  className="w-full px-4 py-3 flex items-center gap-3 text-sm font-bold text-slate-800 hover:bg-slate-100/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={(event) => {
                    event.stopPropagation();
                    setContextMenu(null);
                    handleCopyImage();
                  }}
                  role="menuitem"
                  disabled={!hasImage}
                >
                  <Copy className="w-4 h-4 text-slate-600" />
                  复制图片
                </button>
                <button
                  type="button"
                  className="w-full px-4 py-3 flex items-center gap-3 text-sm font-bold text-slate-800 hover:bg-slate-100/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={(event) => {
                    event.stopPropagation();
                    setContextMenu(null);
                    handleCopyImagePath();
                  }}
                  role="menuitem"
                  disabled={!hasImage}
                >
                  <Copy className="w-4 h-4 text-slate-600" />
                  复制图片路径
                </button>
                <div className="h-px bg-slate-200/60" />
                <button
                  type="button"
                  className="w-full px-4 py-3 flex items-center gap-3 text-sm font-bold text-slate-800 hover:bg-slate-100/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={(event) => {
                    event.stopPropagation();
                    setContextMenu(null);
                    handleDownload();
                  }}
                  role="menuitem"
                  disabled={!hasImage}
                >
                  <Download className="w-4 h-4 text-slate-600" />
                  下载高清原图
                </button>
                <button
                  type="button"
                  className="w-full px-4 py-3 flex items-center gap-3 text-sm font-bold text-slate-800 hover:bg-slate-100/70 transition-colors"
                  onClick={(event) => {
                    event.stopPropagation();
                    setContextMenu(null);
                    handleReset();
                  }}
                  role="menuitem"
                >
                  <Maximize2 className="w-4 h-4 text-slate-600" />
                  重置缩放/位置
                </button>
              </div>,
              document.body
            )
          : null}
        <div className="space-y-4">
          <div>
            <p className="text-xs uppercase text-slate-400 tracking-widest">模板信息</p>
            <h3 className="text-xl font-black text-slate-900 mt-2">{template.title}</h3>
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="px-2.5 py-1 rounded-full text-xs bg-slate-100 text-slate-600">{template.ratio}</span>
              {template.materials?.map((item) => (
                <span key={item} className="px-2.5 py-1 rounded-full text-xs bg-slate-100 text-slate-600">
                  {item}
                </span>
              ))}
            </div>
          </div>
          {template.source?.name && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="text-xs uppercase text-slate-400 tracking-widest">来源</span>
              <div className="flex items-center gap-2 bg-white/70 border border-white/60 rounded-full px-3 py-1">
                {renderSourceIcon(template.source)}
                {template.source.url ? (
                  <button
                    type="button"
                    onClick={() => openExternalUrl(template.source?.url ?? '')}
                    className="text-blue-600 hover:underline"
                  >
                    {formatSourceName(template.source.name)}
                  </button>
                ) : (
                  <span className="text-slate-700">{formatSourceName(template.source.name)}</span>
                )}
                {template.source.label && (
                  <span className="text-slate-400">{template.source.label}</span>
                )}
              </div>
            </div>
          )}
          {(previewStatus === 'error' || template.tips || template.requirements || template.prompt) && (
            <div className="bg-white/70 border border-white/60 rounded-2xl p-4 space-y-3">
              {previewStatus === 'error' && (
                <div className="text-xs text-rose-600 font-semibold">图片加载失败，可继续查看模板信息</div>
              )}
              {template.tips && (
                <div className="pt-3 border-t border-slate-200/70 first:pt-0 first:border-0">
                  <p className="text-xs uppercase text-slate-400 tracking-widest">使用提示</p>
                  <p className="text-sm text-slate-700 mt-1">{template.tips}</p>
                </div>
              )}
              {template.requirements && (
                <div className="pt-3 border-t border-slate-200/70 first:pt-0 first:border-0">
                  <p className="text-xs uppercase text-slate-400 tracking-widest">参考图要求</p>
                  <p className="text-sm text-slate-700 mt-1">{template.requirements.note}</p>
                </div>
              )}
              {template.prompt && (
                <div className="pt-3 border-t border-slate-200/70 first:pt-0 first:border-0">
                  <p className="text-xs uppercase text-slate-400 tracking-widest">模板 Prompt</p>
                  <p className="text-sm text-slate-700 mt-1 leading-relaxed whitespace-pre-wrap">{template.prompt}</p>
                </div>
              )}
            </div>
          )}
          <Button
            size="lg"
            onClick={() => onUse(template)}
            disabled={applying}
            className="w-full"
          >
            {applying ? '处理中...' : '复用此模板'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const TemplateCard = React.memo(function TemplateCard({
  item,
  applyingId,
  onPreview,
  onApply
}: {
  item: TemplateItem;
  applyingId: string | null;
  onPreview: (item: TemplateItem) => void;
  onApply: (item: TemplateItem) => void;
}) {
  const hasPreview = Boolean(item.preview || item.image);
  const previewSrc = resolveTemplateImageSrc(item.preview || item.image);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(hasPreview ? 'loading' : 'loaded');
  const resolvedSrc = useCachedImage(previewSrc);

  useEffect(() => {
    setStatus(hasPreview ? 'loading' : 'loaded');
  }, [item.id, hasPreview]);

  const canPreview = status !== 'loading';
  const isApplying = applyingId === item.id;
  const disableActions = Boolean(applyingId) || status === 'loading';

  return (
    <div
      className="bg-white/80 border border-white/60 rounded-3xl p-3 shadow-sm flex flex-col gap-3 h-full"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '240px 260px' }}
    >
      <button
        type="button"
        onClick={() => onPreview(item)}
        className={`relative group ${canPreview ? '' : 'cursor-not-allowed'}`}
        disabled={!canPreview}
      >
        <div className="relative rounded-2xl overflow-hidden bg-slate-100/70">
          {resolvedSrc && (
            <img
              src={resolvedSrc}
              alt={item.title}
              className={`h-36 w-full object-cover rounded-2xl transition-opacity duration-300 ${
                status === 'loaded' ? 'opacity-100' : 'opacity-0'
              }`}
              loading="lazy"
              decoding="async"
              onLoad={() => {
                setStatus('loaded');
                if (hasPreview) {
                  cacheImageResponse(previewSrc);
                }
              }}
              onError={hasPreview ? () => setStatus('error') : undefined}
            />
          )}
          {status === 'loaded' ? (
            <div className="absolute inset-0 rounded-2xl pointer-events-none">
              <span className="absolute bottom-2 right-2 rounded-full bg-white/85 text-slate-700 text-[11px] font-semibold px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                点击查看
              </span>
            </div>
          ) : (
            <div className="absolute inset-0 rounded-2xl flex items-center justify-center text-xs text-slate-500">
              {status === 'error' ? (
                <span className="px-2.5 py-1 rounded-full bg-white/85">
                  {hasPreview ? '图片加载失败' : '图片地址为空'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/85">
                  <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
                  加载中
                </span>
              )}
            </div>
          )}
        </div>
      </button>
      <div className="flex-1">
        <h4 className="text-sm font-bold text-slate-800 line-clamp-2">{item.title}</h4>
        <p className="text-xs text-slate-400 mt-1">{item.ratio}</p>
      </div>
      {item.requirements && (
        <div className="text-[11px] text-amber-600 bg-amber-50 rounded-full px-2 py-1">
          {item.requirements.note}
        </div>
      )}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onApply(item)}
        disabled={disableActions}
        className="w-full"
      >
        {isApplying ? '应用中...' : disableActions ? '加载中...' : '复用模板'}
      </Button>
    </div>
  );
});

export function TemplateMarketDrawer({
  onOpenChange
}: {
  onOpenChange?: (open: boolean) => void;
}) {
  const { addRefFiles, setPrompt, clearRefFiles } = useConfigStore(
    useShallow((s) => ({
      addRefFiles: s.addRefFiles,
      setPrompt: s.setPrompt,
      clearRefFiles: s.clearRefFiles
    }))
  );
  const setTab = useGenerateStore((s) => s.setTab);
  const currentTab = useGenerateStore((s) => s.currentTab);

  const [isOpen, setIsOpen] = useState(false);
  const [pull, setPull] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState('全部');
  const [material, setMaterial] = useState('全部');
  const [industry, setIndustry] = useState('全部');
  const [ratio, setRatio] = useState('全部');
  const [previewTemplate, setPreviewTemplate] = useState<TemplateItem | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [templateData, setTemplateData] = useState<TemplateListResponse>({
    meta: fallbackMeta,
    items: templateItems
  });
  const [templateSource, setTemplateSource] = useState<'fallback' | 'remote'>('fallback');
  const [isDormant, setIsDormant] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFiltering, setIsFiltering] = useState(false);
  const dragStartRef = useRef(0);
  const toastOnceRef = useRef(false);
  const previousOverflowRef = useRef<string | null>(null);
  const previousOverscrollRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const templateDataRef = useRef(templateData);
  const templateSourceRef = useRef(templateSource);
  const scrollTopRef = useRef(0);
  const dormancyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousTabRef = useRef<'generate' | 'history'>('generate');
  const deferredSearch = useDeferredValue(search);

  const ropeLength = 36 + pull + (isOpen ? 12 : 0);
  const pullThreshold = 42;
  const maxPull = 120;

  const normalizedMeta = useMemo(() => normalizeMeta(templateData.meta), [templateData.meta]);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    templateDataRef.current = templateData;
  }, [templateData]);

  useEffect(() => {
    templateSourceRef.current = templateSource;
  }, [templateSource]);

  const searchIndex = useMemo(() => {
    const map = new Map<string, string>();
    templateData.items.forEach((item) => {
      map.set(item.id, buildSearchText(item).toLowerCase());
    });
    return map;
  }, [templateData.items]);

  const filteredTemplates = useMemo(() => {
    if (isDormant) return [];
    const keyword = deferredSearch.trim().toLowerCase();
    return templateData.items.filter((item) => {
      const matchesSearch = !keyword || (searchIndex.get(item.id) || '').includes(keyword);
      const matchesChannel = channel === '全部' || (item.channels?.includes(channel) ?? false);
      const matchesMaterial = material === '全部' || (item.materials?.includes(material) ?? false);
      const matchesIndustry = industry === '全部' || (item.industries?.includes(industry) ?? false);
      const matchesRatio = ratio === '全部' || item.ratio === ratio;
      return matchesSearch && matchesChannel && matchesMaterial && matchesIndustry && matchesRatio;
    });
  }, [isDormant, deferredSearch, channel, material, industry, ratio, templateData.items, searchIndex]);

  const activeFilters = useMemo(() => {
    const filters: { label: string; onClear: () => void }[] = [];
    if (search.trim()) {
      filters.push({ label: `搜索: ${search.trim()}`, onClear: () => setSearch('') });
    }
    if (channel !== '全部') {
      filters.push({ label: `渠道: ${channel}`, onClear: () => setChannel('全部') });
    }
    if (material !== '全部') {
      filters.push({ label: `物料: ${material}`, onClear: () => setMaterial('全部') });
    }
    if (industry !== '全部') {
      filters.push({ label: `行业: ${industry}`, onClear: () => setIndustry('全部') });
    }
    if (ratio !== '全部') {
      filters.push({ label: `比例: ${ratio}`, onClear: () => setRatio('全部') });
    }
    return filters;
  }, [search, channel, material, industry, ratio]);

  const hasActiveFilters = activeFilters.length > 0;

  const clearAllFilters = () => {
    setSearch('');
    setChannel('全部');
    setMaterial('全部');
    setIndustry('全部');
    setRatio('全部');
  };

  const fetchTemplates = useCallback(async (fromUser = false) => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await getTemplates({ refresh: fromUser });
      if (requestId !== requestIdRef.current) return;
      if (!res || !Array.isArray(res.items)) {
        throw new Error('模板数据异常');
      }
      if (res.items.length === 0) {
        throw new Error('模板数据为空');
      }
      setTemplateData({
        meta: normalizeMeta(res.meta),
        items: res.items
      });
      setTemplateSource('remote');
      setLoadError(null);
      if (fromUser) {
        toast.success('模板已刷新');
      }
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      const isFallback = templateSourceRef.current === 'fallback';
      if (isFallback) {
        setTemplateData({
          meta: fallbackMeta,
          items: templateItems
        });
      }
      const message = isFallback ? '模板拉取失败，已使用内置模板' : '模板拉取失败，已保留当前模板';
      setLoadError(message);
      if (fromUser) {
        toast.error(message.replace('拉取', '刷新'));
      } else if (!toastOnceRef.current) {
        toastOnceRef.current = true;
        toast.info(message);
      }
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  useEffect(() => {
    if (isDormant || isFiltering) return;
    setIsFiltering(true);
    const timer = setTimeout(() => setIsFiltering(false), 180);
    return () => clearTimeout(timer);
  }, [isDormant, deferredSearch, channel, material, industry, ratio, templateData.items]);


  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (previewTemplate) {
          setPreviewTemplate(null);
          return;
        }
        handleCloseToPrevious();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, previewTemplate]);

  useLayoutEffect(() => {
    if (!isOpen || isDormant) return;
    const container = listRef.current;
    if (!container) return;
    const top = scrollTopRef.current;
    if (top <= 0) return;
    requestAnimationFrame(() => {
      container.scrollTop = top;
    });
  }, [isOpen, isDormant, filteredTemplates.length]);

  useEffect(() => {
    const element = document.documentElement;
    if (isOpen) {
      previousOverflowRef.current = element.style.overflow;
      previousOverscrollRef.current = element.style.overscrollBehavior;
      element.style.overflow = 'hidden';
      element.style.overscrollBehavior = 'contain';
    } else if (previousOverflowRef.current !== null) {
      element.style.overflow = previousOverflowRef.current;
      element.style.overscrollBehavior = previousOverscrollRef.current ?? '';
    }
  }, [isOpen]);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    setIsDragging(true);
    dragStartRef.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDragging) return;
    const delta = event.clientY - dragStartRef.current;
    setPull(clamp(delta, 0, maxPull));
  };

  const handlePointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (pull >= pullThreshold) {
      handleOpen();
    }
    setPull(0);
  };

  const handleOpen = () => {
    if (dormancyTimerRef.current) {
      clearTimeout(dormancyTimerRef.current);
      dormancyTimerRef.current = null;
    }
    previousTabRef.current = currentTab;
    setIsDormant(false);
    setIsOpen(true);
  };

  const closeDrawer = (nextTab: 'generate' | 'history') => {
    scrollTopRef.current = listRef.current?.scrollTop ?? 0;
    setIsOpen(false);
    setTab(nextTab);
    if (dormancyTimerRef.current) {
      clearTimeout(dormancyTimerRef.current);
    }
    dormancyTimerRef.current = setTimeout(() => {
      setIsDormant(true);
    }, 260);
  };

  const handleCloseToPrevious = () => {
    closeDrawer(previousTabRef.current);
  };

  const handleCloseToGenerate = () => {
    closeDrawer('generate');
  };

  const applyTemplate = async (template: TemplateItem) => {
    if (applyingId) return;

    setApplyingId(template.id);
    try {
      clearRefFiles();
      const imageSrc = template.image || template.preview;
      if (imageSrc) {
        const proxySrc = getTemplateImageProxyUrl(imageSrc);
        let file: File;
        try {
          file = await createFileFromUrl(proxySrc, `${template.id}.png`);
        } catch (error) {
          if (proxySrc !== imageSrc) {
            file = await createFileFromUrl(imageSrc, `${template.id}.png`);
          } else {
            throw error;
          }
        }
        addRefFiles([file]);
      }

      setPrompt(template.prompt ?? '');

      const nextCount = useConfigStore.getState().refFiles.length;
      const minRefs = template.requirements?.minRefs ?? 0;
      if (minRefs > 0 && nextCount < minRefs) {
        toast.info(template.requirements?.note || '还需要补充更多参考图');
      }

      setPreviewTemplate(null);
      toast.success('已替换 Prompt 与参考图');
    } catch (error) {
      toast.error('模板应用失败，请稍后重试');
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <>
      {!isOpen && (
        <div className="absolute right-10 top-2 z-40 hidden md:flex flex-col items-center select-none">
        <div className="w-[2px] bg-slate-400/80 rounded-full" style={{ height: ropeLength }} />
        <button
            type="button"
            onClick={handleOpen}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          className={`w-6 h-6 rounded-full border border-slate-300 shadow-md bg-white/95 transition-all flex items-center justify-center ${
            isDragging ? 'scale-110' : ''
          }`}
          title="下拉打开模板市场"
        >
          <span className="w-2 h-2 rounded-full bg-blue-500/80 shadow-sm" />
        </button>
        <span className="mt-1 text-[11px] text-slate-500 tracking-[0.25em] font-semibold">模板</span>
      </div>
      )}

      {isOpen && (
        <div
          className="absolute inset-0 bg-slate-900/15 backdrop-blur-[2px] z-20"
          onClick={handleCloseToPrevious}
        />
      )}

      <aside
        className={`absolute inset-0 bg-white/80 backdrop-blur-xl shadow-xl z-30 flex flex-col transition-transform duration-300 ${
          isOpen
            ? 'translate-y-0 opacity-100 pointer-events-auto'
            : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center justify-between px-8 py-5 border-b border-white/60">
          <div>
            <p className="text-xs text-slate-400 tracking-[0.3em]">TEMPLATE</p>
            <h2 className="text-xl font-black text-slate-900">模板市场</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCloseToGenerate}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold bg-white/80 text-slate-600 hover:bg-white"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              返回生成
            </button>
            <button
              type="button"
              onClick={handleCloseToPrevious}
              className="w-9 h-9 rounded-full bg-white/80 text-slate-400 hover:text-slate-700 hover:bg-white flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {(isLoading || loadError) && (
          <div className="px-8 py-2 text-xs text-slate-500 bg-white/60 border-b border-white/60">
            {isLoading ? '正在拉取最新模板…' : loadError}
          </div>
        )}

        <div ref={listRef} className="flex-1 min-h-0 flex flex-col px-6 pb-6 overflow-y-auto">
          <div className="pt-6 space-y-6">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索模板、标签、行业"
                className="pl-10 bg-white/80"
              />
            </div>
            <div className="flex items-center gap-2 overflow-x-auto flex-nowrap min-h-[34px] pb-1">
              <span className="text-xs text-slate-400 shrink-0">已选</span>
              {hasActiveFilters ? (
                <>
                  {activeFilters.map((filter) => (
                    <ActiveFilterChip key={filter.label} label={filter.label} onClear={filter.onClear} />
                  ))}
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="text-xs text-blue-600 hover:underline shrink-0"
                  >
                    清空筛选
                  </button>
                </>
              ) : (
                <span className="text-xs text-slate-400 shrink-0">暂无</span>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase text-slate-400 tracking-widest mb-2">渠道</p>
                <div className="flex flex-wrap gap-2">
                  {normalizedMeta.channels.map((item) => (
                    <FilterChip
                      key={item}
                      label={item}
                      active={channel === item}
                      onClick={() => setChannel(item)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400 tracking-widest mb-2">物料</p>
                <div className="flex flex-wrap gap-2">
                  {normalizedMeta.materials.map((item) => (
                    <FilterChip
                      key={item}
                      label={item}
                      active={material === item}
                      onClick={() => setMaterial(item)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400 tracking-widest mb-2">行业</p>
                <div className="flex flex-wrap gap-2">
                  {normalizedMeta.industries.map((item) => (
                    <FilterChip
                      key={item}
                      label={item}
                      active={industry === item}
                      onClick={() => setIndustry(item)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400 tracking-widest mb-2">画幅比例</p>
                <div className="flex flex-wrap gap-2">
                  {normalizedMeta.ratios.map((item) => (
                    <FilterChip
                      key={item}
                      label={item}
                      active={ratio === item}
                      onClick={() => setRatio(item)}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">
                  {isLoading ? '模板加载中...' : `共 ${filteredTemplates.length} 个模板`}
                </p>
              </div>
                <button
                type="button"
                onClick={() => fetchTemplates(true)}
                disabled={isLoading}
                className="w-8 h-8 rounded-full bg-white/70 border border-white/60 flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="mt-6">
            {isDormant ? (
              <div
                className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5"
                onContextMenu={(event) => event.preventDefault()}
              >
                {Array.from({ length: 8 }).map((_, index) => (
                  <div
                    key={`skeleton-${index}`}
                    className="bg-white/70 border border-white/60 rounded-3xl p-3 shadow-sm flex flex-col gap-3 animate-pulse"
                  >
                    <div className="h-36 w-full rounded-2xl bg-slate-200/70" />
                    <div className="space-y-2">
                      <div className="h-3 w-3/4 rounded-full bg-slate-200/70" />
                      <div className="h-2 w-1/2 rounded-full bg-slate-200/60" />
                    </div>
                    <div className="h-8 rounded-full bg-slate-200/70" />
                  </div>
                ))}
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="text-sm text-slate-500 bg-white/70 border border-white/60 rounded-2xl p-6 text-center">
                暂无匹配模板，试试调整筛选条件
                {hasActiveFilters && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      清空筛选
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className={`${isFiltering ? 'opacity-70' : 'opacity-100'}`}>
                <div
                  className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5 pr-1"
                  onContextMenu={(event) => event.preventDefault()}
                >
                  {filteredTemplates.map((item) => (
                    <TemplateCard
                      key={item.id}
                      item={item}
                      applyingId={applyingId}
                      onPreview={setPreviewTemplate}
                      onApply={applyTemplate}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <TemplatePreviewModal
        template={previewTemplate}
        templates={filteredTemplates}
        onTemplateChange={setPreviewTemplate}
        onClose={() => setPreviewTemplate(null)}
        onUse={applyTemplate}
        applying={Boolean(applyingId)}
      />
    </>
  );
}
