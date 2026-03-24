import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import api, { type ApiRequestConfig, ensureBackendReady, forceUpdateBackendPort, getBackendPort, isSidecarRunning, restartSidecar } from '../services/api';
import { useGenerateStore } from '../store/generateStore';
import { getTaskStatus } from '../services/generateApi';
import { toast } from '../store/toastStore';
import i18n from '../i18n';

const RECOVERY_COOLDOWN_MS = 5000;

export function useBackendResumeRecovery() {
  const recoveryInFlightRef = useRef(false);
  const lastRecoveryAtRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const recover = async (reason: string) => {
      const now = Date.now();
      if (recoveryInFlightRef.current) return;
      if (now - lastRecoveryAtRef.current < RECOVERY_COOLDOWN_MS) return;

      recoveryInFlightRef.current = true;
      lastRecoveryAtRef.current = now;
      const store = useGenerateStore.getState();
      const currentTaskId = store.taskId;
      const currentStatus = store.status;
      const hasProcessingTask = Boolean(currentTaskId && currentStatus === 'processing');
      const shouldShowRecovering = hasProcessingTask || reason === 'sidecar-running' || reason === 'sidecar-terminated';
      const shouldEscalateUnavailable = hasProcessingTask || reason === 'sidecar-running' || reason === 'sidecar-terminated';

      try {
        if (shouldShowRecovering) {
          store.setRecoveryStatus('recovering');
        }
        console.log('[resume recovery] triggered', { reason, currentTaskId, currentStatus });

        let running = await isSidecarRunning().catch(() => false);
        let healthOk = false;
        let port = 0;

        if (running) {
          try {
            const fastHealthConfig: ApiRequestConfig = {
              timeout: 1500,
              __skipPortDetection: true
            };
            await ensureBackendReady(1500);
            port = await getBackendPort().catch(() => 0);
            forceUpdateBackendPort(port);
            await api.get('/health', fastHealthConfig);
            healthOk = true;
            console.log('[resume recovery] backend ready (fast path)', { port, running });
          } catch (error) {
            console.warn('[resume recovery] fast health probe failed, escalating...', error);
          }
        }

        if (!healthOk) {
          const fullHealthConfig: ApiRequestConfig = {
            timeout: 5000,
            __skipPortDetection: true
          };
          if (!running) {
            console.warn('[resume recovery] sidecar not running, restarting...');
            await restartSidecar();
            running = true;
          }

          await ensureBackendReady(5000);
          port = await getBackendPort().catch(() => 0);
          forceUpdateBackendPort(port);
          await api.get('/health', fullHealthConfig);
          console.log('[resume recovery] backend ready (full path)', { port, running });
        }

        if (currentTaskId && currentStatus === 'processing') {
          const task = await getTaskStatus(currentTaskId);
          const latest = useGenerateStore.getState();
          if (latest.taskId !== currentTaskId || latest.status !== 'processing') {
            store.setRecoveryStatus('idle');
            return;
          }

          if (task.images?.length) {
            latest.updateProgressBatch(task.completedCount, task.images);
          } else {
            latest.updateProgress(task.completedCount, null);
          }

          if (task.status === 'completed') {
            latest.completeTask();
          } else if (task.status === 'failed') {
            latest.failTask(task);
          } else if (task.status === 'partial') {
            toast.info(i18n.t('generate.toast.partial'));
            latest.completeTask();
          } else if (latest.connectionMode !== 'polling') {
            latest.setConnectionMode('polling');
          }
        }

        useGenerateStore.getState().setRecoveryStatus('idle');
      } catch (error) {
        console.error('[resume recovery] failed:', error);
        const latest = useGenerateStore.getState();
        if (shouldEscalateUnavailable) {
          latest.setRecoveryStatus('backend_unavailable');
        } else if (latest.recoveryStatus === 'recovering') {
          latest.setRecoveryStatus('idle');
        }
        if (latest.taskId && latest.status === 'processing' && latest.connectionMode !== 'polling') {
          latest.setConnectionMode('polling');
        }
      } finally {
        recoveryInFlightRef.current = false;
      }
    };

    const onFocus = () => void recover('focus');
    const onOnline = () => void recover('online');
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void recover('visible');
      }
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);

    let unlistenSidecar: (() => void) | null = null;
    let unlistenPort: (() => void) | null = null;

    if ((window as any).__TAURI_INTERNALS__) {
      listen<{ running: boolean }>('sidecar-status', (event) => {
        const running = Boolean(event.payload?.running);
        const store = useGenerateStore.getState();
        if (!running) {
          store.setRecoveryStatus('backend_unavailable');
          if (store.taskId && store.status === 'processing' && store.connectionMode !== 'polling') {
            store.setConnectionMode('polling');
          }
          void recover('sidecar-terminated');
        } else {
          void recover('sidecar-running');
        }
      }).then((fn) => {
        unlistenSidecar = fn;
      }).catch((err) => {
        console.warn('[resume recovery] failed to listen sidecar-status:', err);
      });

      listen<{ port: number }>('backend-port', () => {
        void recover('backend-port');
      }).then((fn) => {
        unlistenPort = fn;
      }).catch((err) => {
        console.warn('[resume recovery] failed to listen backend-port:', err);
      });
    }

    void recover('initial');

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      unlistenSidecar?.();
      unlistenPort?.();
    };
  }, []);
}
