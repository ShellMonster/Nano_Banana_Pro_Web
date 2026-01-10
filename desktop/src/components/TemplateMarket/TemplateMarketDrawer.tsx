import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { Grid, type CellComponentProps, type GridImperativeAPI } from 'react-window';
import {
  ArrowLeft,
  AtSign,
  Banknote,
  Folder,
  Github,
  Landmark,
  Loader2,
  MessageCircle,
  Printer,
  RefreshCw,
  Search,
  ShoppingBag,
  Smile,
  Sparkles,
  Utensils,
  Video,
  X
} from 'lucide-react';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { useConfigStore } from '../../store/configStore';
import { useGenerateStore } from '../../store/generateStore';
import { toast } from '../../store/toastStore';
import { getTemplates } from '../../services/templateApi';
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
const TEMPLATE_CARD_HEIGHT = 300;
const TEMPLATE_GAP = 20;
const DEFAULT_TEMPLATE_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#e2e8f0"/>
      <stop offset="100%" stop-color="#cbd5f5"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="900" rx="48" fill="url(#bg)"/>
  <rect x="140" y="220" width="920" height="460" rx="40" fill="rgba(255,255,255,0.7)"/>
  <text x="200" y="420" font-size="72" font-family="Arial, sans-serif" font-weight="700" fill="#475569">TEMPLATE</text>
  <text x="200" y="500" font-size="32" font-family="Arial, sans-serif" fill="#64748b">NO IMAGE PROVIDED</text>
</svg>`
)}`;

const getTemplateColumnCount = (width: number) => {
  if (width >= 1280) return 4;
  if (width >= 768) return 3;
  return 2;
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
  onClose,
  onUse,
  applying
}: {
  template: TemplateItem | null;
  onClose: () => void;
  onUse: (template: TemplateItem) => void;
  applying: boolean;
}) => {
  const [previewStatus, setPreviewStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const hasImage = Boolean(template?.image || template?.preview);
  const imageSrc = template?.image || template?.preview || DEFAULT_TEMPLATE_IMAGE;
  const resolvedImageSrc = useCachedImage(imageSrc);
  const errorText = hasImage ? '图片加载失败' : '暂无图片';

  useEffect(() => {
    if (!template) return;
    if (!hasImage) {
      setPreviewStatus('loaded');
      return;
    }
    setPreviewStatus('loading');
  }, [template?.id, hasImage, imageSrc]);

  if (!template) return null;

  return (
    <Modal
      isOpen={Boolean(template)}
      onClose={onClose}
      title="模板预览"
      className="max-w-5xl"
    >
      <div className="grid md:grid-cols-[minmax(0,1fr)_320px] gap-6">
        <div className="bg-slate-900/5 rounded-3xl p-4 flex items-center justify-center relative overflow-hidden">
          {resolvedImageSrc && (
            <img
              src={resolvedImageSrc}
              alt={template.title}
              className={`max-h-[60vh] w-full object-contain rounded-2xl shadow-xl transition-opacity duration-300 ${
                previewStatus === 'loaded' ? 'opacity-100' : 'opacity-0'
              }`}
              decoding="async"
              onLoad={() => {
                setPreviewStatus('loaded');
                if (hasImage) {
                  cacheImageResponse(imageSrc);
                }
              }}
              onError={() => setPreviewStatus('error')}
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
          {template.tips && (
            <div className="bg-blue-50/80 border border-blue-100 rounded-2xl p-3 text-xs text-blue-700">
              {template.tips}
            </div>
          )}
          {template.requirements && (
            <div className="bg-amber-50/80 border border-amber-100 rounded-2xl p-3 text-xs text-amber-700">
              {template.requirements.note}
            </div>
          )}
          {template.prompt && (
            <div className="bg-white/70 border border-white/60 rounded-2xl p-3">
              <p className="text-xs text-slate-400 mb-2">模板 Prompt</p>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{template.prompt}</p>
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
  const previewSrc = item.preview || item.image || DEFAULT_TEMPLATE_IMAGE;
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(hasPreview ? 'loading' : 'loaded');
  const resolvedSrc = useCachedImage(previewSrc);

  useEffect(() => {
    setStatus(hasPreview ? 'loading' : 'loaded');
  }, [item.id, hasPreview]);

  const isReady = status === 'loaded';
  const isApplying = applyingId === item.id;
  const disableActions = Boolean(applyingId) || !isReady;

  return (
    <div
      className="bg-white/80 border border-white/60 rounded-3xl p-3 shadow-sm flex flex-col gap-3 h-full"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '240px 260px' }}
    >
      <button
        type="button"
        onClick={() => onPreview(item)}
        className={`relative group ${isReady ? '' : 'cursor-not-allowed'}`}
        disabled={!isReady}
      >
        <div className="relative">
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
            <div className="absolute inset-0 rounded-2xl bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold">
              点击查看
            </div>
          ) : (
            <div className="absolute inset-0 rounded-2xl bg-white/70 flex items-center justify-center text-xs text-slate-500">
              {status === 'error' ? (
                <span>{hasPreview ? '图片加载失败' : '图片地址为空'}</span>
              ) : (
                <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
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
        {isApplying
          ? '应用中...'
          : !isReady
            ? status === 'error'
              ? '图片加载失败'
              : '加载中...'
            : '复用模板'}
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
  const gridRef = useRef<GridImperativeAPI | null>(null);
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
      const res = await getTemplates();
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
    const container = gridRef.current?.element;
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
    scrollTopRef.current = gridRef.current?.element?.scrollTop ?? 0;
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
        const file = await createFileFromUrl(imageSrc, `${template.id}.png`);
        addRefFiles([file]);
      }

      setPrompt(template.prompt ?? '');

      const nextCount = useConfigStore.getState().refFiles.length;
      const minRefs = template.requirements?.minRefs ?? 0;
      if (minRefs > 0 && nextCount < minRefs) {
        toast.info(template.requirements?.note || '还需要补充更多参考图');
      }

      setTab('generate');
      setIsOpen(false);
      setPreviewTemplate(null);
      toast.success('已替换 Prompt 与参考图');
    } catch (error) {
      toast.error('模板应用失败，请稍后重试');
    } finally {
      setApplyingId(null);
    }
  };

  type TemplateCellData = {
    items: TemplateItem[];
    columnCount: number;
    itemWidth: number;
    itemHeight: number;
    gap: number;
  };

  const TemplateCell = useCallback(
    ({
      columnIndex,
      rowIndex,
      style,
      ariaAttributes,
      items,
      columnCount,
      itemWidth,
      itemHeight,
      gap
    }: CellComponentProps<TemplateCellData>) => {
      const index = rowIndex * columnCount + columnIndex;
      const cellStyle: React.CSSProperties = {
        ...style,
        width: itemWidth + gap,
        height: itemHeight + gap,
        paddingRight: gap,
        paddingBottom: gap,
        boxSizing: 'border-box'
      };
      if (index >= items.length) {
        return <div {...ariaAttributes} style={cellStyle} />;
      }
      const item = items[index];

      return (
        <div {...ariaAttributes} style={cellStyle}>
          <div style={{ width: itemWidth, height: itemHeight }}>
            <TemplateCard
              item={item}
              applyingId={applyingId}
              onPreview={setPreviewTemplate}
              onApply={applyTemplate}
            />
          </div>
        </div>
      );
    },
    [applyingId, applyTemplate]
  );

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

        <div className="flex-1 min-h-0 flex flex-col px-6 pb-6">
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

          <div className="mt-6 flex-1 min-h-0">
            {isDormant ? (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5">
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
              <div className={`h-full ${isFiltering ? 'opacity-70' : 'opacity-100'}`}>
                <AutoSizer
                  className="h-full w-full"
                  renderProp={({ width, height }) => {
                    if (!width || !height) {
                      const previewItems = filteredTemplates.slice(0, 24);
                      return (
                        <div className="h-full overflow-y-auto pr-1">
                          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5">
                            {previewItems.map((item) => (
                              <TemplateCard
                                key={item.id}
                                item={item}
                                applyingId={applyingId}
                                onPreview={setPreviewTemplate}
                                onApply={applyTemplate}
                              />
                            ))}
                          </div>
                          {filteredTemplates.length > previewItems.length && (
                            <div className="text-xs text-slate-400 text-center mt-3">
                              模板数量较多，等待布局完成后继续展示
                            </div>
                          )}
                        </div>
                      );
                    }
                    const columnCount = getTemplateColumnCount(width);
                    const gap = TEMPLATE_GAP;
                    const itemWidth = Math.floor((width - gap * columnCount) / columnCount);
                    const itemHeight = TEMPLATE_CARD_HEIGHT;
                    const rowCount = Math.ceil(filteredTemplates.length / columnCount);

                    const cellProps: TemplateCellData = {
                      items: filteredTemplates,
                      columnCount,
                      itemWidth,
                      itemHeight,
                      gap
                    };

                    return (
                      <Grid
                        columnCount={columnCount}
                        columnWidth={itemWidth + gap}
                        rowCount={rowCount}
                        rowHeight={itemHeight + gap}
                        cellComponent={TemplateCell}
                        cellProps={cellProps}
                        gridRef={gridRef}
                        overscanCount={2}
                        style={{ height, width }}
                      />
                    );
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </aside>

      <TemplatePreviewModal
        template={previewTemplate}
        onClose={() => setPreviewTemplate(null)}
        onUse={applyTemplate}
        applying={Boolean(applyingId)}
      />
    </>
  );
}
