import { create } from 'zustand';
import { toast } from './toastStore';
import i18n from '../i18n';

type UpdaterStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'installed' | 'error';

type Progress = {
  downloaded: number;
  total: number;
};

type UpdateLike = {
  version: string;
  date?: string | null;
  body?: string | null;
  download: (
    onEvent?: (event: any) => void
  ) => Promise<void>;
  install: () => Promise<void>;
  downloadAndInstall: (
    onEvent?: (event: any) => void
  ) => Promise<void>;
};

interface UpdaterState {
  isOpen: boolean;
  status: UpdaterStatus;
  update: UpdateLike | null;
  progress: Progress | null;
  error: string | null;

  open: () => void;
  close: () => void;
  reset: () => void;
  checkForUpdates: (options?: { silent?: boolean; openIfAvailable?: boolean }) => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
}

const isTauri = () => typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

let inFlightCheck: Promise<void> | null = null;
let inFlightDownload: Promise<void> | null = null;
let inFlightInstall: Promise<void> | null = null;
let checkSequence = 0;

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  isOpen: false,
  status: 'idle',
  update: null,
  progress: null,
  error: null,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  reset: () => set({ status: 'idle', update: null, progress: null, error: null, isOpen: false }),

  checkForUpdates: async (options) => {
    if (!isTauri()) return;
    if (get().status === 'checking') return;
    if (inFlightCheck) return inFlightCheck;

    const silent = Boolean(options?.silent);
    const openIfAvailable = options?.openIfAvailable !== false;

    const currentCheckId = ++checkSequence;
    inFlightCheck = (async () => {
      set({ status: 'checking', error: null, progress: null });
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        const isMac = /Macintosh|Mac OS X/i.test(ua);

        // 兼容：如果你的发布策略包含 macOS Universal 包，`latest.json` 里可能使用自定义 target。
        // 默认先按系统/架构检查；失败时在 macOS 上尝试几个常见的 universal target 名称。
        const targets: Array<string | undefined> = isMac
          ? [undefined, 'macos-universal', 'darwin-universal', 'universal-apple-darwin']
          : [undefined];

        const CHECK_TIMEOUT_MS = 12000;
        let update: UpdateLike | null = null;
        let lastErr: unknown = null;

        const runCheckWithTimeout = async (target: string | undefined) => {
          let timer: ReturnType<typeof setTimeout> | null = null;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error('update check timeout'));
            }, CHECK_TIMEOUT_MS);
          });
          try {
            return await Promise.race([check(target ? { target } : undefined), timeoutPromise]) as UpdateLike | null;
          } finally {
            if (timer) clearTimeout(timer);
          }
        };

        for (const target of targets) {
          try {
            update = await runCheckWithTimeout(target);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
          }
        }

        if (lastErr) throw lastErr;
        if (currentCheckId !== checkSequence) return;

        if (!update) {
          set({ status: 'idle', update: null, progress: null });
          if (!silent) toast.success(i18n.t('settings.update.latest'));
          return;
        }

        set({ status: 'available', update, progress: null });
        if (openIfAvailable) set({ isOpen: true });
      } catch (err) {
        console.error('[updater] check failed:', err);
        if (currentCheckId !== checkSequence) return;
        const rawMessage = err instanceof Error ? err.message : i18n.t('updater.toast.checkFailed');
        const message = (() => {
          const text = String(rawMessage || '').trim();
          const lower = text.toLowerCase();
          if ((lower.includes('404') || lower.includes('not found')) && lower.includes('latest.json')) {
            return i18n.t('updater.toast.checkFailedManifest');
          }
          if (lower.includes('pubkey') || lower.includes('public key')) {
            return i18n.t('updater.toast.checkFailedPubkey');
          }
          if (
            lower.includes('failed to connect') ||
            lower.includes('timed out') ||
            lower.includes('timeout') ||
            lower.includes('connection refused')
          ) {
            return i18n.t('updater.toast.checkFailedNetwork');
          }
          return text || i18n.t('updater.toast.checkFailed');
        })();

        set({ status: 'error', error: rawMessage });
        if (!silent) {
          // 常见：pubkey 未配置 / latest.json 不存在 / 网络问题
          toast.error(message || i18n.t('updater.toast.checkFailed'));
        }
      } finally {
        inFlightCheck = null;
      }
    })();

    return inFlightCheck;
  },

  downloadUpdate: async () => {
    if (!isTauri()) return;
    const update = get().update;
    if (!update) return;
    if (get().status === 'downloading' || get().status === 'downloaded' || get().status === 'installing') return;
    if (inFlightDownload) return inFlightDownload;

    inFlightDownload = (async () => {
      set({ status: 'downloading', progress: { downloaded: 0, total: 0 }, error: null });
      try {
        let downloaded = 0;
        let total = 0;

        await update.download((event: any) => {
          try {
            switch (event?.event) {
              case 'Started': {
                total = Number(event?.data?.contentLength || 0);
                downloaded = 0;
                set({ status: 'downloading', progress: { downloaded, total } });
                break;
              }
              case 'Progress': {
                const chunk = Number(event?.data?.chunkLength || 0);
                downloaded += chunk;
                set({ status: 'downloading', progress: { downloaded, total } });
                break;
              }
              case 'Finished': {
                if (total > 0) {
                  downloaded = total;
                }
                set({ status: 'downloading', progress: { downloaded, total } });
                break;
              }
              default:
                break;
            }
          } catch {}
        });

        set({ status: 'downloaded', progress: { downloaded, total } });
        toast.success(i18n.t('updater.toast.downloaded'));
      } catch (err) {
        console.error('[updater] download failed:', err);
        const message = err instanceof Error ? err.message : i18n.t('updater.toast.downloadFailed');
        set({ status: 'error', error: message });
        toast.error(message || i18n.t('updater.toast.downloadFailed'));
      } finally {
        inFlightDownload = null;
      }
    })();

    return inFlightDownload;
  },

  installUpdate: async () => {
    if (!isTauri()) return;
    const update = get().update;
    if (!update) return;
    if (get().status !== 'downloaded') return;
    if (inFlightInstall) return inFlightInstall;

    inFlightInstall = (async () => {
      set({ status: 'installing', error: null });
      try {
        await update.install();
        set({ status: 'installed' });
        toast.success(i18n.t('updater.toast.installed'));

        try {
          const { relaunch } = await import('@tauri-apps/plugin-process');
          await relaunch();
        } catch (err) {
          console.warn('[updater] relaunch failed:', err);
          toast.info(i18n.t('updater.toast.installManual'));
        }
      } catch (err) {
        console.error('[updater] install failed:', err);
        const message = err instanceof Error ? err.message : i18n.t('updater.toast.installFailed');
        set({ status: 'error', error: message });
        toast.error(message || i18n.t('updater.toast.installFailed'));
      } finally {
        inFlightInstall = null;
      }
    })();

    return inFlightInstall;
  },
}));
