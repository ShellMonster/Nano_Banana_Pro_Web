import { useState, useRef, useEffect, useCallback } from 'react';
import { useConfigStore } from '../store/configStore';
import { useGenerateStore } from '../store/generateStore';
import { generateBatch, generateBatchWithImages, getTaskStatus } from '../services/generateApi';
import { useWebSocket } from './useWebSocket';
import { setUpdateSource, getUpdateSource, clearUpdateSource } from '../store/updateSourceStore';
import { toast } from '../store/toastStore';
import { usePromptHistoryStore } from '../store/promptHistoryStore';

// WebSocket 超时时间（毫秒）- 超过此时间无消息则启动轮询
const WS_TIMEOUT = 15000;
// 轮询间隔（毫秒）
const POLL_INTERVAL = 3000;
// 最大轮询重试次数（降低到 6 次，避免用户等待过久）
const MAX_POLL_RETRIES = 6;
// 最大退避间隔（毫秒）（降低到 15 秒）
const MAX_BACKOFF_INTERVAL = 15000;

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
  const hasStartedRef = useRef(false); // 标记是否已启动过轮询
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

  // 启用 WebSocket 监听当前任务
  useWebSocket(status === 'processing' ? taskId : null);

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
    if (isPollingRef.current || status !== 'processing') {
      return;
    }

    // 竞态条件修复：检查是否有其他更新源正在运行
    if (getUpdateSource() === 'websocket') {
      console.log('[竞态条件防护] WebSocket 仍在活跃，等待其完成');
      return;
    }

    // 设置当前更新源为 polling
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
          console.log('[竞态条件防护] 轮询被中断，更新源已切换');
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
          storeRef.current.failTask('轮询失败，请检查网络连接后刷新页面');
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
  }, [status, stopPolling]);

  // 监听 connectionMode 变化，当切换到 polling 时自动启动轮询
  useEffect(() => {
    if (connectionMode === 'polling' && status === 'processing' && taskId && !isPollingRef.current && !hasStartedRef.current) {
      console.log('Detected polling mode, starting poll');
      hasStartedRef.current = true;
      startPolling(taskId);
    } else if (connectionMode === 'none' && status === 'idle') {
      // 只在任务回到 idle 状态时重置标记
      hasStartedRef.current = false;
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
      toast.error('请先在设置中配置生图 API Key');
      return;
    }

    resetPromptHistory(config.prompt);
    setSubmitting(true);
    setIsInternalSubmitting(true);
    try {
      // 竞态条件修复：启动新任务前清理旧的更新源标记
      clearUpdateSource();

      let response;

      if (config.refFiles.length > 0) {
        // --- 场景 A: 图生图 (multipart/form-data) ---
        const formData = new FormData();
        formData.append('prompt', config.prompt);
        formData.append('provider', config.imageProvider);
        formData.append('model_id', config.imageModel);
        formData.append('aspectRatio', config.aspectRatio);
        formData.append('imageSize', config.imageSize);
        formData.append('count', config.count.toString());
        
        // 添加所有参考图片
        config.refFiles.forEach((file) => {
          formData.append('refImages', file);
        });

        response = await generateBatchWithImages(formData);
      } else {
        // --- 场景 B: 文本生图 (JSON) ---
        response = await generateBatch({
          provider: config.imageProvider,
          model_id: config.imageModel,
          params: {
            prompt: config.prompt,
            count: config.count,
            aspectRatio: config.aspectRatio,
            imageSize: config.imageSize,
          }
        } as any);
      }

      // 响应拦截器已返回 ApiResponse.data，并经过 mapBackendTaskToFrontend 映射
      const task = response as any;
      const newTaskId = task.id || task.task_id;

      if (!newTaskId) {
        throw new Error('获取任务ID失败');
      }

      console.log('[useGenerate] 启动生成任务:', { newTaskId, count: config.count });

      // 启动任务
      startTask(newTaskId, config.count, {
          prompt: config.prompt,
          aspectRatio: config.aspectRatio,
          imageSize: config.imageSize
      });

      // 竞态条件修复：设置初始更新源为 websocket
      setUpdateSource('websocket');

      // 记录当前任务ID，供超时回调验证
      expectedTaskIdRef.current = newTaskId;

      // 保留参考图，让用户手动清空

      // 启动 WebSocket 超时检测（如果15秒内没有消息，切换到轮询）
      timeoutTimerRef.current = setTimeout(() => {
        // 检查最新状态和任务ID是否匹配（防止闭包陷阱）
        const currentState = useGenerateStore.getState();
        if (
          currentState.status === 'processing' &&
          currentState.connectionMode === 'websocket' &&
          currentState.taskId === expectedTaskIdRef.current && // 验证任务ID
          getUpdateSource() === 'websocket' // 竞态条件修复：确认 WebSocket 仍是活跃源
        ) {
          console.log('WebSocket timeout, switching to polling mode');
          // 竞态条件修复：清理 WebSocket 标记后再切换
          setUpdateSource(null);
          setConnectionMode('polling');
          // 不需要手动调用 startPolling，useEffect 会自动检测并启动
        }
      }, WS_TIMEOUT);

    } catch (error) {
      console.error('Failed to start generation:', error);
      const errorMessage = error instanceof Error ? error.message : '启动任务失败';
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
