import { useEffect, useRef, useCallback } from 'react';
import { useGenerateStore } from '../store/generateStore';
import { setUpdateSource, getUpdateSource } from '../store/updateSourceStore';
import { mapBackendTaskToFrontend } from '../utils/mapping';

// SSE 重连配置
const SSE_RECONNECT_DELAY = 2000; // 重连延迟（毫秒）
const MAX_SSE_RECONNECT_ATTEMPTS = 2; // 最大重连次数

export function useTaskStream(taskId: string | null) {
  const connectionMode = useGenerateStore((s) => s.connectionMode);
  const isBatchTask = Boolean(taskId && taskId.startsWith('batch-'));

  const storeRef = useRef({
    updateProgress: useGenerateStore.getState().updateProgress,
    updateProgressBatch: useGenerateStore.getState().updateProgressBatch,
    completeTask: useGenerateStore.getState().completeTask,
    failTask: useGenerateStore.getState().failTask,
    setConnectionMode: useGenerateStore.getState().setConnectionMode,
    updateLastMessageTime: useGenerateStore.getState().updateLastMessageTime
  });

  const streamRef = useRef<EventSource | null>(null);
  const isMountedRef = useRef(true);
  // SSE 重连相关
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeStream = useCallback(() => {
    // 清理重连定时器
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // 重置重连计数
    reconnectAttemptsRef.current = 0;
    // 关闭连接
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
  }, []);

  const getStreamUrl = useCallback((id: string) => {
    let baseUrl = import.meta.env.VITE_API_URL || `${window.location.origin}/api/v1`;

    if (baseUrl.startsWith('/')) {
      baseUrl = `${window.location.origin}${baseUrl}`;
    }

    baseUrl = baseUrl.replace(/\/+$/, '');
    return `${baseUrl}/tasks/${id}/stream`;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      closeStream();
    };
  }, [closeStream]);

  useEffect(() => {
    if (!taskId || isBatchTask || connectionMode === 'polling') {
      closeStream();
      return;
    }

    const streamUrl = getStreamUrl(taskId);
    const stream = new EventSource(streamUrl);
    streamRef.current = stream;
    const handlePing = () => {
      if (isMountedRef.current) {
        storeRef.current.updateLastMessageTime();
      }
    };
    stream.addEventListener('ping', handlePing);

    stream.onopen = () => {
      if (isMountedRef.current) {
        // 连接成功，重置重连计数
        reconnectAttemptsRef.current = 0;
        setUpdateSource('websocket');
        storeRef.current.setConnectionMode('websocket');
        storeRef.current.updateLastMessageTime();
        console.log('[SSE] Connection established');
      }
    };

    stream.onmessage = (event) => {
      if (!isMountedRef.current) return;
      try {
        const data = JSON.parse(event.data);
        const task = mapBackendTaskToFrontend(data);

        if (getUpdateSource() !== 'websocket') {
          return;
        }

        if (task.images && task.images.length > 0) {
          storeRef.current.updateProgressBatch(task.completedCount, task.images);
        } else {
          storeRef.current.updateProgress(task.completedCount, null);
        }

        if (task.status === 'completed') {
          setUpdateSource(null);
          storeRef.current.completeTask();
          closeStream();
        } else if (task.status === 'failed') {
          setUpdateSource(null);
          storeRef.current.failTask(task.errorMessage || 'Unknown error');
          closeStream();
        }
      } catch (error) {
        console.error('SSE message parse error:', error);
      }
    };

    stream.onerror = () => {
      console.error('[SSE] Connection error');
      if (!isMountedRef.current) return;

      // 关闭当前连接
      if (streamRef.current) {
        streamRef.current.close();
        streamRef.current = null;
      }

      // 检查是否可以重连
      const currentMode = useGenerateStore.getState().connectionMode;
      if (reconnectAttemptsRef.current < MAX_SSE_RECONNECT_ATTEMPTS && currentMode !== 'polling') {
        // 尝试重连
        reconnectAttemptsRef.current++;
        console.log(`[SSE] Attempting reconnect (${reconnectAttemptsRef.current}/${MAX_SSE_RECONNECT_ATTEMPTS})...`);

        reconnectTimerRef.current = setTimeout(() => {
          if (!isMountedRef.current) return;

          // 检查当前状态是否仍在处理中
          const state = useGenerateStore.getState();
          if (state.status !== 'processing' || state.taskId !== taskId) {
            console.log('[SSE] Task no longer active, skipping reconnect');
            return;
          }

          // 重新创建 SSE 连接
          try {
            const newStream = new EventSource(streamUrl);
            streamRef.current = newStream;
            console.log('[SSE] Reconnected');
          } catch (err) {
            console.error('[SSE] Reconnect failed:', err);
            // 重连失败，切换到轮询
            if (getUpdateSource() === 'websocket') {
              setUpdateSource(null);
            }
            storeRef.current.setConnectionMode('polling');
          }
        }, SSE_RECONNECT_DELAY);
      } else {
        // 重连次数用尽，切换到轮询模式
        console.log('[SSE] Max reconnect attempts reached, switching to polling');
        if (getUpdateSource() === 'websocket') {
          setUpdateSource(null);
        }
        storeRef.current.setConnectionMode('polling');
      }
    };

    return () => {
      stream.removeEventListener('ping', handlePing);
      closeStream();
    };
  }, [taskId, isBatchTask, connectionMode, getStreamUrl, closeStream]);
}
