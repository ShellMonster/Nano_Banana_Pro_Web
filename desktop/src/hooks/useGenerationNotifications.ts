import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '../store/configStore';
import { useHistoryStore } from '../store/historyStore';
import type { HistoryItem } from '../types';
import { buildPromptNotificationSummary } from '../utils/notificationSummary';
import { toast } from '../store/toastStore';

type FinalTaskStatus = 'completed' | 'failed' | 'partial';

const isTauriRuntime = () => typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

const getTaskPromptSummary = (task: HistoryItem) =>
  buildPromptNotificationSummary(task.promptOptimized, task.promptOriginal, task.prompt);

const shouldNotifyForStatus = (status: FinalTaskStatus, notifyOnFailure: boolean) => {
  if (status === 'failed') return notifyOnFailure;
  return true;
};

const getNotificationCopy = (task: HistoryItem, t: (key: string, params?: Record<string, unknown>) => string) => {
  const promptSummary = getTaskPromptSummary(task);

  if (task.status === 'failed') {
    return {
      title: t('notifications.status.failed.title'),
      body: promptSummary
        ? t('notifications.status.failed.bodyWithPrompt', { prompt: promptSummary })
        : t('notifications.status.failed.body')
    };
  }

  if (task.status === 'partial') {
    return {
      title: t('notifications.status.partial.title'),
      body: promptSummary
        ? t('notifications.status.partial.bodyWithPrompt', {
            prompt: promptSummary,
            completed: task.completedCount,
            total: task.totalCount
          })
        : t('notifications.status.partial.body', {
            completed: task.completedCount,
            total: task.totalCount
          })
    };
  }

  return {
    title: t('notifications.status.completed.title'),
    body: promptSummary
      ? t('notifications.status.completed.bodyWithPrompt', { prompt: promptSummary })
      : t('notifications.status.completed.body')
  };
};

export function useGenerationNotifications() {
  const { t } = useTranslation();
  const items = useHistoryStore((s) => s.items);
  const enableSystemNotifications = useConfigStore((s) => s.enableSystemNotifications);
  const notifyOnlyWhenBackground = useConfigStore((s) => s.notifyOnlyWhenBackground);
  const notifyOnFailure = useConfigStore((s) => s.notifyOnFailure);
  const notifiedRef = useRef<Set<string>>(new Set());
  const enableBaselineRef = useRef<number | null>(enableSystemNotifications ? Date.now() : null);
  const previousEnabledRef = useRef(enableSystemNotifications);
  const lastStatusSignatureRef = useRef<Map<string, string>>(new Map());
  const permissionRequestedRef = useRef(false);
  const permissionDeniedToastShownRef = useRef(false);

  useEffect(() => {
    const nextMap = new Map<string, string>();
    for (const task of items) {
      if (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'partial') {
        continue;
      }
      const signature = `${task.status}:${task.updatedAt || task.createdAt}`;
      nextMap.set(task.id, signature);
    }
    lastStatusSignatureRef.current = nextMap;
  }, [items]);

  useEffect(() => {
    if (enableSystemNotifications && !previousEnabledRef.current) {
      enableBaselineRef.current = Date.now();
      const seeded = new Map<string, string>();
      for (const task of items) {
        if (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'partial') {
          continue;
        }
        seeded.set(task.id, `${task.status}:${task.updatedAt || task.createdAt}`);
      }
      lastStatusSignatureRef.current = seeded;
    }
    previousEnabledRef.current = enableSystemNotifications;
  }, [enableSystemNotifications, items]);

  useEffect(() => {
    if (!enableSystemNotifications) return;
    if (!isTauriRuntime()) return;
    if (permissionRequestedRef.current) return;

    const ensurePermission = async () => {
      try {
        const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
        let permissionGranted = await isPermissionGranted();
        console.info('[notification] initial permission state', { permissionGranted });
        if (!permissionGranted) {
          const permission = await requestPermission();
          console.info('[notification] requestPermission result', { permission });
          permissionGranted = permission === 'granted';
        }
        permissionRequestedRef.current = true;
        if (!permissionGranted) {
          if (!permissionDeniedToastShownRef.current) {
            toast.info(t('settings.notifications.permissionDenied'));
            permissionDeniedToastShownRef.current = true;
          }
        }
      } catch (error) {
        console.warn('[notification] permission request failed', error);
      }
    };

    void ensurePermission();
  }, [enableSystemNotifications, t]);

  useEffect(() => {
    if (!enableSystemNotifications) return;
    if (!isTauriRuntime()) return;

    const finalTasks = [...items]
      .filter((task) => task.status === 'completed' || task.status === 'failed' || task.status === 'partial')
      .sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt).getTime();
        return bTime - aTime;
      })
      .filter((task) => {
        const taskTime = new Date(task.updatedAt || task.createdAt).getTime();
        const baseline = enableBaselineRef.current;
        if (baseline != null && Number.isFinite(taskTime) && taskTime < baseline) {
          return false;
        }

        const currentSignature = `${task.status}:${task.updatedAt || task.createdAt}`;
        const previousSignature = lastStatusSignatureRef.current.get(task.id);
        return currentSignature !== previousSignature;
      });
    if (!finalTasks.length) return;

    const notify = async () => {
      try {
        if (notifyOnlyWhenBackground) {
          const isVisible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const appWindow = getCurrentWindow();
          const [focused, visible] = await Promise.all([
            appWindow.isFocused().catch(() => false),
            appWindow.isVisible().catch(() => true)
          ]);
          if (isVisible && focused && visible) {
            return;
          }
        }

        const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
        let permissionGranted = await isPermissionGranted();
        if (!permissionGranted) {
          const permission = await requestPermission();
          permissionGranted = permission === 'granted';
        }
        if (!permissionGranted) return;

        for (const task of finalTasks) {
          const finalStatus = task.status as FinalTaskStatus;
          if (!shouldNotifyForStatus(finalStatus, notifyOnFailure)) continue;

          const signature = `${task.id}:${finalStatus}:${task.updatedAt || task.createdAt}`;
          if (notifiedRef.current.has(signature)) continue;

          const copy = getNotificationCopy(task, t);
          await sendNotification({
            title: copy.title,
            body: copy.body
          });
          notifiedRef.current.add(signature);
          lastStatusSignatureRef.current.set(task.id, `${task.status}:${task.updatedAt || task.createdAt}`);
        }
      } catch (error) {
        console.warn('[notification] send failed', error);
      }
    };

    void notify();
  }, [items, enableSystemNotifications, notifyOnlyWhenBackground, notifyOnFailure, t]);
}

export async function sendTestSystemNotification(t: (key: string, params?: Record<string, unknown>) => string) {
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
    let permissionGranted = await isPermissionGranted();
    console.info('[notification] test permission state', { permissionGranted });
    if (!permissionGranted) {
      const permission = await requestPermission();
      console.info('[notification] test requestPermission result', { permission });
      permissionGranted = permission === 'granted';
    }
    if (!permissionGranted) {
      toast.info(t('settings.notifications.permissionDenied'));
      return;
    }

    await sendNotification({
      title: t('notifications.status.completed.title'),
      body: 'Notification permission probe'
    });
    console.info('[notification] test notification sent');
    toast.success(t('settings.notifications.testSent'));
  } catch (error) {
    console.error('[notification] test notification failed', error);
    const message = error instanceof Error ? error.message : String(error);
    toast.error(t('settings.notifications.testFailed', { message }));
  }
}
