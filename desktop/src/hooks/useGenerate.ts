import { useState, useRef, useEffect, useCallback } from 'react';
import { useConfigStore } from '../store/configStore';
import { useGenerateStore } from '../store/generateStore';
import { generateBatch, generateBatchWithImages, getTaskStatus } from '../services/generateApi';
import { useTaskStream } from './useTaskStream';
import { setUpdateSource, getUpdateSource, clearUpdateSource } from '../store/updateSourceStore';
import { toast } from '../store/toastStore';
import { usePromptHistoryStore } from '../store/promptHistoryStore';
import { useHistoryStore } from '../store/historyStore';
import i18n from '../i18n';

// 流式连接建立超时时间（毫秒）- 超过此时间未建立连接则启动轮询
// 本地后端通常不会推实时进度，过长会导致用户“卡住”的观感
const STREAM_OPEN_TIMEOUT = 3000;
// 轮询间隔（毫秒）
const POLL_INTERVAL = 3000;
// 最大轮询重试次数（降低到 6 次，避免用户等待过久）
const MAX_POLL_RETRIES = 6;
// 最大退避间隔（毫秒）（降低到 15 秒）
const MAX_BACKOFF_INTERVAL = 15000;
const BATCH_TASK_PREFIX = 'batch-';

const isBatchTaskId = (value: string | null | undefined) => {
  if (!value) return false;
  return value.startsWith(BATCH_TASK_PREFIX);
};

const sleep = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

export function useGenerate() {
  const config = useConfigStore();
  const { startTask, status, taskId, failTask, updateProgress, updateProgressBatch, completeTask, setConnectionMode, connectionMode, setSubmitting, isSubmitting: isStoreSubmitting } = useGenerateStore();
  const resetPromptHistory = usePromptHistoryStore((s) => s.reset);
  const [isInternalSubmitting, setIsInternalSubmitting] = useState(false);

  const isSubmitting = isInternalSubmitting || isStoreSubmitting;

  // 轮询相关引用
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPollingRef = useRef(false);
  const pollRetryCountRef = useRef(0); // 轮询重试计数器
  const wsCloseRequestedRef = useRef(false); // 标记是否主动请求关闭WebSocket
  const basePollIntervalRef = useRef(POLL_INTERVAL); // 基础轮询间隔，用于指数退避
  const expectedTaskIdRef = useRef<string | null>(null); // 记录期望的任务ID，防止闭包陷阱

  // 使用 ref 存储最新的 store 函数，避免闭包问题
  const storeRef = useRef({
    failTask,
    updateProgress,
    updateProgressBatch,
    completeTask,
    setConnectionMode
  });
  storeRef.current = { failTask, updateProgress, updateProgressBatch, completeTask, setConnectionMode };

  // 启用 SSE 监听当前任务
  useTaskStream(status === 'processing' ? taskId : null);

  // 停止轮询
  const stopPolling = useCallback(() => {
    isPollingRef.current = false;
    wsCloseRequestedRef.current = false; // 重置WebSocket关闭标记
    pollRetryCountRef.current = 0; // 重置重试计数
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    // 竞态条件修复：清理更新源标记
    if (getUpdateSource() === 'polling') {
      setUpdateSource(null);
    }
    // Bug #3修复：停止轮询时重置connectionMode为none
    storeRef.current.setConnectionMode('none');
  }, []);

  // 轮询函数：检查任务状态
  const startPolling = useCallback(async (currentTaskId: string) => {
    const currentState = useGenerateStore.getState();
    if (
      isPollingRef.current ||
      currentState.status !== 'processing' ||
      currentState.taskId !== currentTaskId ||
      isBatchTaskId(currentTaskId)
    ) {
      return;
    }

    // 进入 polling 模式时由 polling 接管更新源（避免 websocket 标记残留导致轮询无法启动）
    if (getUpdateSource() === 'websocket') {
      setUpdateSource(null);
    }
    setUpdateSource('polling');

    isPollingRef.current = true;
    pollRetryCountRef.current = 0; // 重置重试计数
    basePollIntervalRef.current = POLL_INTERVAL; // 重置基础间隔

    // Bug修复：先检查当前是否已经是polling模式，避免重复设置
    const currentMode = useGenerateStore.getState().connectionMode;
    if (currentMode !== 'polling') {
      wsCloseRequestedRef.current = true; // 标记请求关闭WebSocket
      storeRef.current.setConnectionMode('polling');
    }

    const poll = async () => {
      try {
        // 竞态条件修复：再次检查当前更新源
        if (getUpdateSource() !== 'polling') {
          console.log('[race guard] polling interrupted, source switched');
          // 允许后续再次启动轮询（避免卡住）
          isPollingRef.current = false;
          return;
        }

        // 响应拦截器已返回 ApiResponse.data，即 GenerationTask
        const taskData = await getTaskStatus(currentTaskId);

        // 重置重试计数和间隔（成功后）
        pollRetryCountRef.current = 0;
        basePollIntervalRef.current = POLL_INTERVAL;

        // 更新进度 - 使用批量更新减少重复渲染
        if (taskData.images && taskData.images.length > 0) {
          storeRef.current.updateProgressBatch(taskData.completedCount, taskData.images);
        } else {
          storeRef.current.updateProgress(taskData.completedCount, null);
        }

        // 检查任务是否完成
        if (taskData.status === 'completed' || taskData.status === 'failed') {
          if (
            taskData.status === 'completed' &&
            taskData.totalCount > 1 &&
            (taskData.images?.length || 0) < taskData.totalCount
          ) {
            toast.info(i18n.t('generate.toast.countMismatch', {
              total: taskData.totalCount,
              returned: taskData.images?.length || 0
            }));
          }

          stopPolling();
          if (taskData.status === 'completed') {
            storeRef.current.completeTask();
          } else if (taskData.errorMessage) {
            storeRef.current.failTask(taskData.errorMessage);
          }
          return;
        }

        // 继续轮询（使用当前间隔）
        pollTimerRef.current = setTimeout(poll, basePollIntervalRef.current);
      } catch (error) {
        console.error('Polling error:', error);

        // 检查重试次数
        pollRetryCountRef.current++;
        if (pollRetryCountRef.current >= MAX_POLL_RETRIES) {
          console.error('Polling max retries reached, giving up');
          stopPolling();
          storeRef.current.failTask(i18n.t('generate.toast.pollFailed'));
          return;
        }

        // 优化：使用指数退避策略计算重试间隔
        // 3s -> 6s -> 12s -> 15s (上限)
        const backoffInterval = Math.min(
          POLL_INTERVAL * Math.pow(2, pollRetryCountRef.current - 1),
          MAX_BACKOFF_INTERVAL
        );
        basePollIntervalRef.current = backoffInterval;

        console.log(`Polling failed, retrying in ${backoffInterval}ms... (${pollRetryCountRef.current}/${MAX_POLL_RETRIES})`);
        pollTimerRef.current = setTimeout(poll, backoffInterval);
      }
    };

    // 开始轮询
    poll();
  }, [stopPolling]);

  // 监听 connectionMode 变化，当切换到 polling 时自动启动轮询
  useEffect(() => {
    if (connectionMode === 'polling' && status === 'processing' && taskId && !isBatchTaskId(taskId) && !isPollingRef.current) {
      console.log('Detected polling mode, starting poll');
      startPolling(taskId);
    }
  }, [connectionMode, status, taskId, startPolling]);

  // 清理定时器和状态
  useEffect(() => {
    return () => {
      // 清理轮询定时器
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      // 清理超时定时器
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
      // 重置轮询状态（Bug #4修复）
      isPollingRef.current = false;
      // 重置重试计数器
      pollRetryCountRef.current = 0;
    };
  }, []);

  const generate = async () => {
    if (!config.imageApiKey) {
      toast.error(i18n.t('generate.toast.missingApiKey'));
      return;
    }
    if (!config.prompt.trim()) {
      toast.error(i18n.t('prompt.toast.empty'));
      return;
    }

    resetPromptHistory(config.prompt);

    // 优化 UX：如果用户在历史页点击“开始生成”，先立刻切到生成页
    // 避免历史页在请求期间/状态切换时出现“跳回顶部再切页”的观感
    if (useGenerateStore.getState().currentTab !== 'generate') {
      useGenerateStore.getState().setTab('generate');
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('template-market:close', { detail: { reason: 'generate' } }));
    }

    setSubmitting(true);
    setIsInternalSubmitting(true);
    try {
      // 竞态条件修复：启动新任务前清理旧的更新源标记
      clearUpdateSource();

      const requestedCount = Math.max(1, Number(config.count) || 1);

      const submitSingleGenerate = async () => {
        if (config.refFiles.length > 0) {
          const formData = new FormData();
          formData.append('prompt', config.prompt);
          formData.append('provider', config.imageProvider);
          formData.append('model_id', config.imageModel);
          formData.append('aspectRatio', config.aspectRatio);
          formData.append('imageSize', config.imageSize);
          formData.append('count', '1');

          config.refFiles.forEach((file) => {
            const extFile = file as any;
            if (extFile.__path) {
              formData.append('refPaths', extFile.__path);
            } else {
              formData.append('refImages', file);
            }
          });

          return generateBatchWithImages(formData);
        }

        return generateBatch({
          provider: config.imageProvider,
          model_id: config.imageModel,
          params: {
            prompt: config.prompt,
            count: 1,
            aspectRatio: config.aspectRatio,
            imageSize: config.imageSize,
          }
        } as any);
      };

      const pollTaskUntilFinished = async (singleTaskId: string) => {
        let retry = 0;
        while (true) {
          try {
            const taskData = await getTaskStatus(singleTaskId);
            retry = 0;
            if (taskData.status === 'completed' || taskData.status === 'failed' || taskData.status === 'partial') {
              return taskData;
            }
            await sleep(POLL_INTERVAL);
          } catch (err) {
            retry += 1;
            if (retry >= MAX_POLL_RETRIES) {
              throw err;
            }
            const backoffInterval = Math.min(
              POLL_INTERVAL * Math.pow(2, retry - 1),
              MAX_BACKOFF_INTERVAL
            );
            await sleep(backoffInterval);
          }
        }
      };

      if (requestedCount > 1) {
        const batchTaskId = `${BATCH_TASK_PREFIX}${Date.now()}`;
        startTask(batchTaskId, requestedCount, {
          prompt: config.prompt,
          aspectRatio: config.aspectRatio,
          imageSize: config.imageSize
        });
        setConnectionMode('none');
        expectedTaskIdRef.current = batchTaskId;

        const historyStore = useHistoryStore.getState();
        const createResults = await Promise.allSettled(
          Array.from({ length: requestedCount }, () => submitSingleGenerate())
        );

        const createdTasks: any[] = [];
        let firstError = '';
        createResults.forEach((result) => {
          if (result.status === 'fulfilled') {
            const task = result.value as any;
            const createdTaskId = task?.id || task?.task_id;
            if (createdTaskId) {
              createdTasks.push(task);
            } else if (!firstError) {
              firstError = i18n.t('generate.toast.taskIdMissing');
            }
          } else if (!firstError) {
            firstError = result.reason instanceof Error
              ? result.reason.message
              : i18n.t('generate.toast.startFailed');
          }
        });

        createdTasks.forEach((task) => {
          historyStore.upsertTask({
            ...task,
            status: 'processing',
            updatedAt: new Date().toISOString()
          });
        });

        if (createdTasks.length === 0) {
          const errorMessage = firstError || i18n.t('generate.toast.startFailed');
          toast.error(errorMessage);
          storeRef.current.failTask(errorMessage);
          expectedTaskIdRef.current = null;
          clearUpdateSource();
          return;
        }

        let successCount = 0;
        const finalResults = await Promise.allSettled(
          createdTasks.map(async (task) => {
            const singleTaskId = task.id || task.task_id;
            const finalTask = await pollTaskUntilFinished(singleTaskId);
            historyStore.upsertTask(finalTask);

            if (finalTask.images && finalTask.images.length > 0) {
              const images = finalTask.images.map((image: any) => ({
                ...image,
                taskId: batchTaskId
              }));
              successCount += images.length;
              storeRef.current.updateProgressBatch(successCount, images);
            }

            if (finalTask.status === 'failed' && finalTask.errorMessage && !firstError) {
              firstError = finalTask.errorMessage;
            }
          })
        );

        finalResults.forEach((result) => {
          if (result.status === 'rejected' && !firstError) {
            firstError = result.reason instanceof Error
              ? result.reason.message
              : i18n.t('generate.toast.startFailed');
          }
        });

        if (successCount === 0) {
          const errorMessage = firstError || i18n.t('generate.toast.startFailed');
          toast.error(errorMessage);
          storeRef.current.failTask(errorMessage);
          expectedTaskIdRef.current = null;
          clearUpdateSource();
          return;
        }

        if (successCount < requestedCount) {
          toast.info(i18n.t('generate.toast.countMismatch', {
            total: requestedCount,
            returned: successCount
          }));
        }

        storeRef.current.completeTask();
        expectedTaskIdRef.current = null;
        clearUpdateSource();
        return;
      }

      let response;

      if (config.refFiles.length > 0) {
        // --- 场景 A: 图生图 (multipart/form-data) ---
        const formData = new FormData();
        formData.append('prompt', config.prompt);
        formData.append('provider', config.imageProvider);
        formData.append('model_id', config.imageModel);
        formData.append('aspectRatio', config.aspectRatio);
        formData.append('imageSize', config.imageSize);
        formData.append('count', requestedCount.toString());
        
        // 添加所有参考图片
        config.refFiles.forEach((file) => {
          const extFile = file as any;
          if (extFile.__path) {
            // 如果有本地路径，直接传路径，避免大文件 IPC 传输
            formData.append('refPaths', extFile.__path);
          } else {
            // 否则传二进制文件 (Web 环境或拖拽上传)
            formData.append('refImages', file);
          }
        });

        response = await generateBatchWithImages(formData);
      } else {
        // --- 场景 B: 文本生图 (JSON) ---
        response = await generateBatch({
          provider: config.imageProvider,
          model_id: config.imageModel,
          params: {
            prompt: config.prompt,
            count: requestedCount,
            aspectRatio: config.aspectRatio,
            imageSize: config.imageSize,
          }
        } as any);
      }

      // 响应拦截器已返回 ApiResponse.data，并经过 mapBackendTaskToFrontend 映射
      const task = response as any;
      const newTaskId = task.id || task.task_id;

      if (!newTaskId) {
        throw new Error(i18n.t('generate.toast.taskIdMissing'));
      }

      console.log('[useGenerate] start generation task:', { newTaskId, count: requestedCount });

      // 启动任务
      startTask(newTaskId, requestedCount, {
          prompt: config.prompt,
          aspectRatio: config.aspectRatio,
          imageSize: config.imageSize
      });

      // 生成区与历史区同步：先写入一条本地任务占位，避免历史列表不刷新导致状态不同步
      useHistoryStore.getState().upsertTask({
        ...task,
        status: 'processing',
        updatedAt: new Date().toISOString()
      });

      // 记录当前任务ID，供超时回调验证
      expectedTaskIdRef.current = newTaskId;

      // 保留参考图，让用户手动清空

      // 启动流式连接超时检测（若未建立连接，切换到轮询）
      timeoutTimerRef.current = setTimeout(() => {
        // 检查最新状态和任务ID是否匹配（防止闭包陷阱）
        const currentState = useGenerateStore.getState();
        if (
          currentState.status === 'processing' &&
          currentState.connectionMode === 'websocket' &&
          currentState.taskId === expectedTaskIdRef.current && // 验证任务ID
          getUpdateSource() !== 'websocket' // 仍未建立流式连接
        ) {
          console.log('Stream open timeout, switching to polling mode');
          setConnectionMode('polling');
          // 不需要手动调用 startPolling，useEffect 会自动检测并启动
        }
      }, STREAM_OPEN_TIMEOUT);

    } catch (error) {
      console.error('Failed to start generation:', error);
      const errorMessage = error instanceof Error ? error.message : i18n.t('generate.toast.startFailed');
      toast.error(errorMessage);
      failTask(errorMessage);
      expectedTaskIdRef.current = null; // 清理任务ID
      // 竞态条件修复：失败时清理更新源标记
      clearUpdateSource();
    } finally {
      setSubmitting(false);
      setIsInternalSubmitting(false);
    }
  };

  return {
    generate,
    isProcessing: status === 'processing' || isSubmitting
  };
}
