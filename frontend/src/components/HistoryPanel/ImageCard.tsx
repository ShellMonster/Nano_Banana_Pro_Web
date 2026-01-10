import React, { useCallback, useRef, useEffect } from 'react';
import { Trash2, GripVertical } from 'lucide-react';
import { FlattenedImage } from './HistoryList';
import { formatDateTime } from '../../utils/date';
import { toast } from '../../store/toastStore';
import { useHistoryStore } from '../../store/historyStore';

interface ImageCardProps {
    image: FlattenedImage;
    onClick: (image: FlattenedImage) => void;
}

// 使用 React.memo 防止不必要的重渲染
export const ImageCard = React.memo(function ImageCard({ image, onClick }: ImageCardProps) {
    const [isDeleting, setIsDeleting] = React.useState(false);
    const [showConfirm, setShowConfirm] = React.useState(false);
    const confirmTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const imgRef = React.useRef<HTMLImageElement>(null);
    const hasNotifiedCopyRef = React.useRef(false); // 标记是否已提示过复制

    // 清理定时器
    useEffect(() => {
        return () => {
            if (confirmTimerRef.current) {
                clearTimeout(confirmTimerRef.current);
                confirmTimerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (confirmTimerRef.current) {
            clearTimeout(confirmTimerRef.current);
            confirmTimerRef.current = null;
        }
        setShowConfirm(false);
        setIsDeleting(false);
        hasNotifiedCopyRef.current = false;
    }, [image.id]);

    // 监听复制事件，当用户右键复制图片时显示提示
    useEffect(() => {
        const img = imgRef.current;
        if (!img) return;

        const handleCopy = (e: ClipboardEvent) => {
            // 检查剪贴板中是否有图片数据
            const items = e.clipboardData?.items;
            if (!items) return;

            let hasImage = false;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.startsWith('image/')) {
                    hasImage = true;
                    break;
                }
            }

            // 如果复制了图片，显示提示
            if (hasImage && !hasNotifiedCopyRef.current) {
                hasNotifiedCopyRef.current = true;
                toast.success('图片已复制到剪贴板');

                // 2秒后重置标记，允许下次复制时再次提示
                setTimeout(() => {
                    hasNotifiedCopyRef.current = false;
                }, 2000);
            }
        };

        // 监听 copy 事件（使用捕获阶段，确保能检测到）
        img.addEventListener('copy', handleCopy, { capture: true });

        return () => {
            img.removeEventListener('copy', handleCopy, { capture: true });
        };
    }, []);

    const handleClick = useCallback(() => {
        onClick(image);
    }, [image.id, onClick]);

    const handleCancelConfirm = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setShowConfirm(false);
    }, []);

    const handleDelete = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();

        if (showConfirm) {
            setIsDeleting(true);
            try {
                // 使用 store 中的删除方法（先本地移除，再刷新）
                await useHistoryStore.getState().deleteImage(image.id, image.taskId);
                // 成功后重置状态
                setIsDeleting(false);
                setShowConfirm(false);
            } catch (error) {
                console.error('删除图片失败:', error);
                // 删除失败时保持确认状态，允许用户重试
                setIsDeleting(false);
                // 不重置 showConfirm，让用户可以直接重试
            }
        } else {
            setShowConfirm(true);
            if (confirmTimerRef.current) {
                clearTimeout(confirmTimerRef.current);
            }
            confirmTimerRef.current = setTimeout(() => setShowConfirm(false), 3000);
        }
    }, [showConfirm, image.id, image.taskId]);

    // 拖拽开始处理
    const handleDragStart = useCallback(async (e: React.DragEvent) => {
        // 设置拖拽数据
        e.dataTransfer.effectAllowed = 'copy';

        // 尝试使用多种方式设置数据，提高兼容性
        if (image.url) {
          e.dataTransfer.setData('application/x-image-url', image.url);
          e.dataTransfer.setData('text/uri-list', image.url); // 备用：标准MIME类型
        }
        e.dataTransfer.setData('application/x-image-name', `ref-${image.id || 'unknown'}.jpg`);

        // 设置拖拽图像为当前图片
        if (imgRef.current) {
            e.dataTransfer.setDragImage(imgRef.current, 40, 40);
        }

        // 尝试从已加载的图片获取 Blob 数据，避免 CORS 问题
        if (imgRef.current && imgRef.current.complete) {
            try {
                // 使用 canvas 获取图片数据
                const canvas = document.createElement('canvas');
                canvas.width = imgRef.current.naturalWidth;
                canvas.height = imgRef.current.naturalHeight;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(imgRef.current, 0, 0);
                    // 转换为 blob
                    canvas.toBlob((blob) => {
                        if (blob) {
                            // 创建文件对象并存储在 dataTransfer 中
                            // 注意：这种方式不直接存储在 dataTransfer 中，而是通过 Symbol 传递避免污染全局
                            const dragBlobSymbol = Symbol.for('__dragImageBlob');
                            (window as any)[dragBlobSymbol] = {
                                blob: blob,
                                name: `ref-${image.id}.jpg`,
                                id: image.id
                            };
                            e.dataTransfer.setData('application/x-has-blob', 'true');
                        }
                    }, 'image/jpeg', 0.9);
                }
            } catch (err) {
                // 忽略错误
            }
        }
    }, [image.url, image.id]);

    // 拖拽结束处理 - 延迟清理缓存
    const handleDragEnd = useCallback(() => {
        // 延迟清理缓存，给 drop 处理器足够的时间读取
        setTimeout(() => {
            const dragBlobSymbol = Symbol.for('__dragImageBlob');
            delete (window as any)[dragBlobSymbol];
        }, 100);
    }, []);

    return (
        <div
            className="bg-white rounded-xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-md cursor-pointer group relative flex flex-col"
            style={{ contentVisibility: 'auto', containIntrinsicSize: '240px 320px' }}
            onClick={handleClick}
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            {/* 拖拽指示器 - 左上角 */}
            <div className="absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <div className="bg-black/20 backdrop-blur-sm rounded-lg p-1.5">
                    <GripVertical className="w-3 h-3 sm:w-4 sm:h-4 text-gray-600" />
                </div>
            </div>

            {/* 删除按钮 - 纯 CSS hover，不依赖 JavaScript */}
            {/* 正常状态：CSS 控制显隐 */}
            {!showConfirm && (
                <div
                    className={`
                        absolute top-2 right-2 z-20
                        transition-opacity duration-100 ease-out
                        opacity-0
                        group-hover:opacity-100
                        pointer-events-none
                    `}
                >
                    <button
                        onClick={handleDelete}
                        disabled={isDeleting}
                        className={`
                            rounded-full flex items-center justify-center shadow-lg
                            transition-all duration-200
                            bg-red-500 hover:bg-red-600 text-white w-7 h-7 sm:w-8 sm:h-8
                            ${isDeleting ? 'opacity-50 cursor-not-allowed' : ''}
                            pointer-events-auto
                        `}
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

            {/* 确认状态：强制显示确认按钮，覆盖 CSS hover */}
            {showConfirm && (
                <div className="absolute top-2 right-2 z-20 pointer-events-none">
                    <button
                        onClick={handleDelete}
                        disabled={isDeleting}
                        className={`
                            rounded-full flex items-center justify-center shadow-lg
                            transition-all duration-200
                            bg-red-600 text-white w-auto px-3 h-8
                            ${isDeleting ? 'opacity-50 cursor-not-allowed' : ''}
                            pointer-events-auto
                        `}
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

            {/* 取消确认按钮 */}
            {showConfirm && (
                <div className="absolute top-2 right-[76px] z-20 pointer-events-none">
                    <button
                        onClick={handleCancelConfirm}
                        className="bg-slate-500 text-white w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-600 transition-colors shadow-lg opacity-100 pointer-events-auto"
                        title="取消"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            )}

            {/* 图片区域 - 统一正方形裁剪 */}
            <div className="relative w-full aspect-square">
                <img
                    ref={imgRef}
                    src={image.thumbnailUrl || image.url}
                    alt={image.prompt}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
            </div>

            {/* 简要信息 */}
            <div className="p-2 sm:p-3 flex flex-col gap-1.5 sm:gap-2 flex-shrink-0">
                <p className="text-[10px] sm:text-xs text-gray-800 line-clamp-2 font-medium leading-relaxed" title={image.prompt}>
                    {image.prompt}
                </p>

                <div className="flex items-center justify-between text-[8px] sm:text-[9px] text-gray-400 pt-1 border-t border-gray-50 mt-auto">
                    <span className="hidden sm:inline">{formatDateTime(image.taskCreatedAt)}</span>
                    <div className="flex items-center gap-1 ml-auto">
                        <span className="bg-blue-50 text-blue-600 px-1 py-0.5 rounded font-black tracking-tighter border border-blue-100/50">
                            {image.imageSizeLabel}
                        </span>
                        <span className="bg-slate-100 text-slate-500 px-1 py-0.5 rounded font-bold tracking-tighter border border-slate-200/50">
                            {image.aspectRatioLabel}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
});
