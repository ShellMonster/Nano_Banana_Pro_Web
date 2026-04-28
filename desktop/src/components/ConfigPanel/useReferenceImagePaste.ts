import React, { useCallback, useEffect } from 'react';
import type { TFunction } from 'i18next';
import { toast } from '../../store/toastStore';
import type { ExtendedFile } from '../../types';

type UseReferenceImagePasteOptions = {
  isExpanded: boolean;
  setIsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  refFilesLength: number;
  addRefFiles: (files: File[]) => void;
  withProcessingLock: <T>(fn: () => Promise<T>) => Promise<T>;
  processFilesWithMd5: (files: File[]) => Promise<File[]>;
  fileMd5SetRef: React.MutableRefObject<Set<string>>;
  buildPathMd5: (path: string) => string;
  busyErrorMessage: string;
  t: TFunction;
};

const isEditableElementTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  return target.isContentEditable;
};

const extractImageFilesFromClipboard = (clipboardData: DataTransfer | null): File[] => {
  if (!clipboardData) return [];
  const files: File[] = [];

  // 1) items（最常见：截图/复制图片）
  const items = Array.from(clipboardData.items);
  if (items.length > 0) {
    items.forEach((item) => {
      if (item.type && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    });
  }

  // 2) files（部分平台会把图片放在 files 里）
  if (clipboardData.files.length > 0) {
    Array.from(clipboardData.files).forEach((file) => {
      if (file.type && file.type.startsWith('image/')) files.push(file);
    });
  }

  return files;
};

export function useReferenceImagePaste({
  isExpanded,
  setIsExpanded,
  refFilesLength,
  addRefFiles,
  withProcessingLock,
  processFilesWithMd5,
  fileMd5SetRef,
  buildPathMd5,
  busyErrorMessage,
  t,
}: UseReferenceImagePasteOptions) {
  const processPastedFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    // 收起状态也允许粘贴：自动展开，避免“无提示/无响应”的体验
    if (!isExpanded) {
      setIsExpanded(true);
    }

    await withProcessingLock(async () => {
      const remainingSlots = 10 - refFilesLength;
      if (remainingSlots <= 0) {
        toast.error(t('refImage.toast.full'));
        return;
      }

      const clipped = files.slice(0, remainingSlots);
      if (files.length > remainingSlots) {
        toast.error(t('refImage.toast.remainingSlots', { count: remainingSlots }));
      }

      const uniqueFiles = await processFilesWithMd5(clipped);
      if (uniqueFiles.length > 0) {
        addRefFiles(uniqueFiles);
        const compressedFiles = uniqueFiles.filter(file => (file as ExtendedFile).__compressed);
        if (compressedFiles.length > 0) {
          toast.success(t('refImage.toast.addedCompressed', { count: uniqueFiles.length, compressed: compressedFiles.length }));
        } else {
          toast.success(t('refImage.toast.addedCount', { count: uniqueFiles.length }));
        }
      } else {
        toast.info(t('refImage.toast.exists'));
      }
    });
  }, [addRefFiles, isExpanded, processFilesWithMd5, refFilesLength, setIsExpanded, t, withProcessingLock]);

  const tryPasteFromTauriClipboard = useCallback(async () => {
    const remainingSlots = 10 - refFilesLength;
    if (remainingSlots <= 0) {
      toast.error(t('refImage.toast.full'));
      return;
    }

    // 收起状态也允许粘贴：自动展开
    if (!isExpanded) {
      setIsExpanded(true);
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const path = await invoke<string | null>('read_image_from_clipboard');
      const imagePath = (path || '').trim();
      if (!imagePath) return; // 剪贴板里没有图片：静默忽略

      const md5Key = buildPathMd5(imagePath);
      if (fileMd5SetRef.current.has(md5Key)) {
        toast.info(t('refImage.toast.exists'));
        return;
      }

      const name = imagePath.split(/[/\\]/).pop() || `clipboard-${Date.now()}.png`;
      const file = new File([], name, { type: 'image/png' }) as ExtendedFile;
      file.__path = imagePath;
      file.__md5 = md5Key;

      addRefFiles([file]);
      toast.success(t('refImage.toast.addedOne'));
    } catch (err) {
      // 原生读取失败：静默忽略，避免影响正常文本粘贴体验
      console.warn('[ReferenceImageUpload] read_image_from_clipboard failed:', err);
    }
  }, [addRefFiles, buildPathMd5, fileMd5SetRef, isExpanded, refFilesLength, setIsExpanded, t]);

  const handlePaste = useCallback(async (event: React.ClipboardEvent) => {
    const files = extractImageFilesFromClipboard(event.clipboardData || null);
    if (files.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      try {
        await processPastedFiles(files);
      } catch (error) {
        if (error instanceof Error && error.message === busyErrorMessage) {
          toast.info(t('refImage.toast.busy'));
        } else {
          console.error('Paste image failed:', error);
          const message = error instanceof Error ? error.message : t('refImage.toast.unknown');
          toast.error(t('refImage.toast.pasteFailed', { message }));
        }
      }
      return;
    }

    const isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
    if (!isTauri) return;

    // 如果用户在粘贴纯文本（且当前在输入框内），不要触发原生读取，避免拖慢输入体验
    const plain = (event.clipboardData?.getData('text/plain') || '').trim();
    if (plain && isEditableElementTarget(event.target)) return;

    // 兜底：Tauri 打包环境下 Web ClipboardData 可能拿不到图片数据，尝试原生读取
    void tryPasteFromTauriClipboard();
  }, [busyErrorMessage, processPastedFiles, t, tryPasteFromTauriClipboard]);

  // 全局 paste 捕获：不要求用户必须聚焦参考图区域
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;

      const files = extractImageFilesFromClipboard(event.clipboardData);
      if (files.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        void processPastedFiles(files);
        return;
      }

      const isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
      if (!isTauri) return;

      const plain = (event.clipboardData.getData('text/plain') || '').trim();
      if (plain && isEditableElementTarget(event.target)) return;

      void tryPasteFromTauriClipboard();
    };

    window.addEventListener('paste', onPaste, true);
    return () => {
      window.removeEventListener('paste', onPaste, true);
    };
  }, [processPastedFiles, tryPasteFromTauriClipboard]);

  return { handlePaste };
}
