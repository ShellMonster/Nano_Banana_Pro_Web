import React, { useEffect, useMemo, useRef } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';
import { Button, cn } from './Button';
import { useUpdaterStore } from '../../store/updaterStore';

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function UpdaterModal() {
  const { isOpen, status, update, progress, error, close, checkForUpdates, downloadUpdate, installUpdate } =
    useUpdaterStore();

  const autoCheckedRef = useRef(false);

  useEffect(() => {
    if (autoCheckedRef.current) return;
    autoCheckedRef.current = true;

    // 只在桌面端生产环境自动检查，避免开发时 StrictMode 重复触发和打扰
    if (!import.meta.env.PROD) return;
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) return;

    const t = window.setTimeout(() => {
      checkForUpdates({ silent: true, openIfAvailable: true }).catch(() => {});
    }, 1500);

    return () => window.clearTimeout(t);
  }, [checkForUpdates]);

  const percent = useMemo(() => {
    const total = progress?.total || 0;
    const downloaded = progress?.downloaded || 0;
    if (total <= 0) return status === 'downloaded' ? 100 : 0;
    return Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)));
  }, [progress?.downloaded, progress?.total, status]);

  const isDownloading = status === 'downloading';
  const canClose = status !== 'installing';
  const dismissLabel = isDownloading ? '后台下载' : '稍后';

  const title = (() => {
    if (status === 'checking') return '正在检查更新...';
    if (status === 'downloading') return '正在下载更新...';
    if (status === 'downloaded') return '更新已下载';
    if (status === 'installing') return '正在安装更新...';
    if (status === 'installed') return '更新完成';
    if (status === 'error') return '更新失败';
    return '发现新版本';
  })();

  const body = (() => {
    if (!update) return '';
    const notes = String(update.body || '').trim();
    return notes;
  })();

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!canClose) return;
        close();
      }}
      title={title}
      className="max-w-lg"
    >
      <div className="space-y-5">
        {update && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-slate-500">新版本</div>
                <div className="text-xl font-black text-slate-900 tracking-tight truncate">
                  v{update.version}
                </div>
              </div>
              {update.date ? (
                <div className="text-xs text-slate-400 whitespace-nowrap">
                  {new Date(update.date).toLocaleString('zh-CN', { hour12: false })}
                </div>
              ) : null}
            </div>
          </div>
        )}

        {status === 'downloading' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>下载进度</span>
              <span className="font-mono tabular-nums">
                {percent}% {progress?.total ? `(${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)})` : ''}
              </span>
            </div>
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-200 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="text-xs text-slate-500">
              你可以关闭窗口继续使用，下载会在后台进行。
            </div>
          </div>
        )}

        {status === 'downloaded' && (
          <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-2xl p-3">
            更新包已下载，点击“安装并重启”完成更新。
          </div>
        )}

        {status === 'installing' && (
          <div className="flex items-center gap-2 text-sm text-blue-600 font-bold">
            <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            正在安装，请勿关闭应用
          </div>
        )}

        {status === 'error' && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-2xl p-3">
            {error || '更新失败，请稍后重试'}
            <div className="text-xs text-red-500 mt-1">
              若你刚集成 Updater，请先在 `desktop/src-tauri/tauri.conf.json` 填入 `plugins.updater.pubkey` 并在 CI 配置 `TAURI_SIGNING_PRIVATE_KEY`。
            </div>
          </div>
        )}

        {body && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">
            {body}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => close()}
            disabled={!canClose}
            className={cn(!canClose && 'opacity-50')}
          >
            {dismissLabel}
          </Button>

          {status === 'available' && (
            <Button type="button" onClick={() => downloadUpdate()} className="bg-blue-600">
              <Download className="w-4 h-4 mr-2" />
              下载更新
            </Button>
          )}

          {status === 'downloaded' && (
            <Button type="button" onClick={() => installUpdate()} className="bg-blue-600">
              <Download className="w-4 h-4 mr-2" />
              安装并重启
            </Button>
          )}

          {(status === 'idle' || status === 'error') && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => checkForUpdates({ silent: false, openIfAvailable: true })}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              重新检查
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
