import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Modal } from '../common/Modal';
import { GeneratedImage } from '../../types';
import { Button } from '../common/Button';
import { Download, Copy, Calendar, Box, Maximize2, X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Trash2, Check } from 'lucide-react';
import { formatDateTime } from '../../utils/date';
import { getImageDownloadUrl } from '../../services/api';
import { useHistoryStore } from '../../store/historyStore';
import { toast } from '../../store/toastStore';
import { useTranslation } from 'react-i18next';

interface ImagePreviewProps {
    image: (GeneratedImage & { model?: string }) | null;
    images?: GeneratedImage[]; // 传入图片列表用于切换
    onImageChange?: (image: GeneratedImage) => void; // 切换时的回调
    onClose: () => void;
}

// 使用 React.memo 优化，只有在关键 props 变化时才重新渲染
export const ImagePreview = React.memo(function ImagePreview({
    image,
    images = [],
    onImageChange,
    onClose
}: ImagePreviewProps) {
    const { t } = useTranslation();
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);
    const [isCopyingImage, setIsCopyingImage] = useState(false);
    const [fullImageLoaded, setFullImageLoaded] = useState(false);
    const [fullImageError, setFullImageError] = useState(false);
    const [isWheelZooming, setIsWheelZooming] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; adjusted: boolean } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const deleteConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const copySuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wheelZoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const hasNotifiedCopyRef = useRef(false); // 标记是否已提示过复制
    const contextMenuRef = useRef<HTMLDivElement>(null);

    const previewableImages = useMemo(
        () => images.filter((img) => Boolean(img.url || img.thumbnailUrl)),
        [images]
    );

    // 计算当前索引（只在可预览图片中切换）
    const currentIndex = image ? previewableImages.findIndex(img => img.id === image.id) : -1;
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex >= 0 && currentIndex < previewableImages.length - 1;

    // 重置缩放
    const handleReset = useCallback(() => {
        setScale(1);
        setPosition({ x: 0, y: 0 });
    }, []);

    // 处理图片切换
    const goToPrev = useCallback(() => {
        if (hasPrev && onImageChange) {
            onImageChange(previewableImages[currentIndex - 1]);
            handleReset();
        }
    }, [hasPrev, currentIndex, previewableImages, onImageChange, handleReset]);

    const goToNext = useCallback(() => {
        if (hasNext && onImageChange) {
            onImageChange(previewableImages[currentIndex + 1]);
            handleReset();
        }
    }, [hasNext, currentIndex, previewableImages, onImageChange, handleReset]);

    // 关闭弹窗（用 useCallback 保持引用稳定）
    const handleClose = useCallback(() => {
        onClose();
    }, [onClose]);

    // image 变化时确保重置加载状态（兼容外部直接切换 image 对象）
    useEffect(() => {
        setFullImageLoaded(false);
        setFullImageError(false);
        setContextMenu(null);
    }, [image?.id]);

    // 键盘监听 - 优化性能
    useEffect(() => {
        // 仅在弹窗打开时监听键盘，避免背景组件也响应方向键导致“叠一层弹窗”
        if (!image) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') goToPrev();
            if (e.key === 'ArrowRight') goToNext();
            if (e.key === 'Escape') handleClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [image, goToPrev, goToNext, handleClose]);

    // 监听图片复制事件（image 变化时重新绑定，避免首次挂载 imageRef 为空导致不生效）
    useEffect(() => {
        const img = imageRef.current;
        if (!img) return;

        const handleCopy = (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (!items) return;

            const hasImage = Array.from(items).some((it) => it.type.startsWith('image/'));
            if (hasImage && !hasNotifiedCopyRef.current) {
                hasNotifiedCopyRef.current = true;
                toast.success(t('toast.copyImageSuccess'));

                setTimeout(() => {
                    hasNotifiedCopyRef.current = false;
                }, 2000);
            }
        };

        img.addEventListener('copy', handleCopy, { capture: true });
        return () => img.removeEventListener('copy', handleCopy, { capture: true });
    }, [image?.id]);

    // 清理定时器
    useEffect(() => {
        return () => {
            if (deleteConfirmTimerRef.current) {
                clearTimeout(deleteConfirmTimerRef.current);
                deleteConfirmTimerRef.current = null;
            }
            if (copySuccessTimerRef.current) {
                clearTimeout(copySuccessTimerRef.current);
                copySuccessTimerRef.current = null;
            }
            if (wheelZoomTimerRef.current) {
                clearTimeout(wheelZoomTimerRef.current);
                wheelZoomTimerRef.current = null;
            }
        };
    }, []);

    // 处理删除图片
    const handleDelete = useCallback(async () => {
        if (!image) return;

        if (showDeleteConfirm) {
            // 确认删除
            setIsDeleting(true);
            try {
                const nextImage =
                    currentIndex >= 0
                        ? (previewableImages[currentIndex + 1] || previewableImages[currentIndex - 1])
                        : previewableImages[0];

                // 使用 store 中的统一删除入口（先本地移除，再刷新）
                await useHistoryStore.getState().deleteImage(image, { source: 'preview' });

                if (nextImage) {
                    onImageChange?.(nextImage);
                    handleReset();
                } else {
                    onClose();
                }
            } catch (error) {
                console.error('Delete image failed:', error);
                const errorMessage = error instanceof Error ? error.message : t('toast.deleteFailed');
                toast.error(errorMessage);
                // 删除失败时保持确认状态，允许用户重试
                setIsDeleting(false);
                // 不重置 showDeleteConfirm
                return;
            }
            // 成功后重置状态
            setIsDeleting(false);
            setShowDeleteConfirm(false);
        } else {
            // 显示确认状态
            setShowDeleteConfirm(true);
            // 清除之前的定时器（如果存在）
            if (deleteConfirmTimerRef.current) {
                clearTimeout(deleteConfirmTimerRef.current);
            }
            // 3秒后自动取消
            deleteConfirmTimerRef.current = setTimeout(() => setShowDeleteConfirm(false), 3000);
        }
    }, [image, showDeleteConfirm, onClose, currentIndex, previewableImages, onImageChange, handleReset]);

    // 取消删除确认
    const handleCancelDelete = useCallback(() => {
        setShowDeleteConfirm(false);
    }, []);

    // 处理复制图片
    const handleCopyImage = useCallback(async () => {
        if (!image) return;
        if (isCopyingImage) return;

        try {
            setIsCopyingImage(true);

            const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

            const guessMime = (pathOrUrl: string) => {
                const lower = pathOrUrl.toLowerCase();
                if (lower.endsWith('.png')) return 'image/png';
                if (lower.endsWith('.webp')) return 'image/webp';
                if (lower.endsWith('.gif')) return 'image/gif';
                return 'image/jpeg';
            };

            const getBestSrc = () => image.url || image.thumbnailUrl || '';

            // Tauri 打包环境下，Web Clipboard API 可能不可用/不稳定：优先走原生剪贴板写入
            if (isTauri) {
                try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    const candidates = [image.filePath, image.thumbnailPath].filter(Boolean) as string[];
                    const localPath = candidates.find((p) => p && !p.includes('://') && !p.startsWith('asset:')) || '';
                    if (localPath) {
                        await invoke('copy_image_to_clipboard', { path: localPath });
                        toast.success(t('toast.copyImageSuccess'));
                        return;
                    }
                } catch (err) {
                    console.warn('[copyImage] Native clipboard failed, fallback to web clipboard:', err);
                }
            }

            let blob: Blob | null = null;

            // 方案 A：Tauri 优先从本地文件读取，避免 asset/CORS 导致 fetch 失败
            if (isTauri) {
                try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    const { readFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');

                    const appDataDir = await invoke<string>('get_app_data_dir');
                    const appData = appDataDir.replace(/\\/g, '/').replace(/\/+$/, '');

                    const candidates = [image.filePath, image.thumbnailPath].filter(Boolean) as string[];
                    const pick = candidates.find((p) => p && !p.includes('://')) || '';

                    if (pick) {
                        const normalized = pick.replace(/\\/g, '/').replace(/\/+/g, '/');
                        const relative = normalized.startsWith(appData + '/') ? normalized.slice(appData.length + 1) : normalized.replace(/^\/+/, '');
                        const bytes = await readFile(relative, { baseDir: BaseDirectory.AppData });
                        blob = new Blob([bytes], { type: guessMime(pick) });
                    }
                } catch (err) {
                    console.warn('[copyImage] Tauri readFile failed, fallback to fetch:', err);
                }
            }

            // 方案 B：fetch 当前显示的 URL（适用于 http://asset.localhost 或普通 http/https）
            if (!blob) {
                const src = getBestSrc();
                if (!src) throw new Error(t('toast.imageSrcEmpty'));
                const response = await fetch(src, { cache: 'no-cache' });
                if (!response.ok) throw new Error(t('toast.imageFetchFailed', { status: response.status }));
                blob = await response.blob();
            }

            // 复制到剪贴板：优先复制图片，兜底复制链接
            const ClipboardItemCtor = (window as any).ClipboardItem as typeof ClipboardItem | undefined;
            if (ClipboardItemCtor && navigator.clipboard?.write) {
                const type = blob.type || guessMime(getBestSrc() || 'image.jpg');
                const item = new ClipboardItemCtor({ [type]: blob });
                try {
                    await navigator.clipboard.write([item]);
                    toast.success(t('toast.copyImageSuccess'));
                    return;
                } catch (err) {
                    console.warn('[copyImage] Web clipboard write(image) failed, fallback to writeText:', err);
                }
            }

            const src = getBestSrc();
            if (src && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(src);
                toast.info(t('toast.copyImageUnsupported'));
                return;
            }

            throw new Error('Clipboard API not available');
        } catch (error) {
            console.error('Copy image failed:', error);
            // 最后兜底：尝试复制链接（避免用户“完全失败”）
            try {
                const src = image.url || image.thumbnailUrl || '';
                if (src && navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(src);
                    toast.info(t('toast.copyImageFallback'));
                    return;
                }
            } catch {}
            toast.error(t('toast.copyImageFailed'));
        } finally {
            setIsCopyingImage(false);
        }
    }, [image, isCopyingImage]);

    // 处理复制提示词 - 优先使用同步方案，速度最快
    const handleCopyPrompt = useCallback(() => {
        if (!image?.prompt) return;

        // 清除之前的定时器
        if (copySuccessTimerRef.current) {
            clearTimeout(copySuccessTimerRef.current);
        }

        // 方案1: 同步的 document.execCommand (最快，立即返回)
        const textArea = document.createElement('textarea');
        textArea.value = image.prompt;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();

        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);

        if (successful) {
            // 成功：立即显示状态（真实成功，不是乐观更新）
            setCopySuccess(true);
            toast.success(t('toast.copyPromptSuccess'));

            copySuccessTimerRef.current = setTimeout(() => {
                setCopySuccess(false);
            }, 2000);
        } else {
            // 方案1失败，尝试方案2: Clipboard API
            navigator.clipboard.writeText(image.prompt)
                .then(() => {
                    setCopySuccess(true);
                    toast.success(t('toast.copyPromptSuccess'));

                    copySuccessTimerRef.current = setTimeout(() => {
                        setCopySuccess(false);
                    }, 2000);
                })
                .catch((err) => {
                    console.error('Copy failed:', err);
                    toast.error(t('toast.copyFailedManual'));
                });
        }
    }, [image?.prompt]);

    const copyText = useCallback(async (text: string) => {
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
    }, []);

    const performZoom = (newScale: number, centerX?: number, centerY?: number) => {
        if (!containerRef.current) return;
        const oldScale = scale;
        const rect = containerRef.current.getBoundingClientRect();
        const cx = centerX ?? rect.width / 2;
        const cy = centerY ?? rect.height / 2;
        const ratio = newScale / oldScale;
        const dx = (cx - rect.width / 2 - position.x);
        const dy = (cy - rect.height / 2 - position.y);
        const newX = position.x - dx * (ratio - 1);
        const newY = position.y - dy * (ratio - 1);
        setScale(newScale);
        setPosition({ x: newX, y: newY });
    };

    const handleWheel = (e: React.WheelEvent) => {
        const speed = e.ctrlKey ? 0.05 : 0.002;
        const delta = -e.deltaY * speed;
        const newScale = Math.min(Math.max(0.25, scale + delta), 10);
        if (newScale !== scale) {
            const rect = containerRef.current!.getBoundingClientRect();
            performZoom(newScale, e.clientX - rect.left, e.clientY - rect.top);
            setIsWheelZooming(true);
            if (wheelZoomTimerRef.current) {
                clearTimeout(wheelZoomTimerRef.current);
            }
            wheelZoomTimerRef.current = setTimeout(() => {
                setIsWheelZooming(false);
            }, 120);
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        // 点击在右键菜单内部：不触发“关闭菜单/拖拽”逻辑，避免按钮 click 被提前卸载
        if (contextMenuRef.current && contextMenuRef.current.contains(e.target as Node)) return;
        // 仅允许鼠标左键拖拽（右键/中键不进入拖拽，避免弹出菜单后“拖拽卡住”）
        if (e.button !== 0) return;
        // 右键菜单打开时，左键点击优先用于关闭菜单，不触发拖拽
        if (contextMenu) {
            setContextMenu(null);
            return;
        }
        setContextMenu(null);
        setIsDragging(true);
        setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        // 兼容：如果已经不按住左键，立即结束拖拽（避免 mouseup 丢失导致一直拖）
        if (isDragging && (e.buttons & 1) !== 1) {
            setIsDragging(false);
            return;
        }
        if (isDragging && containerRef.current) {
            let newX = e.clientX - dragStart.x;
            let newY = e.clientY - dragStart.y;
            const rect = containerRef.current.getBoundingClientRect();
            const limitX = (rect.width * scale) / 2;
            const limitY = (rect.height * scale) / 2;
            newX = Math.min(Math.max(newX, -limitX), limitX);
            newY = Math.min(Math.max(newY, -limitY), limitY);
            setPosition({ x: newX, y: newY });
        }
    };

    const handleOpenContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        // React MouseEvent 的 button: 2 为右键；这里不强依赖，所有 contextmenu 都走自定义菜单
        setContextMenu({ x: e.clientX, y: e.clientY, adjusted: false });
    };

    // 右键菜单：点击外部/滚动/缩放/ESC 时关闭
    useEffect(() => {
        if (!contextMenu) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setContextMenu(null);
        };

        const onPointerDown = (e: MouseEvent) => {
            const menuEl = contextMenuRef.current;
            if (menuEl && menuEl.contains(e.target as Node)) return;
            setContextMenu(null);
        };

        const onScroll = () => setContextMenu(null);
        const onResize = () => setContextMenu(null);

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('mousedown', onPointerDown, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('mousedown', onPointerDown, true);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
        };
    }, [contextMenu]);

    // 右键菜单：防止出屏（第一次渲染后修正位置）
    useEffect(() => {
        if (!contextMenu || contextMenu.adjusted) return;
        const menuEl = contextMenuRef.current;
        if (!menuEl) return;

        const rect = menuEl.getBoundingClientRect();
        const padding = 8;

        let nextX = contextMenu.x;
        let nextY = contextMenu.y;
        if (nextX + rect.width + padding > window.innerWidth) nextX = window.innerWidth - rect.width - padding;
        if (nextY + rect.height + padding > window.innerHeight) nextY = window.innerHeight - rect.height - padding;
        nextX = Math.max(padding, nextX);
        nextY = Math.max(padding, nextY);

        setContextMenu({ x: nextX, y: nextY, adjusted: true });
    }, [contextMenu]);

    const handleCopyImagePath = useCallback(async () => {
        if (!image) return;

        const candidates = [image.filePath, image.thumbnailPath].filter(Boolean) as string[];
        let path = candidates.find((p) => typeof p === 'string' && p.trim())?.trim() || '';

        if (!path) {
            toast.info(t('toast.imagePathEmpty'));
            return;
        }

        const isUrl = /^(https?:|asset:|tauri:|ipc:|blob:|data:)/i.test(path);
        if (isUrl) {
            toast.info(t('toast.noLocalPath'));
            return;
        }

        if (path.startsWith('file://')) {
            try {
                const withoutScheme = path.replace(/^file:\/\//, '');
                const withoutHost = withoutScheme.replace(/^localhost\//, '');
                path = decodeURIComponent(withoutHost);
            } catch {}
        }

        const isWindowsAbsolute = /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\');
        const isPosixAbsolute = path.startsWith('/');
        const isAbsolute = isWindowsAbsolute || isPosixAbsolute;

        if (!isAbsolute && typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const appDataDir = await invoke<string>('get_app_data_dir');
                if (appDataDir) {
                    const separator = appDataDir.includes('\\') ? '\\' : '/';
                    const base = appDataDir.endsWith('/') || appDataDir.endsWith('\\')
                        ? appDataDir.slice(0, -1)
                        : appDataDir;
                    const trimmed = path.replace(/^[/\\]+/, '');
                    path = `${base}${separator}${trimmed}`;
                }
            } catch (err) {
                console.warn('[copyImagePath] resolve appDataDir failed:', err);
            }
        }

        if (!path) {
            toast.info(t('toast.noLocalPath'));
            return;
        }

        const ok = await copyText(path);
        if (ok) toast.success(t('toast.imagePathCopied'));
        else toast.error(t('toast.copyFailed'));
    }, [copyText, image]);

    const handleDownload = useCallback(() => {
        if (!image?.id) return;
        window.location.href = getImageDownloadUrl(image.id);
    }, [image?.id]);

    if (!image) return null;

    return (
        <Modal 
            isOpen={!!image} 
            onClose={onClose} 
            hideHeader={true} 
            variant="unstyled"
            className="max-w-[95vw] md:max-w-7xl h-[90vh] md:h-[90vh] flex flex-col pointer-events-none p-0 overflow-visible"
        >
            <div className="bg-white rounded-xl shadow-2xl overflow-hidden w-full h-full flex flex-col md:flex-row pointer-events-auto relative">
                
                {/* 侧边导航按钮 - 左 */}
                {hasPrev && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); goToPrev(); }}
                        className="absolute left-4 sm:left-6 top-1/2 -translate-y-1/2 z-30 p-3 sm:p-4 bg-black/40 hover:bg-black/60 text-white rounded-full border border-white/20 backdrop-blur-md transition-all active:scale-90 group"
                    >
                        <ChevronLeft className="w-6 h-6 sm:w-8 sm:h-8 group-hover:-translate-x-1 transition-transform" strokeWidth={3} />
                    </button>
                )}

                {/* 侧边导航按钮 - 右 (桌面端位置) */}
                {hasNext && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); goToNext(); }}
                        className="absolute right-[432px] top-1/2 -translate-y-1/2 z-30 p-4 bg-black/40 hover:bg-black/60 text-white rounded-full border border-white/20 backdrop-blur-md transition-all active:scale-90 group hidden md:block"
                    >
                        <ChevronRight className="w-8 h-8 group-hover:translate-x-1 transition-transform" strokeWidth={3} />
                    </button>
                )}

                {/* 侧边导航按钮 - 右 (移动端位置) */}
                {hasNext && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); goToNext(); }}
                        className="absolute right-4 sm:right-6 top-1/2 -translate-y-1/2 z-30 p-3 sm:p-4 bg-black/40 hover:bg-black/60 text-white rounded-full border border-white/20 backdrop-blur-md transition-all active:scale-90 md:hidden"
                    >
                        <ChevronRight className="w-6 h-6 sm:w-8 sm:h-8" strokeWidth={3} />
                    </button>
                )}

                {/* 左侧：图片展示区 (移动端改为 50% 高度或自适应) */}
                <div 
                    ref={containerRef}
                    className="flex-1 bg-slate-50 relative min-h-[50vh] md:min-h-full overflow-hidden cursor-grab active:cursor-grabbing"
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={() => setIsDragging(false)}
                    onMouseLeave={() => setIsDragging(false)}
                >
                    <div className="absolute inset-0 z-0 pointer-events-none select-none">
                        <img 
                            src={image.thumbnailUrl || image.url} 
                            alt="" 
                            className="w-full h-full object-cover opacity-30 blur-3xl scale-110 transition-opacity duration-700" 
                            decoding="async"
                        />
                        <div className="absolute inset-0 bg-white/10" />
                    </div>

                    {/* 右上角操作区：复制/关闭/缩放比例（不随图片缩放） */}
                    <div className="absolute top-4 right-4 z-50 flex flex-col items-end gap-2 pointer-events-auto">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleCopyImage();
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            disabled={!image.url && !image.thumbnailUrl && !image.filePath && !image.thumbnailPath}
                            className={`
                                px-3 py-2 bg-black/60 hover:bg-black/75 text-white rounded-xl shadow-xl border border-white/15 backdrop-blur-md transition-all active:scale-95
                                flex items-center gap-2
                                disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-black/60
                            `}
                            title={t('preview.copyImage')}
                            style={{ WebkitAppRegion: 'no-drag' } as any}
                        >
                            {isCopyingImage ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Copy className="w-4 h-4" />
                            )}
                            <span className="hidden sm:inline text-[11px] font-black pr-1">{t('preview.copyImage')}</span>
                        </button>

                        {scale !== 1 && (
                            <div className="bg-black/70 backdrop-blur-md text-white text-[10px] px-2.5 py-1 rounded-full font-bold">
                                {Math.round(scale * 100)}%
                            </div>
                        )}
                    </div>

                    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 p-1.5 bg-white/90 backdrop-blur-xl border border-white/50 rounded-2xl shadow-2xl">
                        <button onClick={() => performZoom(Math.max(0.25, scale - 0.25))} className="p-2.5 hover:bg-white rounded-xl transition-all text-slate-600"><ZoomOut className="w-4 h-4" /></button>
                        <div className="w-px h-4 bg-slate-200 mx-1" />
                        <button onClick={handleReset} className="px-4 py-1.5 hover:bg-white rounded-xl transition-all text-slate-700 text-[11px] font-black">{Math.round(scale * 100)}%</button>
                        <div className="w-px h-4 bg-slate-200 mx-1" />
                        <button onClick={() => performZoom(Math.min(10, scale + 0.25))} className="p-2.5 hover:bg-white rounded-xl transition-all text-slate-600"><ZoomIn className="w-4 h-4" /></button>
                    </div>

                    <div
                        className="relative z-10 w-full h-full flex items-center justify-center select-none p-5 md:p-7"
                        style={{
                            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                            transition: isDragging || isWheelZooming ? 'none' : 'transform 0.15s cubic-bezier(0.2, 0, 0.2, 1)',
                            willChange: isDragging || isWheelZooming ? 'transform' : undefined
                        }}
                        onContextMenu={handleOpenContextMenu}
                    >


                        {/* 缩略图占位 (模糊) */}
                        {!fullImageLoaded && (
                            <img 
                                src={image.thumbnailUrl || image.url} 
                                alt="" 
                                className={`max-w-full max-h-full object-contain absolute ${
                                  fullImageError ? 'opacity-100 scale-100' : 'blur-lg scale-95 opacity-50'
                                }`} 
                                decoding="async"
                                draggable={false} 
                            />
                        )}
                        
                        {/* 高清大图 */}
                        <img 
                            ref={imageRef} 
                            src={image.url} 
                            alt={image.prompt} 
                            onLoad={() => setFullImageLoaded(true)}
                            onError={() => setFullImageError(true)}
                            className={`max-w-full max-h-full object-contain shadow-2xl rounded-lg transition-all duration-500 ${fullImageLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
                            decoding="async"
                            draggable={false} 
                        />

                        {/* 加载指示器 */}
                        {!fullImageLoaded && !fullImageError && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin shadow-lg" />
                            </div>
                        )}

                        {/* 加载失败提示 */}
                        {fullImageError && !fullImageLoaded && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="px-4 py-2 rounded-xl bg-black/70 text-white text-xs font-bold backdrop-blur-md">
                                    {t('preview.imageLoadFailed')}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 自定义右键菜单（替代系统英文菜单） */}
                    {contextMenu && (
                        <div
                            ref={contextMenuRef}
                            className="fixed z-[1000] min-w-[180px] bg-white/95 backdrop-blur-xl border border-slate-200/70 rounded-2xl shadow-[0_18px_60px_-18px_rgba(0,0,0,0.35)] overflow-hidden"
                            style={{ left: contextMenu.x, top: contextMenu.y }}
                            role="menu"
                            aria-label={t('preview.menu.label')}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => {
                                // 防止 mousedown 冒泡到图片容器导致先关闭菜单，从而 click 不触发
                                e.stopPropagation();
                            }}
                            onContextMenu={(e) => {
                                // 菜单区域内右键不再触发新的菜单
                                e.preventDefault();
                                e.stopPropagation();
                            }}
                        >
                            <button
                                type="button"
                                className="w-full px-4 py-3 flex items-center gap-3 text-sm font-bold text-slate-800 hover:bg-slate-100/70 transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setContextMenu(null);
                                    handleCopyImage();
                                }}
                                role="menuitem"
                            >
                                <Copy className="w-4 h-4 text-slate-600" />
                                {t('preview.menu.copyImage')}
                            </button>
                            <button
                                type="button"
                                className="w-full px-4 py-3 flex items-center gap-3 text-sm font-bold text-slate-800 hover:bg-slate-100/70 transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setContextMenu(null);
                                handleCopyImagePath();
                                }}
                                role="menuitem"
                            >
                                <Copy className="w-4 h-4 text-slate-600" />
                                {t('preview.menu.copyImagePath')}
                            </button>
                            <div className="h-px bg-slate-200/60" />
                            <button
                                type="button"
                                className="w-full px-4 py-3 flex items-center gap-3 text-sm font-bold text-slate-800 hover:bg-slate-100/70 transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setContextMenu(null);
                                    handleDownload();
                                }}
                                role="menuitem"
                            >
                                <Download className="w-4 h-4 text-slate-600" />
                                {t('preview.menu.downloadOriginal')}
                            </button>
                            <button
                                type="button"
                                className="w-full px-4 py-3 flex items-center gap-3 text-sm font-bold text-slate-800 hover:bg-slate-100/70 transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setContextMenu(null);
                                    handleReset();
                                }}
                                role="menuitem"
                            >
                                <Maximize2 className="w-4 h-4 text-slate-600" />
                                {t('preview.menu.resetZoom')}
                            </button>
                        </div>
                    )}
                </div>

                {/* 右侧：信息详情区 */}
                <div className="w-full md:w-[400px] flex-shrink-0 bg-white border-l border-slate-100 flex flex-col h-full relative z-20">
                    <div className="flex-1 flex flex-col min-h-0 p-8 pb-4">
                        {/* 标题和按钮行 */}
                        <div className="flex items-center justify-between mb-6 flex-shrink-0 gap-4">
                            <h2 className="text-xl font-black text-slate-900 leading-none">{t('preview.title')}</h2>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                {/* 删除按钮 */}
                                <button
                                    onClick={handleDelete}
                                    disabled={isDeleting}
                                    className={`
                                        inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition-all duration-200
                                        px-4 py-2 text-sm leading-none
                                        ${showDeleteConfirm
                                            ? 'bg-red-600 text-white hover:bg-red-700 shadow-md shadow-red-200'
                                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 shadow-sm'
                                        }
                                        active:scale-95
                                        ${isDeleting ? 'opacity-50 cursor-not-allowed' : ''}
                                    `}
                                    title={showDeleteConfirm ? t('preview.delete.confirmTitle') : t('preview.delete.title')}
                                >
                                    {isDeleting ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            {t('preview.delete.deleting')}
                                        </>
                                    ) : showDeleteConfirm ? (
                                        <>
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                            {t('preview.delete.confirmLabel')}
                                        </>
                                    ) : (
                                        <>
                                            <Trash2 className="w-4 h-4" />
                                            {t('preview.delete.action')}
                                        </>
                                    )}
                                </button>
                                {/* 取消删除按钮 - 只在确认状态时显示 */}
                                {showDeleteConfirm && (
                                    <button
                                        onClick={handleCancelDelete}
                                        className="inline-flex items-center justify-center rounded-2xl font-bold transition-all duration-200 px-4 py-2 text-sm leading-none bg-slate-100 text-slate-700 hover:bg-slate-200 shadow-sm active:scale-95"
                                        title={t('common.cancel')}
                                    >
                                        {t('common.cancel')}
                                    </button>
                                )}
                                {/* 关闭按钮 */}
                                <button onClick={onClose} className="text-slate-400 hover:text-slate-900 p-1 transition-colors">
                                    <X className="w-6 h-6" />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 flex flex-col min-h-0">
                            <div className="flex items-center justify-between mb-3 flex-shrink-0">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">{t('preview.prompt.label')}</h3>
                                <button
                                    onClick={handleCopyPrompt}
                                    disabled={!image.prompt}
                                    className={`
                                        text-xs font-bold flex items-center gap-1.5 py-1 px-2 rounded-lg transition-all
                                        ${!image.prompt
                                            ? 'text-slate-400 cursor-not-allowed bg-slate-50'
                                            : copySuccess
                                                ? 'text-green-600 bg-green-50'
                                                : 'text-blue-600 hover:text-blue-700 hover:bg-blue-50'
                                        }
                                    `}
                                >
                                    {copySuccess ? (
                                        <>
                                            <Check className="w-3.5 h-3.5" /> {t('preview.prompt.copied')}
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="w-3.5 h-3.5" /> {t('common.copy')}
                                        </>
                                    )}
                                </button>
                            </div>
                            <div className="flex-1 bg-slate-50 p-5 rounded-2xl border border-slate-100 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap overflow-y-auto scrollbar-thin">
                                {image.prompt || t('preview.prompt.empty')}
                            </div>
                        </div>
                    </div>

                    <div className="flex-shrink-0">
                        <div className="px-8 py-5 space-y-4 border-t border-slate-50 bg-white">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-400 font-medium flex items-center gap-2.5"><Box className="w-4 h-4" /> {t('preview.meta.model')}</span>
                                <span className="font-bold text-slate-900 truncate max-w-[200px]">{image.model || t('preview.meta.unknown')}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-400 font-medium flex items-center gap-2.5"><Maximize2 className="w-4 h-4" /> {t('preview.meta.size')}</span>
                                <span className="font-bold text-slate-900 font-mono">{image.width || 0} × {image.height || 0}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-400 font-medium flex items-center gap-2.5"><Calendar className="w-4 h-4" /> {t('preview.meta.time')}</span>
                                <span className="font-bold text-slate-900">{formatDateTime(image.createdAt || '')}</span>
                            </div>
                        </div>
                        <div className="p-8 pt-3">
                            <Button className="w-full h-14 bg-slate-900 hover:bg-black text-white" onClick={handleDownload}>
                                <Download className="w-5 h-5 mr-3" /> {t('preview.downloadOriginal')}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
});
