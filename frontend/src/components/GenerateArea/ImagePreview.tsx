import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Modal } from '../common/Modal';
import { GeneratedImage } from '../../types';
import { Button } from '../common/Button';
import { Download, Copy, Calendar, Box, Maximize2, X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Trash2, Check } from 'lucide-react';
import { formatDateTime } from '../../utils/date';
import { getImageDownloadUrl } from '../../services/api';
import { useHistoryStore } from '../../store/historyStore';
import { toast } from '../../store/toastStore';

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
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const deleteConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const copySuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const hasNotifiedCopyRef = useRef(false); // 标记是否已提示过复制

    // 计算当前索引
    const currentIndex = image ? images.findIndex(img => img.id === image.id) : -1;
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < images.length - 1;

    // 重置缩放
    const handleReset = useCallback(() => {
        setScale(1);
        setPosition({ x: 0, y: 0 });
    }, []);

    // 处理图片切换
    const goToPrev = useCallback(() => {
        if (hasPrev && onImageChange) {
            onImageChange(images[currentIndex - 1]);
            handleReset();
        }
    }, [hasPrev, currentIndex, images, onImageChange, handleReset]);

    const goToNext = useCallback(() => {
        if (hasNext && onImageChange) {
            onImageChange(images[currentIndex + 1]);
            handleReset();
        }
    }, [hasNext, currentIndex, images, onImageChange, handleReset]);

    // 关闭弹窗（用 useCallback 保持引用稳定）
    const handleClose = useCallback(() => {
        onClose();
    }, [onClose]);

    // 键盘监听 - 优化性能
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') goToPrev();
            if (e.key === 'ArrowRight') goToNext();
            if (e.key === 'Escape') handleClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [goToPrev, goToNext, handleClose]);

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
                toast.success('图片已复制到剪贴板');

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
        };
    }, []);

    // 处理删除图片
    const handleDelete = useCallback(async () => {
        if (!image) return;

        if (showDeleteConfirm) {
            // 确认删除
            setIsDeleting(true);
            try {
                // 使用 store 中的删除方法（先本地移除，再刷新）
                await useHistoryStore.getState().deleteImage(image.id, image.taskId);

                // 删除成功后，尝试切换到下一张/上一张图片
                if (hasNext) {
                    // 优先切换到下一张
                    onImageChange?.(images[currentIndex + 1]);
                    handleReset();
                } else if (hasPrev) {
                    // 没有下一张，切换到上一张
                    onImageChange?.(images[currentIndex - 1]);
                    handleReset();
                } else {
                    // 只有一张图片，关闭弹窗
                    onClose();
                }
            } catch (error) {
                console.error('删除图片失败:', error);
                const errorMessage = error instanceof Error ? error.message : '删除失败';
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
    }, [image, showDeleteConfirm, onClose, hasNext, hasPrev, currentIndex, images, onImageChange, handleReset]);

    // 取消删除确认
    const handleCancelDelete = useCallback(() => {
        setShowDeleteConfirm(false);
    }, []);

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
            toast.success('提示词已复制到剪贴板');

            copySuccessTimerRef.current = setTimeout(() => {
                setCopySuccess(false);
            }, 2000);
        } else {
            // 方案1失败，尝试方案2: Clipboard API
            navigator.clipboard.writeText(image.prompt)
                .then(() => {
                    setCopySuccess(true);
                    toast.success('提示词已复制到剪贴板');

                    copySuccessTimerRef.current = setTimeout(() => {
                        setCopySuccess(false);
                    }, 2000);
                })
                .catch((err) => {
                    console.error('复制失败:', err);
                    toast.error('复制失败，请手动复制');
                });
        }
    }, [image?.prompt]);

    if (!image) return null;

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
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
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

    return (
        <Modal 
            isOpen={!!image} 
            onClose={onClose} 
            hideHeader={true} 
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

                {/* 移动端顶部关闭按钮 */}
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 z-40 p-2 bg-black/40 text-white rounded-full backdrop-blur-md md:hidden transition-all active:scale-90"
                >
                    <X className="w-5 h-5" />
                </button>

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
                            src={image.url}
                            alt=""
                            className="w-full h-full object-cover opacity-30 blur-3xl scale-110"
                            decoding="async"
                        />
                        <div className="absolute inset-0 bg-white/10" />
                    </div>

                    {scale !== 1 && (
                        <div className="absolute top-6 right-6 z-20 bg-black/70 backdrop-blur-md text-white text-[10px] px-2.5 py-1 rounded-full font-bold">
                            {Math.round(scale * 100)}%
                        </div>
                    )}

                    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 p-1.5 bg-white/90 backdrop-blur-xl border border-white/50 rounded-2xl shadow-2xl">
                        <button onClick={() => performZoom(Math.max(0.25, scale - 0.25))} className="p-2.5 hover:bg-white rounded-xl transition-all text-slate-600"><ZoomOut className="w-4 h-4" /></button>
                        <div className="w-px h-4 bg-slate-200 mx-1" />
                        <button onClick={handleReset} className="px-4 py-1.5 hover:bg-white rounded-xl transition-all text-slate-700 text-[11px] font-black">{Math.round(scale * 100)}%</button>
                        <div className="w-px h-4 bg-slate-200 mx-1" />
                        <button onClick={() => performZoom(Math.min(10, scale + 0.25))} className="p-2.5 hover:bg-white rounded-xl transition-all text-slate-600"><ZoomIn className="w-4 h-4" /></button>
                    </div>

                    <div
                        className="relative z-10 w-full h-full flex items-center justify-center select-none"
                        style={{
                            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                            transition: isDragging ? 'none' : 'transform 0.15s cubic-bezier(0.2, 0, 0.2, 1)'
                        }}
                    >
                        <img
                            ref={imageRef}
                            src={image.url}
                            alt={image.prompt}
                            className="max-w-full max-h-full object-contain shadow-2xl rounded-lg"
                            decoding="async"
                            draggable={false}
                        />
                    </div>
                </div>

                {/* 右侧：信息详情区 */}
                <div className="w-full md:w-[400px] flex-shrink-0 bg-white border-l border-slate-100 flex flex-col h-full relative z-20">
                    <div className="flex-1 flex flex-col min-h-0 p-8 pb-4">
                        {/* 标题和按钮行 */}
                        <div className="flex items-center justify-between mb-6 flex-shrink-0 gap-4">
                            <h2 className="text-xl font-black text-slate-900 leading-none">生成详情</h2>
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
                                    title={showDeleteConfirm ? '再次点击确认删除' : '删除图片'}
                                >
                                    {isDeleting ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            删除中...
                                        </>
                                    ) : showDeleteConfirm ? (
                                        <>
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                            确认?
                                        </>
                                    ) : (
                                        <>
                                            <Trash2 className="w-4 h-4" />
                                            删除
                                        </>
                                    )}
                                </button>
                                {/* 取消删除按钮 - 只在确认状态时显示 */}
                                {showDeleteConfirm && (
                                    <button
                                        onClick={handleCancelDelete}
                                        className="inline-flex items-center justify-center rounded-2xl font-bold transition-all duration-200 px-4 py-2 text-sm leading-none bg-slate-100 text-slate-700 hover:bg-slate-200 shadow-sm active:scale-95"
                                        title="取消"
                                    >
                                        取消
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
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">提示词 (Prompt)</h3>
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
                                            <Check className="w-3.5 h-3.5" /> 已复制
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="w-3.5 h-3.5" /> 复制
                                        </>
                                    )}
                                </button>
                            </div>
                            <div className="flex-1 bg-slate-50 p-5 rounded-2xl border border-slate-100 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap overflow-y-auto scrollbar-thin">
                                {image.prompt || "暂无提示词"}
                            </div>
                        </div>
                    </div>

                    <div className="flex-shrink-0">
                        <div className="px-8 py-5 space-y-4 border-t border-slate-50 bg-white">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-400 font-medium flex items-center gap-2.5"><Box className="w-4 h-4" /> 模型</span>
                                <span className="font-bold text-slate-900 truncate max-w-[200px]">{image.model || "未知"}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-400 font-medium flex items-center gap-2.5"><Maximize2 className="w-4 h-4" /> 尺寸</span>
                                <span className="font-bold text-slate-900 font-mono">{image.width || 0} × {image.height || 0}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-400 font-medium flex items-center gap-2.5"><Calendar className="w-4 h-4" /> 时间</span>
                                <span className="font-bold text-slate-900">{formatDateTime(image.createdAt || '')}</span>
                            </div>
                        </div>
                        <div className="p-8 pt-3">
                            <Button className="w-full h-14 bg-slate-900 hover:bg-black text-white" onClick={() => window.location.href = getImageDownloadUrl(image.id)}>
                                <Download className="w-5 h-5 mr-3" /> 下载高清原图
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
});
