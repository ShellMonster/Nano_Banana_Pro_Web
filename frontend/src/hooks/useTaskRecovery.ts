import { useEffect, useRef } from 'react';
import { useGenerateStore } from '../store/generateStore';
import { getTaskStatus } from '../services/generateApi';
import { toast } from '../store/toastStore';
import i18n from '../i18n';

// 任务超时时间：10 分钟（防止恢复过期任务）
const TASK_TIMEOUT = 10 * 60 * 1000;

export function useTaskRecovery() {
  const { taskId, startTime, status, restoreTaskState, clearTaskState } = useGenerateStore();
  const hasRecoveredRef = useRef(false);
  const isCheckingRef = useRef(false);

  useEffect(() => {
    // 只在组件首次加载时执行一次恢复逻辑
    if (hasRecoveredRef.current || isCheckingRef.current) return;
    hasRecoveredRef.current = true;

    // 检查是否有需要恢复的任务
    if (!taskId || status !== 'processing') {
      return;
    }

    // 检查任务是否过期
    if (!startTime) {
      clearTaskState();
      return;
    }

    const elapsed = Date.now() - startTime;
    if (elapsed > TASK_TIMEOUT) {
      // 任务已过期，清理状态
      console.log('Task expired, clearing state');
      clearTaskState();
      return;
    }

    // 标记正在检查，避免重复执行
    isCheckingRef.current = true;

    // 恢复任务状态
    recoverTask(taskId).finally(() => {
      isCheckingRef.current = false;
    });
  }, []); // 只在挂载时执行一次

  const recoverTask = async (taskIdToRecover: string) => {
    try {
      console.log('Recovering task:', taskIdToRecover);

      // 查询后端获取最新状态
      // 响应拦截器已返回 ApiResponse.data，即 GenerationTask
      const taskData = await getTaskStatus(taskIdToRecover);

      switch (taskData.status) {
        case 'processing':
          // 任务仍在进行中，恢复进度
          console.log('Task still processing, restoring...');
          restoreTaskState({
            taskId: taskData.id,
            status: 'processing',
            totalCount: taskData.totalCount,
            completedCount: taskData.completedCount,
            images: taskData.images || []
          });
          toast.info(i18n.t('generate.toast.recovered'));
          break;

        case 'completed':
          // 任务已完成，清空本地状态
          console.log('Task was completed, clearing local state');
          clearTaskState();
          // 不显示 toast，避免打扰用户（任务已经正常完成）
          break;

        case 'failed':
          // 任务失败
          console.log('Task failed');
          clearTaskState();
          toast.error(i18n.t('generate.toast.failedWith', {
            message: taskData.errorMessage || i18n.t('common.unknownError')
          }));
          break;

        case 'partial':
          // 部分完成，也当作完成处理
          console.log('Task was partially completed');
          clearTaskState();
          toast.info(i18n.t('generate.toast.partial'));
          break;

        default:
          // 未知状态，清理
          console.log('Unknown task status:', taskData.status);
          clearTaskState();
      }
    } catch (error) {
      console.error('Failed to recover task:', error);
      // 恢复失败，清理状态（避免显示错误的进度）
      clearTaskState();
    }
  };

  return null; // 这个 hook 不返回任何 UI，只是执行恢复逻辑
}
