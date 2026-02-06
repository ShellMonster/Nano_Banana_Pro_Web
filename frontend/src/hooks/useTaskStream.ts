import { useEffect, useRef, useCallback } from 'react';
import { useGenerateStore } from '../store/generateStore';
import { setUpdateSource, getUpdateSource } from '../store/updateSourceStore';
import { mapBackendTaskToFrontend } from '../utils/mapping';

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

  const closeStream = useCallback(() => {
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
        setUpdateSource('websocket');
        storeRef.current.setConnectionMode('websocket');
        storeRef.current.updateLastMessageTime();
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
      console.error('SSE Error');
      if (!isMountedRef.current) return;

      closeStream();

      const currentMode = useGenerateStore.getState().connectionMode;
      if (currentMode !== 'polling') {
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
