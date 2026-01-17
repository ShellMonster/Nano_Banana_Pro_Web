import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpCircle, Github, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUpdaterStore } from '../../store/updaterStore';
import { useGenerateStore } from '../../store/generateStore';
import { cn } from './Button';

export function VersionBadge() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string>('');
  const [manualHint, setManualHint] = useState<'checking' | 'latest' | 'error' | 'available' | 'not-tauri' | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const status = useUpdaterStore((s) => s.status);
  const update = useUpdaterStore((s) => s.update);
  const progress = useUpdaterStore((s) => s.progress);
  const openUpdater = useUpdaterStore((s) => s.open);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);

  useEffect(() => {
    let canceled = false;
    const load = async () => {
      try {
        if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
          const { getVersion } = await import('@tauri-apps/api/app');
          const v = await getVersion();
          if (!canceled) setVersion(v);
          return;
        }
      } catch {}

      if (!canceled) setVersion(import.meta.env.DEV ? 'dev' : '');
    };

    load();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }
    };
  }, []);

  const hasUpdate = status === 'available' && Boolean(update);
  const isDownloading = status === 'downloading';
  const isDownloaded = status === 'downloaded';
  const isInstalling = status === 'installing';
  const isBusy = isDownloading || isDownloaded || isInstalling;

  const currentTab = useGenerateStore((s) => s.currentTab);
  const generateCount = useGenerateStore((s) => s.images.length);
  const shouldLiftOnDesktop = currentTab === 'generate' && generateCount > 0;

  const percent = useMemo(() => {
    const total = progress?.total || 0;
    const downloaded = progress?.downloaded || 0;
    if (total <= 0) return isDownloaded ? 100 : 0;
    return Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)));
  }, [progress?.downloaded, progress?.total, isDownloaded]);

  const title = useMemo(() => {
    if (isDownloading) return t('versionBadge.downloading', { percent });
    if (isInstalling) return t('versionBadge.installing');
    if (isDownloaded) return t('versionBadge.downloaded');
    if (hasUpdate) return t('versionBadge.available', { version: update?.version || '' });
    return t('versionBadge.check');
  }, [hasUpdate, isDownloaded, isDownloading, isInstalling, percent, t, update?.version]);

  const hintText = useMemo(() => {
    switch (manualHint) {
      case 'checking':
        return t('versionBadge.checking');
      case 'latest':
        return t('versionBadge.latest');
      case 'error':
        return t('versionBadge.error');
      case 'available':
        return t('versionBadge.availableShort');
      case 'not-tauri':
        return t('versionBadge.desktopOnly');
      default:
        return '';
    }
  }, [manualHint, t]);

  const setHintWithAutoClear = (next: typeof manualHint, durationMs = 2000) => {
    setManualHint(next);
    if (hintTimerRef.current) {
      clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
    if (durationMs > 0) {
      hintTimerRef.current = setTimeout(() => {
        setManualHint(null);
        hintTimerRef.current = null;
      }, durationMs);
    }
  };

  const handleClick = async () => {
    if (hasUpdate || isBusy) {
      openUpdater();
      return;
    }
    if (manualHint === 'checking') return;

    const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
    if (!isTauri) {
      setHintWithAutoClear('not-tauri', 2000);
      return;
    }

    setHintWithAutoClear('checking', 0);
    try {
      await checkForUpdates({ silent: true, openIfAvailable: false });
    } catch {}

    const latest = useUpdaterStore.getState();
    if (latest.status === 'available' && latest.update) {
      setHintWithAutoClear('available', 2500);
      openUpdater();
      return;
    }
    if (latest.status === 'error') {
      setHintWithAutoClear('error', 2500);
      return;
    }
    setHintWithAutoClear('latest', 2000);
  };

  const repoUrl = import.meta.env.VITE_GITHUB_REPO_URL || '';

  const handleOpenRepo = async () => {
    if (!repoUrl) return;
    try {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(repoUrl);
        return;
      }
      window.open(repoUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('Open repo failed:', err);
    }
  };

  const displayText = useMemo(() => {
    if (isDownloading) return t('versionBadge.updateProgress', { percent });
    if (isInstalling) return t('versionBadge.installingShort');
    if (isDownloaded) return t('versionBadge.pendingInstall');
    if (manualHint) return hintText;
    return t('versionBadge.version', { version: version || '—' });
  }, [hintText, isDownloaded, isDownloading, isInstalling, manualHint, percent, t, version]);

  const showSpinner = manualHint === 'checking' || isDownloading || isInstalling;
  const showUpdateIcon = !showSpinner && (hasUpdate || isDownloaded);
  const buttonTitle = manualHint && !isBusy ? hintText : title;

  return (
    <div
      className={cn(
        'fixed right-4 bottom-24 z-[55] inline-flex items-center gap-2',
        shouldLiftOnDesktop ? 'md:bottom-24' : 'md:bottom-4'
      )}
      style={{ WebkitAppRegion: 'no-drag' } as any}
    >
      <button
        type="button"
        onClick={handleOpenRepo}
        title={repoUrl || t('versionBadge.repoMissing')}
        className={cn(
          'inline-flex items-center justify-center p-2 rounded-xl',
          'bg-white/70 backdrop-blur-md border border-slate-200/60 shadow-sm',
          'text-slate-500 hover:text-slate-700 hover:bg-white transition-colors'
        )}
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        <Github className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={handleClick}
        title={buttonTitle}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl',
          'bg-white/70 backdrop-blur-md border border-slate-200/60 shadow-sm',
          'text-xs text-slate-500 hover:text-slate-700 hover:bg-white transition-colors'
        )}
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        {showSpinner ? (
          <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
        ) : (
          showUpdateIcon && <ArrowUpCircle className="w-4 h-4 text-blue-600" />
        )}
        <span className="font-mono font-bold">
          {displayText}
        </span>
      </button>
    </div>
  );
}
