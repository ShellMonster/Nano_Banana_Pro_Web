import React, { useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, AlertCircle, XCircle, Loader2 } from 'lucide-react';
import { GenerationTask } from '../../types';
import { formatDateTime } from '../../utils/date';
import { toast } from '../../store/toastStore';
import { deleteHistory } from '../../services/historyApi';
import { useHistoryStore } from '../../store/historyStore';

interface FailedTaskCardProps {
    task: GenerationTask;
    onClick: () => void;
}

// 使用 React.memo 防止不必要的重渲染
export const FailedTaskCard = React.memo(function FailedTaskCard({ task, onClick }: FailedTaskCardProps) {
    const { t } = useTranslation();
    const loadHistory = useHistoryStore(s => s.loadHistory);
    const loadHistoryRef = useRef(loadHistory);

    // 保持 loadHistoryRef 最新
    useEffect(() => {
        loadHistoryRef.current = loadHistory;
    }, [loadHistory]);

    const [isDeleting, setIsDeleting] = React.useState(false);
    const [showConfirm, setShowConfirm] = React.useState(false);
    const confirmTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // 清理定时器
    useEffect(() => {
        return () => {
            if (confirmTimerRef.current) {
                clearTimeout(confirmTimerRef.current);
                confirmTimerRef.current = null;
            }
        };
    }, []);

    const handleClick = useCallback(() => {
        onClick();
    }, [onClick]);

    const handleCancelConfirm = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setShowConfirm(false);
    }, []);

    const handleDelete = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();

        if (showConfirm) {
            setIsDeleting(true);
            try {
                await deleteHistory(task.id);
                toast.success(t('history.toast.deleted'));
                // 刷新历史记录列表
                loadHistoryRef.current(true, { silent: true });
            } catch (error) {
                console.error('Delete record failed:', error);
                const errorMessage = error instanceof Error ? error.message : t('history.toast.deleteFailed');
                toast.error(errorMessage);
            } finally {
                setIsDeleting(false);
                setShowConfirm(false);
            }
        } else {
            setShowConfirm(true);
            if (confirmTimerRef.current) {
                clearTimeout(confirmTimerRef.current);
            }
            confirmTimerRef.current = setTimeout(() => setShowConfirm(false), 3000);
        }
    }, [showConfirm, task.id]);

    // 使用 useMemo 缓存状态信息
    const statusInfo = React.useMemo(() => {
        switch (task.status) {
            case 'failed':
                return {
                    icon: <XCircle className="w-8 h-8 text-red-500" />,
                    title: t('history.status.failed.title'),
                    description: task.errorMessage || t('history.status.failed.description'),
                    bgColor: 'bg-red-50',
                    borderColor: 'border-red-200'
                };
            case 'pending':
                return {
                    icon: <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />,
                    title: t('history.status.pending.title'),
                    description: t('history.status.pending.description'),
                    bgColor: 'bg-blue-50',
                    borderColor: 'border-blue-200'
                };
            case 'processing':
                return {
                    icon: <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />,
                    title: t('history.status.processing.title'),
                    description: t('history.status.processing.description', { index: task.completedCount + 1 }),
                    bgColor: 'bg-blue-50',
                    borderColor: 'border-blue-200'
                };
            case 'partial':
                return {
                    icon: <AlertCircle className="w-8 h-8 text-orange-500" />,
                    title: t('history.status.partial.title'),
                    description: t('history.status.partial.description', { completed: task.completedCount, total: task.totalCount }),
                    bgColor: 'bg-orange-50',
                    borderColor: 'border-orange-200'
                };
            case 'completed':
                return {
                    icon: <AlertCircle className="w-8 h-8 text-gray-400" />,
                    title: t('history.status.completed.title'),
                    description: t('history.status.completed.description'),
                    bgColor: 'bg-gray-50',
                    borderColor: 'border-gray-200'
                };
            default:
                return {
                    icon: <AlertCircle className="w-8 h-8 text-gray-400" />,
                    title: t('history.status.unknown.title'),
                    description: t('history.status.unknown.description'),
                    bgColor: 'bg-gray-50',
                    borderColor: 'border-gray-200'
                };
        }
    }, [task.status, task.errorMessage, task.completedCount, task.totalCount, t]);

    const snapshotLabels = React.useMemo(() => {
        const raw = (task as any).options as string | undefined;
        if (!raw) return { imageSizeLabel: '—', aspectRatioLabel: '—' };

        try {
            const parsed = JSON.parse(raw) as any;
            const aspectRatio =
                parsed?.aspectRatio ||
                parsed?.aspect_ratio ||
                parsed?.aspect;
            const imageSize =
                parsed?.imageSize ||
                parsed?.resolution_level ||
                parsed?.image_size;

            const imageSizeLabel = typeof imageSize === 'string' && imageSize.trim()
                ? imageSize.trim().toUpperCase()
                : '—';
            const aspectRatioLabel = typeof aspectRatio === 'string' && aspectRatio.trim()
                ? aspectRatio.trim()
                : '—';

            return { imageSizeLabel, aspectRatioLabel };
        } catch {
            // 兼容旧版本：config_snapshot 可能是 "Model: xxx" 这类非 JSON 文本
            return { imageSizeLabel: '—', aspectRatioLabel: '—' };
        }
    }, [(task as any).options]);

    return (
        <div
            className={`
                break-inside-avoid rounded-xl overflow-hidden border shadow-sm
                hover:shadow-md cursor-pointer group relative
                h-full flex flex-col ${statusInfo.bgColor} ${statusInfo.borderColor}
            `}
            style={{ contentVisibility: 'auto', containIntrinsicSize: '240px 240px' }}
            onClick={handleClick}
        >
            {/* 删除按钮 - 纯 CSS hover */}
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
                        title={t('history.actions.deleteRecord')}
                    >
                        {isDeleting ? (
                            <div className="w-3 h-3 sm:w-4 sm:h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <Trash2 className="w-3 h-3 sm:w-4 sm:h-4" />
                        )}
                    </button>
                </div>
            )}

            {/* 确认状态：强制显示确认按钮 */}
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
                        title={t('history.actions.confirmDeleteTitle')}
                    >
                        {isDeleting ? (
                            <div className="w-3 h-3 sm:w-4 sm:h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <span className="text-xs font-bold">{t('common.confirmShort')}</span>
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
                        title={t('common.cancel')}
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            )}

            {/* 内容区域 */}
            <div className="p-5 sm:p-6 flex flex-col items-center justify-center flex-1 min-h-0">
                {/* 状态图标 */}
                <div className="mb-4">
                    {statusInfo.icon}
                </div>

                {/* 状态标题 */}
                <h3 className="text-lg font-semibold text-gray-800 mb-2">
                    {statusInfo.title}
                </h3>

                {/* 状态描述 */}
                {statusInfo.description && (
                    <p
                        className={`text-center mb-3 ${
                            task.status === 'processing'
                                ? 'text-xs text-gray-600 whitespace-nowrap truncate'
                                : 'text-sm text-gray-600 line-clamp-3'
                        }`}
                        title={statusInfo.description}
                    >
                        {statusInfo.description}
                    </p>
                )}

                {/* 分隔线 */}
                <div className="w-full border-t border-gray-300/50 my-3" />

                {/* 任务信息 */}
                <div className="w-full min-h-0">
                    <p className="text-xs text-gray-800 line-clamp-2 font-medium leading-relaxed mb-3" title={task.prompt}>
                        {task.prompt || t('history.prompt.empty')}
                    </p>

                    <div className="flex items-center justify-between text-[9px] text-gray-400 pt-1">
                        <span className="hidden sm:block">{formatDateTime(task.createdAt)}</span>
                        <div className="flex items-center gap-1 ml-auto">
                            <span className="bg-blue-50 text-blue-600 px-1 py-0.5 rounded font-black tracking-tighter border border-blue-100/50">
                                {snapshotLabels.imageSizeLabel}
                            </span>
                            <span className="bg-slate-100 text-slate-500 px-1 py-0.5 rounded font-bold tracking-tighter border border-slate-200/50">
                                {snapshotLabels.aspectRatioLabel}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});
