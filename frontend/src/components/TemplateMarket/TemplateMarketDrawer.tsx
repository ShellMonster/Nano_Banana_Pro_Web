import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  AtSign,
  AlertTriangle,
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
  templateRatios,
  templateLabelKeys,
  TEMPLATE_ALL_VALUE
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
const ALL_VALUE = TEMPLATE_ALL_VALUE;

const buildDefaultTemplateImage = (label: string) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#e2e8f0"/>
      <stop offset="100%" stop-color="#cbd5f5"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="72" fill="url(#bg)"/>
  <text x="512" y="540" font-size="72" font-family="Arial, sans-serif" font-weight="700" fill="#1e3a8a" text-anchor="middle">${label}</text>
</svg>`
)}`;

const resolveTemplateImageSrc = (source?: string, fallbackText = '') => {
  const trimmed = source?.trim();
  if (!trimmed) return buildDefaultTemplateImage(fallbackText);
  if (/^https?:\/\//i.test(trimmed)) return getTemplateImageProxyUrl(trimmed);
  return trimmed;
};

const fallbackMeta: TemplateMeta = {
  channels: templateChannels,
  materials: templateMaterials,
  industries: templateIndustries,
  ratios: templateRatios
};

const FILTER_LABEL_KEYS: Record<string, string> = templateLabelKeys;

const getFilterLabel = (value: string, translate: (key: string, options?: any) => string) => {
  const key = FILTER_LABEL_KEYS[value];
  return key ? translate(key) : value;
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
  if (items.length === 0) return [ALL_VALUE];
  return [ALL_VALUE, ...items.filter((item) => item !== ALL_VALUE)];
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
  const { t } = useTranslation();
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
  const imageSrc = resolveTemplateImageSrc(rawImageSrc, t('templateMarket.placeholder.noImage'));
  const resolvedImageSrc = useCachedImage(imageSrc);
  const errorText = hasImage ? t('templateMarket.preview.imageFailed') : t('templateMarket.preview.noImage');
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

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const delta = event.deltaY < 0 ? 0.2 : -0.2;
    setScale((prev) => clamp(prev + delta, 0.5, 5));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel, template?.id]);

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

      const ClipboardItemCtor = (window as any).ClipboardItem as typeof ClipboardItem | undefined;
      if (ClipboardItemCtor && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type || 'image/png']: blob })]);
        toast.success(t('toast.copyImageSuccess'));
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(rawImageSrc);
        toast.info(t('toast.copyImageUnsupported'));
        return;
      }
      throw new Error('clipboard unavailable');
    } catch (error) {
      console.error('copy template image failed:', error);
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(rawImageSrc);
          toast.success(t('templateMarket.toast.imageLinkCopied'));
          return;
        } catch (fallbackError) {
          console.error('copy template url failed:', fallbackError);
        }
      }
      toast.error(t('toast.copyFailed'));
    } finally {
      setIsCopying(false);
    }
  }, [rawImageSrc, isCopying, t]);

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
      toast.info(t('toast.imagePathEmpty'));
      return;
    }
    const ok = await copyText(rawImageSrc);
    if (ok) toast.success(t('toast.imagePathCopied'));
    else toast.error(t('toast.copyFailed'));
  }, [copyText, rawImageSrc, t]);

  const handleCopyPrompt = useCallback(async () => {
    const prompt = template?.prompt?.trim();
    if (!prompt) {
      toast.info(t('templateMarket.toast.noCopyContent'));
      return;
    }
    const ok = await copyText(prompt);
    if (ok) toast.success(t('templateMarket.toast.promptCopied'));
    else toast.error(t('toast.copyFailed'));
  }, [copyText, template?.prompt, t]);

  const handleCopyTips = useCallback(async () => {
    const tips = template?.tips?.trim();
    if (!tips) {
      toast.info(t('templateMarket.toast.noCopyContent'));
      return;
    }
    const ok = await copyText(tips);
    if (ok) toast.success(t('templateMarket.toast.tipsCopied'));
    else toast.error(t('toast.copyFailed'));
  }, [copyText, template?.tips, t]);

  const handleCopyRequirements = useCallback(async () => {
    const note = template?.requirements?.note?.trim();
    if (!note) {
      toast.info(t('templateMarket.toast.noCopyContent'));
      return;
    }
    const ok = await copyText(note);
    if (ok) toast.success(t('templateMarket.toast.requirementsCopied'));
    else toast.error(t('toast.copyFailed'));
  }, [copyText, template?.requirements?.note, t]);

  const handleDownload = useCallback(async () => {
    if (!rawImageSrc) {
      toast.info(t('templateMarket.toast.noDownload'));
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
      toast.success(t('templateMarket.toast.downloadStarted'));
    } catch (error) {
      console.error('download template image failed:', error);
      toast.error(t('templateMarket.toast.downloadFailed'));
    }
  }, [rawImageSrc, template?.id, t]);

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
      title={t('templateMarket.preview.title')}
      className="max-w-5xl h-[82vh]"
      contentScrollable={false}
      contentClassName="h-full min-h-0"
    >
      <div className="grid md:grid-cols-[minmax(0,1fr)_320px] gap-6 h-full min-h-0">
        <div className="bg-slate-900/5 rounded-3xl p-4 relative overflow-hidden min-h-[240px] md:h-full md:min-h-0">
          <div
            ref={containerRef}
            className={`relative w-full h-full min-h-0 rounded-2xl overflow-hidden bg-white/70 flex items-center justify-center overscroll-contain ${
              isZoomed ? 'cursor-grab active:cursor-grabbing' : ''
            }`}
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
                className={`w-full h-full max-h-full object-contain transition-opacity duration-300 ${
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
              title={hasImage ? t('templateMarket.preview.copyImage') : t('templateMarket.preview.copyImageDisabled')}
            >
              {isCopying ? (
                <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {t('templateMarket.preview.copyImage')}
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
                aria-label={t('templateMarket.preview.menuLabel')}
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
                  {t('templateMarket.preview.menu.copyImage')}
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
                  {t('templateMarket.preview.menu.copyImagePath')}
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
                  {t('templateMarket.preview.menu.downloadOriginal')}
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
                  {t('templateMarket.preview.menu.resetZoom')}
                </button>
              </div>,
              document.body
            )
          : null}
        <div className="flex flex-col gap-4 md:h-full md:min-h-0">
          <div className="flex-shrink-0">
            <p className="text-xs uppercase text-slate-400 tracking-widest">{t('templateMarket.preview.infoTitle')}</p>
            <h3 className="text-xl font-black text-slate-900 mt-2">{template.title}</h3>
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="px-2.5 py-1 rounded-full text-xs bg-slate-100 text-slate-600">
                {getFilterLabel(template.ratio, t)}
              </span>
              {template.materials?.map((item) => (
                <span key={item} className="px-2.5 py-1 rounded-full text-xs bg-slate-100 text-slate-600">
                  {getFilterLabel(item, t)}
                </span>
              ))}
            </div>
          </div>
          <div className="md:flex-1 md:min-h-0 overflow-y-auto overscroll-contain scrollbar-none pr-1">
            <div className="space-y-4">
              {template.source?.name && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="text-xs uppercase text-slate-400 tracking-widest">{t('templateMarket.preview.source')}</span>
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
                <div className="space-y-3">
                  {previewStatus === 'error' && (
                    <div className="rounded-2xl border border-rose-200/70 bg-rose-50/70 px-4 py-3 flex items-start gap-2 text-xs font-semibold text-rose-700">
                      <AlertTriangle className="w-4 h-4 mt-0.5" />
                      <span>{t('templateMarket.preview.imageFailedHint')}</span>
                    </div>
                  )}
                  {template.tips && (
                    <div className="rounded-2xl border border-blue-200/70 bg-blue-50/70 p-4">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-blue-700 tracking-widest">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-3.5 h-3.5" />
                          {t('templateMarket.preview.tips')}
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyTips}
                          className="text-blue-600 hover:text-blue-700 font-semibold"
                        >
                          {t('common.copy')}
                        </button>
                      </div>
                      <p className="text-sm text-slate-700 mt-2 leading-relaxed">{template.tips}</p>
                    </div>
                  )}
                  {template.requirements && (
                    <div className="rounded-2xl border border-amber-200/70 bg-amber-50/70 p-4">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-amber-700 tracking-widest">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {t('templateMarket.preview.requirements')}
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyRequirements}
                          className="text-blue-600 hover:text-blue-700 font-semibold"
                        >
                          {t('common.copy')}
                        </button>
                      </div>
                      <p className="text-sm text-slate-700 mt-2 leading-relaxed">{template.requirements.note}</p>
                    </div>
                  )}
                  {template.prompt && (
                    <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-4">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 tracking-widest">
                        <div className="flex items-center gap-2">
                          <MessageCircle className="w-3.5 h-3.5" />
                          {t('templateMarket.preview.prompt')}
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyPrompt}
                          className="text-blue-600 hover:text-blue-700 font-semibold"
                        >
                          {t('common.copy')}
                        </button>
                      </div>
                      <div className="mt-2 rounded-xl border border-slate-200/60 bg-slate-50/70 p-3">
                        <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-mono">
                          {template.prompt}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <Button
            size="lg"
            onClick={() => onUse(template)}
            disabled={applying}
            className="w-full"
          >
            {applying ? t('templateMarket.preview.applying') : t('templateMarket.preview.use')}
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
  const { t } = useTranslation();
  const hasPreview = Boolean(item.preview || item.image);
  const previewSrc = resolveTemplateImageSrc(item.preview || item.image, t('templateMarket.placeholder.noImage'));
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
                {t('templateMarket.card.view')}
              </span>
            </div>
          ) : (
            <div className="absolute inset-0 rounded-2xl flex items-center justify-center text-xs text-slate-500">
              {status === 'error' ? (
                <span className="px-2.5 py-1 rounded-full bg-white/85">
                  {hasPreview ? t('templateMarket.card.imageFailed') : t('templateMarket.card.imageEmpty')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/85">
                  <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
                  {t('templateMarket.card.loading')}
                </span>
              )}
            </div>
          )}
        </div>
      </button>
      <div className="flex-1">
        <h4 className="text-sm font-bold text-slate-800 line-clamp-2">{item.title}</h4>
        <p className="text-xs text-slate-400 mt-1">{getFilterLabel(item.ratio, t)}</p>
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
        {isApplying ? t('templateMarket.card.applying') : disableActions ? t('templateMarket.card.loading') : t('templateMarket.card.use')}
    </Button>
    </div>
  );
});

export function TemplateMarketDrawer({
  onOpenChange
}: {
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
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
  const [channel, setChannel] = useState(ALL_VALUE);
  const [material, setMaterial] = useState(ALL_VALUE);
  const [industry, setIndustry] = useState(ALL_VALUE);
  const [ratio, setRatio] = useState(ALL_VALUE);
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
  const previousTabRef = useRef<'generate' | 'history'>('generate');
  const deferredSearch = useDeferredValue(search);

  const ropeLength = 44 + pull + (isOpen ? 12 : 0);
  const pullThreshold = 42;
  const maxPull = 120;

  const normalizedMeta = useMemo(() => normalizeMeta(templateData.meta), [templateData.meta]);
  const formatFilterLabel = useCallback((value: string) => getFilterLabel(value, t), [t]);

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
      const matchesChannel = channel === ALL_VALUE || (item.channels?.includes(channel) ?? false);
      const matchesMaterial = material === ALL_VALUE || (item.materials?.includes(material) ?? false);
      const matchesIndustry = industry === ALL_VALUE || (item.industries?.includes(industry) ?? false);
      const matchesRatio = ratio === ALL_VALUE || item.ratio === ratio;
      return matchesSearch && matchesChannel && matchesMaterial && matchesIndustry && matchesRatio;
    });
  }, [isDormant, deferredSearch, channel, material, industry, ratio, templateData.items, searchIndex]);

  const activeFilters = useMemo(() => {
    const filters: { label: string; onClear: () => void }[] = [];
    if (search.trim()) {
      filters.push({ label: t('templateMarket.active.search', { keyword: search.trim() }), onClear: () => setSearch('') });
    }
    if (channel !== ALL_VALUE) {
      filters.push({ label: t('templateMarket.active.channel', { label: formatFilterLabel(channel) }), onClear: () => setChannel(ALL_VALUE) });
    }
    if (material !== ALL_VALUE) {
      filters.push({ label: t('templateMarket.active.material', { label: formatFilterLabel(material) }), onClear: () => setMaterial(ALL_VALUE) });
    }
    if (industry !== ALL_VALUE) {
      filters.push({ label: t('templateMarket.active.industry', { label: formatFilterLabel(industry) }), onClear: () => setIndustry(ALL_VALUE) });
    }
    if (ratio !== ALL_VALUE) {
      filters.push({ label: t('templateMarket.active.ratio', { label: formatFilterLabel(ratio) }), onClear: () => setRatio(ALL_VALUE) });
    }
    return filters;
  }, [search, channel, material, industry, ratio, t, formatFilterLabel]);

  const hasActiveFilters = activeFilters.length > 0;

  const clearAllFilters = () => {
    setSearch('');
    setChannel(ALL_VALUE);
    setMaterial(ALL_VALUE);
    setIndustry(ALL_VALUE);
    setRatio(ALL_VALUE);
  };

  const fetchTemplates = useCallback(async (fromUser = false) => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await getTemplates({ refresh: fromUser });
      if (requestId !== requestIdRef.current) return;
      if (!res || !Array.isArray(res.items)) {
        throw new Error(t('templateMarket.toast.invalidData'));
      }
      if (res.items.length === 0) {
        throw new Error(t('templateMarket.toast.emptyData'));
      }
      setTemplateData({
        meta: normalizeMeta(res.meta),
        items: res.items
      });
      setTemplateSource('remote');
      setLoadError(null);
      if (fromUser) {
        toast.success(t('templateMarket.toast.refreshed'));
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
      const message = isFallback
        ? t('templateMarket.toast.fetchFallback')
        : t('templateMarket.toast.fetchFailed');
      setLoadError(message);
      if (fromUser) {
        toast.error(t('templateMarket.toast.refreshFailed'));
      } else if (!toastOnceRef.current) {
        toastOnceRef.current = true;
        toast.info(message);
      }
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [t]);

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
    previousTabRef.current = currentTab;
    setIsDormant(false);
    setIsOpen(true);
  };

  const closeDrawer = (
    nextTab: 'generate' | 'history',
    options?: { deferClose?: boolean }
  ) => {
    scrollTopRef.current = listRef.current?.scrollTop ?? 0;
    setTab(nextTab);
    const doClose = () => setIsOpen(false);
    if (options?.deferClose) {
      requestAnimationFrame(doClose);
    } else {
      doClose();
    }
  };

  const handleCloseToPrevious = () => {
    closeDrawer(previousTabRef.current);
  };

  const handleCloseToGenerate = () => {
    closeDrawer('generate', { deferClose: true });
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      if (!isOpen) return;
      closeDrawer('generate', { deferClose: true });
    };
    window.addEventListener('template-market:close', handler);
    return () => window.removeEventListener('template-market:close', handler);
  }, [isOpen, closeDrawer]);

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
        toast.info(template.requirements?.note || t('templateMarket.toast.moreRefsNeeded'));
      }

      setPreviewTemplate(null);
      toast.success(t('templateMarket.toast.applied'));
    } catch (error) {
      toast.error(t('templateMarket.toast.applyFailed'));
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
          title={t('templateMarket.toggle.title')}
        >
          <span className="w-2 h-2 rounded-full bg-blue-500/80 shadow-sm" />
        </button>
        <span className="mt-1 text-[11px] text-slate-500 tracking-[0.25em] font-semibold">{t('templateMarket.toggle.label')}</span>
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
            <h2 className="text-xl font-black text-slate-900">{t('templateMarket.title')}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCloseToGenerate}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold bg-white/80 text-slate-600 hover:bg-white"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {t('templateMarket.actions.backToGenerate')}
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
            {isLoading ? t('templateMarket.loading.fetching') : loadError}
          </div>
        )}

        <div ref={listRef} className="flex-1 min-h-0 flex flex-col px-6 pb-6 overflow-y-auto">
          <div className="pt-6 space-y-6">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('templateMarket.searchPlaceholder')}
                className="pl-10 bg-white/80"
              />
            </div>
            <div className="flex items-center gap-2 overflow-x-auto flex-nowrap min-h-[34px] pb-1">
              <span className="text-xs text-slate-400 shrink-0">{t('templateMarket.activeFilters.title')}</span>
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
                    {t('templateMarket.actions.clearFilters')}
                  </button>
                </>
              ) : (
                <span className="text-xs text-slate-400 shrink-0">{t('templateMarket.activeFilters.empty')}</span>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase text-slate-400 tracking-widest mb-2">{t('templateMarket.filters.channel')}</p>
                <div className="flex flex-wrap gap-2">
                  {normalizedMeta.channels.map((item) => (
                    <FilterChip
                      key={item}
                      label={formatFilterLabel(item)}
                      active={channel === item}
                      onClick={() => setChannel(item)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400 tracking-widest mb-2">{t('templateMarket.filters.material')}</p>
                <div className="flex flex-wrap gap-2">
                  {normalizedMeta.materials.map((item) => (
                    <FilterChip
                      key={item}
                      label={formatFilterLabel(item)}
                      active={material === item}
                      onClick={() => setMaterial(item)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400 tracking-widest mb-2">{t('templateMarket.filters.industry')}</p>
                <div className="flex flex-wrap gap-2">
                  {normalizedMeta.industries.map((item) => (
                    <FilterChip
                      key={item}
                      label={formatFilterLabel(item)}
                      active={industry === item}
                      onClick={() => setIndustry(item)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400 tracking-widest mb-2">{t('templateMarket.filters.ratio')}</p>
                <div className="flex flex-wrap gap-2">
                  {normalizedMeta.ratios.map((item) => (
                    <FilterChip
                      key={item}
                      label={formatFilterLabel(item)}
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
                  {isLoading ? t('templateMarket.list.loading') : t('templateMarket.list.count', { count: filteredTemplates.length })}
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
                {t('templateMarket.list.empty')}
                {hasActiveFilters && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      {t('templateMarket.actions.clearFilters')}
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
