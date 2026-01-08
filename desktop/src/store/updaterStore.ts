import { create } from 'zustand';
import { toast } from './toastStore';

type UpdaterStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'installed' | 'error';

type Progress = {
  downloaded: number;
  total: number;
};

type UpdateLike = {
  version: string;
  date?: string | null;
  body?: string | null;
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
  downloadAndInstall: () => Promise<void>;
}

const isTauri = () => typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

let inFlightCheck: Promise<void> | null = null;
let inFlightInstall: Promise<void> | null = null;

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

        let update: UpdateLike | null = null;
        let lastErr: unknown = null;
        for (const target of targets) {
          try {
            update = (await check(target ? { target } : undefined)) as UpdateLike | null;
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
          }
        }

        if (lastErr) throw lastErr;

        if (!update) {
          set({ status: 'idle', update: null, progress: null });
          if (!silent) toast.success('已是最新版本');
          return;
        }

        set({ status: 'available', update, progress: null });
        if (openIfAvailable) set({ isOpen: true });
      } catch (err) {
        console.error('[updater] check failed:', err);
        const rawMessage = err instanceof Error ? err.message : '检查更新失败';
        const message = (() => {
          const text = String(rawMessage || '').trim();
          const lower = text.toLowerCase();
          if ((lower.includes('404') || lower.includes('not found')) && lower.includes('latest.json')) {
            return '检查更新失败：未找到更新清单（latest.json）。请确认已发布带 Updater 产物的 Release。';
          }
          if (lower.includes('pubkey') || lower.includes('public key')) {
            return '检查更新失败：Updater 公钥未配置或与签名不匹配。';
          }
          if (
            lower.includes('failed to connect') ||
            lower.includes('timed out') ||
            lower.includes('timeout') ||
            lower.includes('connection refused')
          ) {
            return '检查更新失败：网络连接失败，请稍后重试。';
          }
          return text || '检查更新失败';
        })();

        set({ status: 'error', error: rawMessage });
        if (!silent) {
          // 常见：pubkey 未配置 / latest.json 不存在 / 网络问题
          toast.error(message || '检查更新失败');
        }
      } finally {
        inFlightCheck = null;
      }
    })();

    return inFlightCheck;
  },

  downloadAndInstall: async () => {
    if (!isTauri()) return;
    const update = get().update;
    if (!update) return;
    if (get().status === 'downloading' || get().status === 'installing') return;
    if (inFlightInstall) return inFlightInstall;

    inFlightInstall = (async () => {
      set({ status: 'downloading', progress: { downloaded: 0, total: 0 }, error: null });
      try {
        let downloaded = 0;
        let total = 0;

        await update.downloadAndInstall((event: any) => {
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
                set({ status: 'installing' });
                break;
              }
              default:
                break;
            }
          } catch {}
        });

        set({ status: 'installed' });
        toast.success('更新已安装，正在重启...');

        try {
          const { relaunch } = await import('@tauri-apps/plugin-process');
          await relaunch();
        } catch (err) {
          console.warn('[updater] relaunch failed:', err);
          toast.info('更新已安装，请手动重启应用');
        }
      } catch (err) {
        console.error('[updater] download/install failed:', err);
        const message = err instanceof Error ? err.message : '更新失败';
        set({ status: 'error', error: message });
        toast.error(message || '更新失败');
      } finally {
        inFlightInstall = null;
      }
    })();

    return inFlightInstall;
  },
}));
