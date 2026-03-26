import { useEffect, useRef, useCallback } from 'react';
import { useGenerateStore } from '../store/generateStore';
import { setUpdateSource, getUpdateSource } from '../store/updateSourceStore';
import { mapBackendTaskToFrontend } from '../utils/mapping';
import { BASE_URL } from '../services/api';

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
    updateLastHeartbeatTime: useGenerateStore.getState().updateLastHeartbeatTime,
    updateLastTaskUpdateTime: useGenerateStore.getState().updateLastTaskUpdateTime
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

  const bindStream = useCallback((stream: EventSource, streamUrl: string, activeTaskId: string) => {
    const handlePing = () => {
      if (isMountedRef.current) {
        storeRef.current.updateLastHeartbeatTime();
      }
    };

    stream.addEventListener('ping', handlePing);

    stream.onopen = () => {
      if (isMountedRef.current) {
        reconnectAttemptsRef.current = 0;
        setUpdateSource('websocket');
        storeRef.current.setConnectionMode('websocket');
        storeRef.current.updateLastHeartbeatTime();
        storeRef.current.updateLastTaskUpdateTime();
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

        storeRef.current.updateLastTaskUpdateTime();

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
          storeRef.current.failTask(task);
          closeStream();
        } else if (task.status === 'partial') {
          setUpdateSource(null);
          storeRef.current.completeTask();
          closeStream();
        }
      } catch (error) {
        console.error('SSE message parse error:', error);
      }
    };

    stream.onerror = () => {
      console.error('[SSE] Connection error');
      stream.removeEventListener('ping', handlePing);
      if (!isMountedRef.current) return;

      if (streamRef.current === stream) {
        streamRef.current.close();
        streamRef.current = null;
      } else {
        stream.close();
      }

      const currentMode = useGenerateStore.getState().connectionMode;
      if (reconnectAttemptsRef.current < MAX_SSE_RECONNECT_ATTEMPTS && currentMode !== 'polling') {
        reconnectAttemptsRef.current++;
        console.log(`[SSE] Attempting reconnect (${reconnectAttemptsRef.current}/${MAX_SSE_RECONNECT_ATTEMPTS})...`);

        reconnectTimerRef.current = setTimeout(() => {
          if (!isMountedRef.current) return;

          const state = useGenerateStore.getState();
          if (state.status !== 'processing' || state.taskId !== activeTaskId) {
            console.log('[SSE] Task no longer active, skipping reconnect');
            return;
          }

          try {
            const newStream = new EventSource(streamUrl);
            streamRef.current = newStream;
            bindStream(newStream, streamUrl, activeTaskId);
            console.log('[SSE] Reconnected');
          } catch (err) {
            console.error('[SSE] Reconnect failed:', err);
            if (getUpdateSource() === 'websocket') {
              setUpdateSource(null);
            }
            storeRef.current.setConnectionMode('polling');
          }
        }, SSE_RECONNECT_DELAY);
      } else {
        console.log('[SSE] Max reconnect attempts reached, switching to polling');
        if (getUpdateSource() === 'websocket') {
          setUpdateSource(null);
        }
        storeRef.current.setConnectionMode('polling');
      }
    };

    return () => {
      stream.removeEventListener('ping', handlePing);
    };
  }, [closeStream]);

  const getStreamUrl = useCallback((id: string) => {
    const baseUrl = BASE_URL.replace(/\/+$/, '');
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
    const unbind = bindStream(stream, streamUrl, taskId);

    return () => {
      unbind();
      closeStream();
    };
  }, [taskId, isBatchTask, connectionMode, getStreamUrl, closeStream, bindStream]);
}
