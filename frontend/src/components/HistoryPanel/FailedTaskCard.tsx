import React, { useCallback, useRef, useEffect } from 'react';
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
                toast.success('记录已删除');
                // 刷新历史记录列表
                loadHistoryRef.current(true);
            } catch (error) {
                console.error('删除记录失败:', error);
                const errorMessage = error instanceof Error ? error.message : '删除失败';
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
                    title: '生成失败',
                    description: task.errorMessage || '未知错误',
                    bgColor: 'bg-red-50',
                    borderColor: 'border-red-200'
                };
            case 'pending':
                return {
                    icon: <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />,
                    title: '等待中',
                    description: '任务排队中...',
                    bgColor: 'bg-blue-50',
                    borderColor: 'border-blue-200'
                };
            case 'processing':
                return {
                    icon: <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />,
                    title: '生成中',
                    description: `正在生成第 ${task.completedCount + 1} 张图片`,
                    bgColor: 'bg-blue-50',
                    borderColor: 'border-blue-200'
                };
            case 'partial':
                return {
                    icon: <AlertCircle className="w-8 h-8 text-orange-500" />,
                    title: '部分完成',
                    description: `仅 ${task.completedCount}/${task.totalCount} 张成功`,
                    bgColor: 'bg-orange-50',
                    borderColor: 'border-orange-200'
                };
            case 'completed':
                return {
                    icon: <AlertCircle className="w-8 h-8 text-gray-400" />,
                    title: '无图片数据',
                    description: '任务已完成但未找到图片',
                    bgColor: 'bg-gray-50',
                    borderColor: 'border-gray-200'
                };
            default:
                return {
                    icon: <AlertCircle className="w-8 h-8 text-gray-400" />,
                    title: '状态未知',
                    description: '暂无生成的图片',
                    bgColor: 'bg-gray-50',
                    borderColor: 'border-gray-200'
                };
        }
    }, [task.status, task.errorMessage, task.completedCount, task.totalCount]);

    return (
        <div
            className={`
                break-inside-avoid rounded-xl overflow-hidden border shadow-sm
                hover:shadow-md cursor-pointer group relative
                ${statusInfo.bgColor} ${statusInfo.borderColor}
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
                        title="删除记录"
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

            {/* 内容区域 */}
            <div className="p-6 flex flex-col items-center justify-center min-h-[200px]">
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
                    <p className="text-sm text-gray-600 text-center mb-4">
                        {statusInfo.description}
                    </p>
                )}

                {/* 分隔线 */}
                <div className="w-full border-t border-gray-300/50 my-3" />

                {/* 任务信息 */}
                <div className="w-full">
                    <p className="text-xs text-gray-800 line-clamp-2 font-medium leading-relaxed mb-3" title={task.prompt}>
                        {task.prompt || '无提示词'}
                    </p>

                    <div className="flex items-center justify-between text-[9px] text-gray-400 pt-1">
                        <span className="hidden sm:block">{formatDateTime(task.createdAt)}</span>
                        <div className="flex items-center gap-1 ml-auto">
                            <span className={`
                                px-1.5 py-0.5 rounded font-black tracking-tighter border
                                ${task.status === 'failed' ? 'bg-red-50 text-red-600 border-red-100/50' : ''}
                                ${task.status === 'processing' ? 'bg-yellow-50 text-yellow-600 border-yellow-100/50' : ''}
                                ${task.status === 'partial' ? 'bg-orange-50 text-orange-600 border-orange-100/50' : ''}
                                ${task.status === 'completed' ? 'bg-gray-100 text-gray-500 border-gray-200/50' : ''}
                            `}>
                                {task.status.toUpperCase()}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});
