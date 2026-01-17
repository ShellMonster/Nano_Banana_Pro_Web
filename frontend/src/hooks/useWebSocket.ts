import { useEffect, useRef, useCallback } from 'react';
import { useGenerateStore } from '../store/generateStore';
import { setUpdateSource, getUpdateSource } from '../store/updateSourceStore';

export function useWebSocket(taskId: string | null) {
  // 使用 selector 获取状态，避免依赖整个 store
  const connectionMode = useGenerateStore((s) => s.connectionMode);

  // 使用 ref 存储 store 函数引用，避免重复获取
  // 注意：Zustand 的 action 函数是稳定的，不会在每次渲染时改变
  const storeRef = useRef({
    updateProgress: useGenerateStore.getState().updateProgress,
    completeTask: useGenerateStore.getState().completeTask,
    failTask: useGenerateStore.getState().failTask,
    updateLastMessageTime: useGenerateStore.getState().updateLastMessageTime,
    setConnectionMode: useGenerateStore.getState().setConnectionMode,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const isMountedRef = useRef(true);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // WebSocket 关闭超时
  const reconnectDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 重连延迟定时器
  const connectTimeRef = useRef<number>(0); // 连接建立时间，用于检测快速断开
  const disconnectCountRef = useRef(0); // 快速断开计数器

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // 清理关闭超时定时器
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      // 清理重连延迟定时器
      if (reconnectDelayRef.current) {
        clearTimeout(reconnectDelayRef.current);
        reconnectDelayRef.current = null;
      }
    };
  }, []);

  // 安全关闭 WebSocket 函数
  const closeWebSocketSafely = useCallback((ws: WebSocket) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    } else if (ws.readyState === WebSocket.CONNECTING) {
      // CONNECTING 状态：添加超时机制，防止永久等待
      // 如果 3 秒内连接未完成，强制关闭
      closeTimeoutRef.current = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          console.warn('[WebSocket] connection timeout, force close');
          ws.close();
        }
        closeTimeoutRef.current = null;
      }, 3000);

      // 连接成功后立即关闭
      ws.addEventListener('open', () => {
        if (closeTimeoutRef.current) {
          clearTimeout(closeTimeoutRef.current);
          closeTimeoutRef.current = null;
        }
        ws.close();
      }, { once: true });
    }
    // CLOSED 状态无需处理
  }, []);

  // WebSocket URL 构建函数
  const getWebSocketUrl = useCallback((id: string) => {
    // 优先使用 VITE_WS_URL；未配置时从 VITE_API_URL 推导，避免生产环境默认连 localhost
    let wsBaseUrl =
      import.meta.env.VITE_WS_URL ||
      import.meta.env.VITE_API_URL ||
      `${window.location.origin}/api/v1`;

    // 支持相对路径（如 /api/v1）
    if (wsBaseUrl.startsWith('/')) {
      wsBaseUrl = `${window.location.origin}${wsBaseUrl}`;
    }

    // http(s) -> ws(s)
    if (wsBaseUrl.startsWith('http://')) {
      wsBaseUrl = wsBaseUrl.replace(/^http:\/\//, 'ws://');
    } else if (wsBaseUrl.startsWith('https://')) {
      wsBaseUrl = wsBaseUrl.replace(/^https:\/\//, 'wss://');
    } else if (!wsBaseUrl.startsWith('ws://') && !wsBaseUrl.startsWith('wss://')) {
      wsBaseUrl = `ws://${wsBaseUrl}`;
    }

    wsBaseUrl = wsBaseUrl.replace(/\/+$/, '');
    return `${wsBaseUrl}/ws/generate/${id}`;
  }, []);

  useEffect(() => {
    // 当 taskId 变化时，重置快速断开计数器
    disconnectCountRef.current = 0;

    if (!taskId || connectionMode === 'polling') {
      if (wsRef.current && connectionMode === 'polling') {
        if (wsRef.current.readyState === WebSocket.OPEN ||
            wsRef.current.readyState === WebSocket.CONNECTING) {
          console.log('Switching to polling mode, closing WebSocket');
          closeWebSocketSafely(wsRef.current);
        }
        wsRef.current = null;
      }
      return;
    }

    const wsUrl = getWebSocketUrl(taskId);
    console.log('Connecting to WebSocket:', wsUrl);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket Connected');
      connectTimeRef.current = Date.now(); // 记录连接时间
      if (isMountedRef.current) {
        // 竞态条件修复：WebSocket 连接成功时设置为活跃更新源
        setUpdateSource('websocket');
        storeRef.current.setConnectionMode('websocket');
      }
    };

    ws.onmessage = (event) => {
      if (!isMountedRef.current) return;

      try {
        const data = JSON.parse(event.data);
        console.log('WS Message:', data);

        storeRef.current.updateLastMessageTime();

        // 竞态条件修复：确认 WebSocket 是活跃更新源
        if (getUpdateSource() === 'websocket') {
          if (data.type === 'progress') {
            storeRef.current.updateProgress(data.completedCount, data.latestImage);
          } else if (data.type === 'complete') {
            storeRef.current.completeTask();
            ws.close();
          } else if (data.type === 'error') {
            storeRef.current.failTask(data.message || 'Unknown error');
            ws.close();
          }
        } else {
          console.log('[race guard] WebSocket message ignored, source switched');
        }
      } catch (e) {
        console.error('WebSocket message parse error:', e);
      }
    };

    ws.onerror = () => {
      console.error('WebSocket Error');
      if (isMountedRef.current) {
        const currentMode = useGenerateStore.getState().connectionMode;
        if (currentMode !== 'polling') {
          console.log('WebSocket error detected, switching to polling mode');
          storeRef.current.setConnectionMode('polling');
        }
      }
    };

    ws.onclose = (event) => {
      console.log('WebSocket Disconnected', event.code, event.reason);

      if (isMountedRef.current) {
        const currentState = useGenerateStore.getState();

        // 竞态条件修复：WebSocket 关闭时，如果它是活跃更新源，则清理标记
        if (getUpdateSource() === 'websocket') {
          setUpdateSource(null);
        }

        // 检查是否是快速断开（连接后2秒内断开）
        const connectionDuration = Date.now() - connectTimeRef.current;
        const isRapidDisconnect = connectionDuration < 2000;

        if (isRapidDisconnect) {
          disconnectCountRef.current++;
          console.log(`Rapid disconnect detected (${disconnectCountRef.current}/3)`);

          // 如果3次快速断开，直接切换到轮询模式并延迟重试
          if (disconnectCountRef.current >= 3) {
            console.warn('WebSocket unstable, switching to polling mode');
            disconnectCountRef.current = 0;
            storeRef.current.setConnectionMode('polling');
            return;
          }
        } else {
          // 正常断开，重置计数器
          disconnectCountRef.current = 0;
        }

        // 只在任务仍在进行中时才切换到轮询模式
        // 避免在任务完成后触发重连循环
        if (currentState.status === 'processing' && currentState.taskId === taskId) {
          // 延迟切换到轮询模式，避免快速重连
          // 添加 Jitter（随机抖动）防止雷群效应
          if (reconnectDelayRef.current) {
            clearTimeout(reconnectDelayRef.current);
          }

          // 计算延迟时间：基础延迟 + 随机抖动
          const baseDelay = isRapidDisconnect ? 1000 : 0;
          const jitter = Math.random() * 500; // 0-500ms 随机抖动
          const delay = baseDelay + jitter;

          reconnectDelayRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              storeRef.current.setConnectionMode('polling');
            }
          }, delay);
        } else {
          // 任务已完成或失败，设置为 none
          storeRef.current.setConnectionMode('none');
        }
      }
    };

    return () => {
      if (wsRef.current) {
        closeWebSocketSafely(wsRef.current);
        wsRef.current = null;
      }
      // 清理关闭超时定时器
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      // 清理重连延迟定时器
      if (reconnectDelayRef.current) {
        clearTimeout(reconnectDelayRef.current);
        reconnectDelayRef.current = null;
      }
    };
  }, [taskId, connectionMode, getWebSocketUrl, closeWebSocketSafely]);
}
