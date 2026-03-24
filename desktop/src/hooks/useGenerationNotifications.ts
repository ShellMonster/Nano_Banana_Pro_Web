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
  if (status === 'failed' || status === 'partial') return notifyOnFailure;
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

const getTaskSignature = (task: HistoryItem) => `${task.status}:${task.updatedAt || task.createdAt}`;

const getTaskNotificationPayload = (
  tasks: HistoryItem[],
  t: (key: string, params?: Record<string, unknown>) => string
) => {
  const [firstTask] = tasks;
  const copy = getNotificationCopy(firstTask, t);
  if (tasks.length === 1) {
    return copy;
  }

  const promptSummary = getTaskPromptSummary(firstTask);
  const additionalCount = tasks.length - 1;
  return {
    title: t(`notifications.status.${firstTask.status}.batchTitle`, { count: tasks.length }),
    body: promptSummary
      ? t(`notifications.status.${firstTask.status}.batchBodyWithPrompt`, {
          prompt: promptSummary,
          count: tasks.length,
          additionalCount
        })
      : t(`notifications.status.${firstTask.status}.batchBody`, {
          count: tasks.length,
          additionalCount
        })
  };
};

export async function ensureNotificationPermission(
  t: (key: string, params?: Record<string, unknown>) => string,
  options?: { showDeniedToast?: boolean; source?: 'startup' | 'settings' | 'test' | 'task' }
) {
  const showDeniedToast = options?.showDeniedToast ?? true;
  const source = options?.source || 'startup';

  const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
  let permissionGranted = await isPermissionGranted();
  console.info('[notification] permission state', { source, permissionGranted });
  if (!permissionGranted) {
    const permission = await requestPermission();
    console.info('[notification] requestPermission result', { source, permission });
    permissionGranted = permission === 'granted';
  }

  if (!permissionGranted && showDeniedToast) {
    toast.info(t('settings.notifications.permissionDenied'));
  }

  return permissionGranted;
}

const getWindowVisibilitySnapshot = async () => {
  const visibilityState = typeof document !== 'undefined' ? document.visibilityState : 'visible';
  let focused = true;
  let visible = true;

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const appWindow = getCurrentWindow();
    [focused, visible] = await Promise.all([
      appWindow.isFocused().catch(() => false),
      appWindow.isVisible().catch(() => true)
    ]);
  } catch (error) {
    console.warn('[notification] window visibility probe failed', error);
  }

  return {
    visibilityState,
    focused,
    visible
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
        const permissionGranted = await ensureNotificationPermission(t, {
          showDeniedToast: false,
          source: 'startup'
        });
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

    const signatureSnapshot = new Map(lastStatusSignatureRef.current);
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

        const currentSignature = getTaskSignature(task);
        const previousSignature = signatureSnapshot.get(task.id);
        return currentSignature !== previousSignature;
      });
    if (!finalTasks.length) return;

    const notify = async () => {
      try {
        const visibility = await getWindowVisibilitySnapshot();
        let { visibilityState, focused, visible } = visibility;

        if (notifyOnlyWhenBackground) {
          const isVisible = visibilityState === 'visible';
          if (isVisible && focused && visible) {
            console.info('[notification] skipped: app visible in foreground', {
              taskIds: finalTasks.map((task) => task.id),
              statuses: finalTasks.map((task) => task.status),
              visibilityState,
              focused,
              visible
            });
            return;
          }
        }

        const { sendNotification } = await import('@tauri-apps/plugin-notification');
        const permissionGranted = await ensureNotificationPermission(t, {
          showDeniedToast: false,
          source: 'task'
        });
        if (!permissionGranted) {
          console.info('[notification] skipped: permission not granted', {
            taskIds: finalTasks.map((task) => task.id),
            statuses: finalTasks.map((task) => task.status)
          });
          return;
        }

        const tasksToNotify = finalTasks.filter((task) => {
          const finalStatus = task.status as FinalTaskStatus;
          if (!shouldNotifyForStatus(finalStatus, notifyOnFailure)) {
            signatureSnapshot.set(task.id, getTaskSignature(task));
            console.info('[notification] skipped: failure notifications disabled', {
              taskId: task.id,
              status: task.status
            });
            return false;
          }

          const signature = `${task.id}:${finalStatus}:${task.updatedAt || task.createdAt}`;
          if (notifiedRef.current.has(signature)) {
            signatureSnapshot.set(task.id, getTaskSignature(task));
            console.info('[notification] skipped: already notified', {
              taskId: task.id,
              status: task.status
            });
            return false;
          }

          return true;
        });

        if (!tasksToNotify.length) {
          lastStatusSignatureRef.current = signatureSnapshot;
          return;
        }

        const groupedTasks = new Map<FinalTaskStatus, HistoryItem[]>();
        for (const task of tasksToNotify) {
          const status = task.status as FinalTaskStatus;
          const list = groupedTasks.get(status) || [];
          list.push(task);
          groupedTasks.set(status, list);
        }

        const statusOrder: FinalTaskStatus[] = ['failed', 'partial', 'completed'];
        for (const status of statusOrder) {
          const tasks = groupedTasks.get(status);
          if (!tasks?.length) continue;

          const payload = getTaskNotificationPayload(tasks, t);
          await sendNotification({
            title: payload.title,
            body: payload.body
          });
          console.info('[notification] task notification sent', {
            taskIds: tasks.map((task) => task.id),
            status,
            count: tasks.length,
            title: payload.title,
            body: payload.body,
            notifyOnlyWhenBackground,
            visibilityState,
            focused,
            visible
          });

          for (const task of tasks) {
            const signature = `${task.id}:${status}:${task.updatedAt || task.createdAt}`;
            notifiedRef.current.add(signature);
            signatureSnapshot.set(task.id, getTaskSignature(task));
          }
        }

        lastStatusSignatureRef.current = signatureSnapshot;
      } catch (error) {
        console.warn('[notification] send failed', error);
      }
    };

    void notify();
  }, [items, enableSystemNotifications, notifyOnlyWhenBackground, notifyOnFailure, t]);
}

export async function sendTestSystemNotification(t: (key: string, params?: Record<string, unknown>) => string) {
  try {
    const { sendNotification } = await import('@tauri-apps/plugin-notification');
    const permissionGranted = await ensureNotificationPermission(t, {
      showDeniedToast: true,
      source: 'test'
    });
    if (!permissionGranted) {
      return;
    }

    const visibility = await getWindowVisibilitySnapshot();
    const title = t('notifications.status.completed.title');
    const body = t('settings.notifications.testProbeBody');

    await sendNotification({
      title,
      body
    });
    console.info('[notification] test notification sent', {
      title,
      body,
      ...visibility
    });
    toast.success(t('settings.notifications.testSent'));
  } catch (error) {
    console.error('[notification] test notification failed', error);
    const message = error instanceof Error ? error.message : String(error);
    toast.error(t('settings.notifications.testFailed', { message }));
  }
}
