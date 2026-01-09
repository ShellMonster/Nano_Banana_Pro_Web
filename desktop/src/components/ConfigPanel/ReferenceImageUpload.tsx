import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ImagePlus, X, Image as ImageIcon, ChevronDown, ChevronUp } from 'lucide-react';
import { useConfigStore } from '../../store/configStore';
import { useInternalDragStore, type InternalDragPayload } from '../../store/internalDragStore';
import { cn } from '../common/Button';
import { toast } from '../../store/toastStore';
import { ExtendedFile } from '../../types';
import { calculateMd5, compressImage, fetchFileWithMd5 } from '../../utils/image';
import { getImageUrl } from '../../services/api';

export function ReferenceImageUpload() {
  const refFiles = useConfigStore((s) => s.refFiles);
  const addRefFiles = useConfigStore((s) => s.addRefFiles);
  const removeRefFile = useConfigStore((s) => s.removeRefFile);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const objectUrlsRef = useRef<Map<string, string>>(new Map());
  const fileMd5SetRef = useRef<Set<string>>(new Set());
  const fileMd5MapRef = useRef<Map<string, string>>(new Map());
  const isProcessingRef = useRef<boolean>(false); // 防止并发操作
  const prevRefFilesLengthRef = useRef(0); // 记录上一次 refFiles 的长度，用于检测新增文件
  const isInternalDragging = useInternalDragStore((s) => s.isDragging);
  const isOverDropTarget = useInternalDragStore((s) => s.isOverDropTarget);
  const setDropTarget = useInternalDragStore((s) => s.setDropTarget);
  const dropPayload = useInternalDragStore((s) => s.droppedPayload);
  const dropCounter = useInternalDragStore((s) => s.dropCounter);
  const clearDrop = useInternalDragStore((s) => s.clearDrop);

  // 计算文件 MD5（使用工具函数）
  const calculateMd5Callback = useCallback(calculateMd5, []);

  // 清理 ObjectURL 防止内存泄漏
  useEffect(() => {
    return () => {
      // 组件卸载时清理所有 ObjectURL
      objectUrlsRef.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      objectUrlsRef.current.clear();
    };
  }, []);

  // 同步 MD5 集合：监听 refFiles 变化，只计算新增文件的 MD5
  useEffect(() => {
    const syncMd5Set = async () => {
      const currentLength = refFiles.length;
      const prevLength = prevRefFilesLengthRef.current;

      // 清空情况：refFiles 被完全清空（如生成完成后）
      if (currentLength === 0 && prevLength > 0) {
        fileMd5SetRef.current.clear();
        fileMd5MapRef.current.clear();
        prevRefFilesLengthRef.current = 0;
        return;
      }

      // 新增文件：只计算新增部分的 MD5
      if (currentLength > prevLength) {
        const newFiles = refFiles.slice(prevLength); // 获取新增的文件
        for (const file of newFiles) {
          // 优先使用已缓存的 MD5（从 __md5 属性）
          let md5 = (file as ExtendedFile).__md5;
          if (!md5) {
            md5 = await calculateMd5Callback(file);
            if (md5) {
              (file as ExtendedFile).__md5 = md5; // 缓存到文件对象上
            }
          }
          if (md5) {
            fileMd5SetRef.current.add(md5);
            fileMd5MapRef.current.set(md5, md5);
          }
        }
        prevRefFilesLengthRef.current = currentLength;
      }
      // 删除文件：handleRemoveFile 已处理，这里不需要处理
    };
    syncMd5Set();
  }, [refFiles, calculateMd5Callback]);

  // 当 refFiles 变化时，清理不再需要的 ObjectURL
  useEffect(() => {
    // 使用 MD5 或文件属性作为唯一标识
    const currentKeys = new Set(refFiles.map((f) => (f as ExtendedFile).__md5 || `${f.name}-${f.size}-${f.lastModified}`));
    const existingKeys = new Set(objectUrlsRef.current.keys());

    // 清理已删除文件的 ObjectURL
    existingKeys.forEach((key) => {
      if (!currentKeys.has(key)) {
        const url = objectUrlsRef.current.get(key);
        if (url) {
          // 只清理 blob: 协议的 URL，不处理 asset:// 协议
          if (url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
          }
          objectUrlsRef.current.delete(key);
        }
      }
    });
  }, [refFiles]);

  useEffect(() => {
    setDropTarget(dropRef.current);
    return () => {
      setDropTarget(null);
    };
  }, [setDropTarget]);

  // 带并发保护的包装函数（添加超时机制）
  const withProcessingLock = useCallback(async (fn: () => Promise<any>, timeoutMs: number = 60000) => {
    if (isProcessingRef.current) {
      throw new Error('操作正在进行中，请稍候');
    }

    isProcessingRef.current = true;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    // 创建超时 Promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`操作超时（${timeoutMs / 1000}秒）`));
      }, timeoutMs);
    });

    try {
      // 使用 Promise.race 实现超时
      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      isProcessingRef.current = false;
    }
  }, []);

  // 压缩图片函数（使用工具函数）
  const compressImageCallback = useCallback(compressImage, []);

  // 从URL获取文件并计算MD5（使用工具函数）
  const fetchFileWithMd5Callback = useCallback(fetchFileWithMd5, []);

  // 从URL或File创建图片文件（支持压缩）
  const createImageFileFromUrl = useCallback(async (url: string, filename: string): Promise<File | null> => {
    try {
      // 1) 下载并计算 MD5
      const res = await fetchFileWithMd5Callback(url);
      if (!res || !res.blob || !res.md5) return null;

      // 2) 封装为 File
      const file = new File([res.blob], filename, { type: res.blob.type || 'image/jpeg' }) as ExtendedFile;
      file.__md5 = res.md5;

      return file;
    } catch (err) {
      console.error('[ReferenceImageUpload] createImageFileFromUrl failed:', err);
      return null;
    }
  }, [fetchFileWithMd5Callback]);

  // 公共的文件去重和添加函数（支持压缩）
  const processFilesWithMd5 = useCallback(async (files: File[]): Promise<File[]> => {
    const uniqueFiles: File[] = [];
    const md5Set = fileMd5SetRef.current;
    const md5Map = fileMd5MapRef.current;

    for (const file of files) {
      // 优先使用预存的 MD5（来自 createImageFileFromUrl），否则重新计算
      let md5 = (file as ExtendedFile).__md5;
      if (!md5) {
        md5 = await calculateMd5Callback(file);
      }

      // 检查是否重复
      if (md5Set.has(md5)) {
        continue;
      }

      // 智能压缩判断：综合考虑文件大小和图片尺寸
      const sizeMB = file.size / 1024 / 1024;
      let shouldCompress = false;
      let compressReason = '';

      // 判断是否需要压缩
      if (sizeMB > 2) {
        // 文件超过 2MB，必须压缩
        shouldCompress = true;
        compressReason = `文件过大 (${sizeMB.toFixed(2)}MB)`;
      } else if (sizeMB > 1) {
        // 文件在 1-2MB 之间，检查图片尺寸
        let objectUrl = '';
        try {
          const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({ width: img.width, height: img.height });
            img.onerror = () => reject(new Error('图片加载失败'));
            objectUrl = URL.createObjectURL(file);
            img.src = objectUrl;
          });

          const maxDimension = Math.max(dimensions.width, dimensions.height);
          if (maxDimension > 2048) {
            // 图片尺寸超过 2048px，建议压缩
            shouldCompress = true;
            compressReason = `尺寸过大 (${dimensions.width}x${dimensions.height})`;
          }
        } catch (error) {
          // 尺寸检查失败，跳过压缩
        } finally {
          // 确保在所有情况下都清理 ObjectURL
          if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
          }
        }
      }

      let finalFile = file as File | ExtendedFile;
      let finalMd5 = md5;

      if (shouldCompress) {
        try {
          const compressedFile = await compressImageCallback(file, 1);
          // 压缩后重新计算 MD5（因为文件内容变了）
          const compressedMd5 = await calculateMd5Callback(compressedFile);

          // 检查压缩后的文件是否已存在
          if (md5Set.has(compressedMd5)) {
            continue;
          }

          // 使用压缩后的文件
          finalFile = compressedFile;
          finalMd5 = compressedMd5;
          (compressedFile as ExtendedFile).__md5 = compressedMd5;
        } catch (error) {
          // 压缩失败，使用原始文件
          if (md5Set.has(md5)) {
            continue;
          }
          (file as ExtendedFile).__md5 = md5;
        }
      } else {
        // 未压缩，将 MD5 存储到文件对象上
        (file as ExtendedFile).__md5 = md5;
      }

      // 添加到结果列表
      uniqueFiles.push(finalFile);
      md5Set.add(finalMd5);
      md5Map.set(finalMd5, finalMd5);
    }

    return uniqueFiles;
  }, [calculateMd5Callback, compressImageCallback]);

  const handleInternalDrop = useCallback(async (payload: InternalDragPayload) => {
    if (!payload) return;

    if (!isExpanded) {
      setIsExpanded(true);
    }

    try {
      await withProcessingLock(async () => {
        const remainingSlots = 10 - refFiles.length;
        if (remainingSlots <= 0) {
          toast.error('参考图已满');
          return;
        }

        const path = String(payload.filePath || payload.thumbnailPath || payload.path || '').trim();
        if (path) {
          const md5Key = `path-${path}`;
          if (fileMd5SetRef.current.has(md5Key)) {
            toast.info('图片已存在');
            return;
          }
          const name = String(payload.name || '').trim() || path.split(/[/\\]/).pop() || 'ref-image.jpg';
          const file = new File([], name, { type: 'image/jpeg' }) as ExtendedFile;
          file.__path = path;
          file.__md5 = md5Key;
          addRefFiles([file]);
          toast.success('已添加 1 张参考图');
          return;
        }

        const url = String(payload.url || payload.thumbnailUrl || '').trim();
        if (url) {
          const name = String(payload.name || '').trim() || `ref-${Date.now()}.jpg`;
          const file = await createImageFileFromUrl(url, name);
          if (file) {
            addRefFiles([file]);
            toast.success('已添加 1 张参考图');
          } else {
            toast.error('获取图片失败');
          }
          return;
        }

        if (payload.getBlob) {
          const blob = await payload.getBlob();
          if (blob) {
            const name = String(payload.name || '').trim() || `ref-${Date.now()}.jpg`;
            const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
            const uniqueFiles = await processFilesWithMd5([file]);
            if (uniqueFiles.length > 0) {
              addRefFiles(uniqueFiles);
              toast.success('已添加 1 张参考图');
            } else {
              toast.info('图片已存在');
            }
          } else {
            toast.error('获取图片失败');
          }
          return;
        }

        toast.error('未检测到可添加的图片');
      });
    } catch (error) {
      if (error instanceof Error && error.message === '操作正在进行中，请稍候') {
        toast.info('请等待当前操作完成');
      } else {
        toast.error(`添加参考图失败：${error instanceof Error ? error.message : '未知错误'}`);
      }
    }
  }, [addRefFiles, createImageFileFromUrl, isExpanded, processFilesWithMd5, refFiles.length, withProcessingLock]);

  useEffect(() => {
    if (!dropPayload) return;
    void handleInternalDrop(dropPayload);
    clearDrop();
  }, [dropCounter, dropPayload, handleInternalDrop, clearDrop]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    try {
      await withProcessingLock(async () => {
        const files = Array.from(e.target.files || []);

        // 计算还能添加多少张
        const remainingSlots = 10 - refFiles.length;

        // 如果选择的文件超过剩余槽位，提示用户
        if (files.length > remainingSlots) {
          toast.error(`最多10张，还能添加${remainingSlots}张`);
          files.length = remainingSlots;
        }

        // 先校验文件类型
        const validFiles = files.filter(file => {
          const isImage = file.type.startsWith('image/');
          if (!isImage) toast.error(`${file.name} 不是图片文件`);
          return isImage;
        });

        // MD5 去重
        const uniqueFiles = await processFilesWithMd5(validFiles);

        if (uniqueFiles.length > 0) {
          addRefFiles(uniqueFiles);
          // 检查是否有压缩过的文件，显示压缩提示
          const compressedFiles = uniqueFiles.filter(f => (f as ExtendedFile).__compressed);
          if (compressedFiles.length > 0) {
            toast.success(`已添加${uniqueFiles.length}张（${compressedFiles.length}张已压缩）`);
          } else {
            toast.success(`已添加${uniqueFiles.length}张参考图`);
          }
        } else if (validFiles.length > 0) {
          toast.warning('所有图片都已存在');
        }
      });
    } catch (error) {
      if (error instanceof Error && error.message === '操作正在进行中，请稍候') {
        toast.info('请等待当前操作完成');
      }
    }

    // 重置 input 值，允许重复选择同一张图
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [refFiles.length, addRefFiles, withProcessingLock, processFilesWithMd5]);

  const extractImageFilesFromClipboard = useCallback((clipboardData: DataTransfer | null): File[] => {
    if (!clipboardData) return [];
    const files: File[] = [];

    // 1) items（最常见：截图/复制图片）
    const items = clipboardData.items;
    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
    }

    // 2) files（部分平台会把图片放在 files 里）
    if (clipboardData.files && clipboardData.files.length > 0) {
      Array.from(clipboardData.files).forEach((f) => {
        if (f.type && f.type.startsWith('image/')) files.push(f);
      });
    }

    return files;
  }, []);

  const processPastedFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    // 收起状态也允许粘贴：自动展开，避免“无提示/无响应”的体验
    if (!isExpanded) {
      setIsExpanded(true);
    }

    await withProcessingLock(async () => {
      const remainingSlots = 10 - refFiles.length;
      if (remainingSlots <= 0) {
        toast.error('参考图已满');
        return;
      }

      const clipped = files.slice(0, remainingSlots);
      if (files.length > remainingSlots) {
        toast.error(`最多10张，还能添加${remainingSlots}张`);
      }

      const uniqueFiles = await processFilesWithMd5(clipped);
      if (uniqueFiles.length > 0) {
        addRefFiles(uniqueFiles);
        const compressedFiles = uniqueFiles.filter(f => (f as ExtendedFile).__compressed);
        if (compressedFiles.length > 0) {
          toast.success(`已添加${uniqueFiles.length}张（${compressedFiles.length}张已压缩）`);
        } else {
          toast.success(`已添加${uniqueFiles.length}张参考图`);
        }
      } else {
        toast.info('图片已存在');
      }
    });
  }, [isExpanded, refFiles.length, addRefFiles, withProcessingLock, processFilesWithMd5]);

  const tryPasteFromTauriClipboard = useCallback(async () => {
    const remainingSlots = 10 - refFiles.length;
    if (remainingSlots <= 0) {
      toast.error('参考图已满');
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

      const md5Key = `path-${imagePath}`;
      if (fileMd5SetRef.current.has(md5Key)) {
        toast.info('图片已存在');
        return;
      }

      const name = imagePath.split(/[/\\]/).pop() || `clipboard-${Date.now()}.png`;
      const file = new File([], name, { type: 'image/png' }) as ExtendedFile;
      file.__path = imagePath;
      file.__md5 = md5Key;

      addRefFiles([file]);
      toast.success('已添加 1 张参考图');
    } catch (err) {
      // 原生读取失败：静默忽略，避免影响正常文本粘贴体验
      console.warn('[ReferenceImageUpload] read_image_from_clipboard failed:', err);
    }
  }, [isExpanded, refFiles.length, addRefFiles]);

  // 处理粘贴上传（React 事件）
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const files = extractImageFilesFromClipboard(e.clipboardData || null);
    if (files.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      try {
        await processPastedFiles(files);
      } catch (error) {
        if (error instanceof Error && error.message === '操作正在进行中，请稍候') {
          toast.info('请等待当前操作完成');
        } else {
          console.error('粘贴图片失败:', error);
          toast.error(`粘贴图片失败：${error instanceof Error ? error.message : '未知错误'}`);
        }
      }
      return;
    }

    const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
    if (!isTauri) return;

    // 如果用户在粘贴纯文本（且当前在输入框内），不要触发原生读取，避免拖慢输入体验
    const plain = (e.clipboardData?.getData('text/plain') || '').trim();
    const target = e.target as HTMLElement | null;
    const isTextInputTarget = Boolean(
      target &&
      ((target as any).isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA')
    );
    if (plain && isTextInputTarget) return;

    // 兜底：Tauri 打包环境下 Web ClipboardData 可能拿不到图片数据，尝试原生读取
    void tryPasteFromTauriClipboard();
  }, [extractImageFilesFromClipboard, processPastedFiles, tryPasteFromTauriClipboard]);

  // 全局 paste 捕获：不要求用户必须聚焦参考图区域
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;

      const files = extractImageFilesFromClipboard(e.clipboardData);
      if (files.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        void processPastedFiles(files);
        return;
      }

      const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
      if (!isTauri) return;

      const plain = (e.clipboardData.getData('text/plain') || '').trim();
      const target = e.target as HTMLElement | null;
      const isTextInputTarget = Boolean(
        target &&
        ((target as any).isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA')
      );
      if (plain && isTextInputTarget) return;

      void tryPasteFromTauriClipboard();
    };

    window.addEventListener('paste', onPaste, true);
    return () => {
      window.removeEventListener('paste', onPaste, true);
    };
  }, [extractImageFilesFromClipboard, processPastedFiles, tryPasteFromTauriClipboard]);

  // 处理拖拽开始 - 添加视觉反馈
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 只在展开状态且未满时允许拖入
    if (refFiles.length < 10) {
      setIsDraggingOver(true);
    }
  }, [refFiles.length]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const normalizePathFromUri = useCallback((raw: string): string => {
    const trimmed = (raw || '').trim();
    if (!trimmed) return '';

    const stripHostPrefix = (value: string) => {
      let next = value.replace(/^localhost\//, '');
      return next.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(next) ? next : `/${next}`;
    };

    if (trimmed.startsWith('file://')) {
      const withoutScheme = trimmed.replace(/^file:\/\//, '');
      return decodeURIComponent(stripHostPrefix(withoutScheme));
    }
    if (trimmed.startsWith('asset://')) {
      const withoutScheme = trimmed.replace(/^asset:\/\//, '');
      return decodeURIComponent(stripHostPrefix(withoutScheme));
    }
    if (trimmed.startsWith('tauri://')) {
      const withoutScheme = trimmed.replace(/^tauri:\/\//, '');
      return decodeURIComponent(stripHostPrefix(withoutScheme));
    }
    if (trimmed.startsWith('http://asset.localhost') || trimmed.startsWith('https://asset.localhost')) {
      try {
        const parsed = new URL(trimmed);
        return decodeURIComponent(parsed.pathname || '');
      } catch {
        return '';
      }
    }

    try {
      const parsed = new URL(trimmed);
      const path = decodeURIComponent(parsed.pathname || '');
      if (path.includes('/storage/')) {
        return path.replace(/^\/+/, '');
      }
    } catch {
      // ignore
    }

    return '';
  }, []);

  // 处理拖拽释放
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    // 收起状态也允许拖入：自动展开，避免“无提示/无响应”的体验
    if (!isExpanded) {
      setIsExpanded(true);
    }

    // 并发操作保护
    try {
      await withProcessingLock(async () => {
        const filesToAdd: File[] = [];
        const remainingSlots = 10 - refFiles.length;

        if (remainingSlots <= 0) {
          toast.error('参考图已满');
          return;
        }

        const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
        const dragBlobSymbol = Symbol.for('__dragImageBlob');
        const cachedData = (window as any)[dragBlobSymbol];
        const cachedCreatedAt = typeof cachedData?.createdAt === 'number' ? cachedData.createdAt : 0;
        const isCachedFresh = cachedCreatedAt > 0 && Date.now() - cachedCreatedAt < 60_000;

        // 1) 优先处理“内部拖拽”的本地路径（Tauri 下最稳：不依赖 fetch/asset/CORS）
        if (isTauri) {
          const looksLikePath = (p: string) => {
            if (!p) return false;
            if (p.startsWith('storage/') || p.startsWith('storage\\')) return true;
            if (p.startsWith('/') || p.startsWith('\\\\')) return true;
            if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
            return false;
          };

          const fromCustom = (e.dataTransfer.getData('application/x-image-path') || '').trim();
          let imagePath = fromCustom;
          if (!imagePath) {
            const fromPlain = (e.dataTransfer.getData('text/plain') || '').trim();
            if (looksLikePath(fromPlain)) imagePath = fromPlain;
          }
          if (!imagePath) {
            const uriCandidate =
              e.dataTransfer.getData('application/x-image-url') ||
              e.dataTransfer.getData('text/uri-list') ||
              e.dataTransfer.getData('text/plain');
            const normalized = normalizePathFromUri(uriCandidate || '');
            if (normalized) imagePath = normalized;
          }
          if (!imagePath && isCachedFresh && cachedData?.path && looksLikePath(cachedData.path)) {
            imagePath = String(cachedData.path);
          }
          if (!imagePath && isCachedFresh && cachedData?.url) {
            const normalized = normalizePathFromUri(String(cachedData.url));
            if (normalized) imagePath = normalized;
          }

          if (imagePath && !imagePath.includes('://')) {
            const md5Key = `path-${imagePath}`;
            if (fileMd5SetRef.current.has(md5Key)) {
              toast.info('图片已存在');
              return;
            }

            const rawName = e.dataTransfer.getData('application/x-image-name') || '';
            const name = (rawName || '').trim() || imagePath.split(/[/\\]/).pop() || 'ref-image.jpg';
            const file = new File([], name, { type: 'image/jpeg' }) as ExtendedFile;
            file.__path = imagePath;
            file.__md5 = md5Key;

            addRefFiles([file]);
            toast.success('已添加 1 张参考图');
            return;
          }
        }

        // 调试日志

        // 优先处理缓存的 Blob 数据（避免 CORS / asset:// 导致 URL fetch 失败）
        // 使用 Symbol 避免全局变量污染（拖拽源会写入 window[Symbol.for('__dragImageBlob')]）
        const hasBlobFlag = (e.dataTransfer.getData('application/x-has-blob') || '').trim();
        const canUseCachedBlob =
          cachedData &&
          (hasBlobFlag === 'true' || Boolean(cachedData.blob) || Boolean(cachedData.blobPromise));

        if (canUseCachedBlob) {
          // 防止使用到非常久之前遗留的缓存
          const createdAt = typeof cachedData.createdAt === 'number' ? cachedData.createdAt : 0;
          if (!createdAt || Date.now() - createdAt < 60_000) {
            if (filesToAdd.length < remainingSlots) {
              try {
                let blob: Blob | null | undefined = cachedData.blob;
                if (!blob && cachedData.blobPromise) {
                  // 快速 drop 时 blob 可能仍在生成：做一个短超时等待
                  const timeout = new Promise<Blob | null>((resolve) => setTimeout(() => resolve(null), 1500));
                  blob = await Promise.race([cachedData.blobPromise, timeout]);
                }

                if (blob) {
                  const file = new File([blob], cachedData.name || 'ref-image.jpg', { type: blob.type || 'image/jpeg' });
                  if (file.size / 1024 / 1024 < 5) {
                    filesToAdd.push(file);
                  } else {
                    toast.error('图片超过 5MB');
                  }
                }
              } catch (err) {
                // 忽略：继续走 URL / 文件兜底
              }
            }

            // 如果成功获取到 Blob，使用去重函数处理
            if (filesToAdd.length > 0) {
              const uniqueFiles = await processFilesWithMd5(filesToAdd);
              if (uniqueFiles.length > 0) {
                addRefFiles(uniqueFiles);
                toast.success(`已添加 ${uniqueFiles.length} 张参考图`);
              } else {
                toast.info('图片已存在');
              }
              return;
            }
          }
        }

        // 处理拖拽的图片URL（从历史记录）- 备用方案
        const validatedFiles: File[] = []; // 已验证的文件（来自URL，已通过MD5检查）
        const rawFiles: File[] = []; // 未验证的文件（需要MD5检查）

        try {
          let imageUrl = e.dataTransfer.getData('application/x-image-url');
          let imageName = e.dataTransfer.getData('application/x-image-name');

          if (!imageUrl) {
            imageUrl = e.dataTransfer.getData('text/uri-list');
            if (imageUrl) {
              const matches = imageUrl.match(/\/images\/([a-f0-9-]+)$/);
              imageName = matches ? `ref-${matches[1]}.jpg` : 'ref-image.jpg';
            }
          }

          // 兼容：部分 WebView/平台可能只提供 text/plain
          if (!imageUrl) {
            const plain = e.dataTransfer.getData('text/plain');
            const trimmed = (plain || '').trim();
            if (
              trimmed &&
              (trimmed.startsWith('http://') ||
                trimmed.startsWith('https://') ||
                trimmed.startsWith('asset:') ||
                trimmed.startsWith('tauri:') ||
                trimmed.startsWith('ipc:') ||
                trimmed.startsWith('blob:') ||
                trimmed.startsWith('data:') ||
                trimmed.startsWith('http://asset.localhost'))
            ) {
              imageUrl = trimmed;
              if (!imageName) imageName = 'ref-image.jpg';
            }
          }

          if (!imageUrl && isCachedFresh && cachedData?.url) {
            imageUrl = String(cachedData.url);
            if (!imageName) imageName = cachedData.name || 'ref-image.jpg';
          }

          if (imageUrl && imageName) {
            if (validatedFiles.length + rawFiles.length >= remainingSlots) {
              toast.error('参考图已满');
              return;
            }

            toast.info('正在添加图片...');

            const file = await createImageFileFromUrl(imageUrl, imageName);
            if (file) {
              // createImageFileFromUrl 已处理MD5，直接加入已验证列表
              validatedFiles.push(file);
            } else {
            }
          }
        } catch (error) {
          // 继续走 files 兜底
          console.error('处理拖拽 URL 失败:', error);
        }

        // 处理拖拽的文件
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const droppedFiles = Array.from(e.dataTransfer.files);
          const remainingAfterUrl = remainingSlots - validatedFiles.length - rawFiles.length;

          if (remainingAfterUrl > 0) {
            const validFiles = droppedFiles.filter(file => {
              const isImage = file.type.startsWith('image/');
              const isLt5M = file.size / 1024 / 1024 < 5;
              if (!isImage) toast.error(`${file.name} 不是图片文件`);
              if (!isLt5M) toast.error(`${file.name} 超过 5MB`);
              return isImage && isLt5M;
            });

            rawFiles.push(...validFiles.slice(0, remainingAfterUrl));
          }
        }

        // 分类处理：已验证文件直接添加，未验证文件需要去重
        if (validatedFiles.length > 0 || rawFiles.length > 0) {
          const finalFiles = [...validatedFiles];
          const uniqueRawFiles = rawFiles.length > 0 ? await processFilesWithMd5(rawFiles) : [];
          finalFiles.push(...uniqueRawFiles);

          if (finalFiles.length > 0) {
            addRefFiles(finalFiles);

            const compressedFiles = finalFiles.filter(f => (f as ExtendedFile).__compressed);
            if (compressedFiles.length > 0) {
              toast.success(`已添加${finalFiles.length}张（${compressedFiles.length}张已压缩）`);
            } else {
              toast.success(`已添加${finalFiles.length}张参考图`);
            }
          } else {
            toast.info('图片已存在');
          }
        } else {
          toast.error('未检测到可添加的图片');
        }
      });
    } catch (error) {
      if (error instanceof Error && error.message === '操作正在进行中，请稍候') {
        toast.info('请等待当前操作完成');
      } else {
        console.error('添加参考图失败:', error);
        toast.error(`添加参考图失败：${error instanceof Error ? error.message : '未知错误'}`);
      }
    }
  }, [isExpanded, refFiles.length, addRefFiles, withProcessingLock, processFilesWithMd5, createImageFileFromUrl, normalizePathFromUri]);

  // 处理删除文件（同时清理MD5和ObjectURL）
  // 使用 useConfigStore.getState() 避免依赖 refFiles 数组
  const handleRemoveFile = useCallback((index: number) => {
    const file = useConfigStore.getState().refFiles[index];
    const md5 = (file as ExtendedFile).__md5;
    const md5Map = fileMd5MapRef.current;
    const md5Set = fileMd5SetRef.current;
    const objectUrls = objectUrlsRef.current;

    // 从MD5集合中移除
    if (md5) {
      md5Set.delete(md5);
      md5Map.delete(md5);
    }

    // 清理 ObjectURL 防止内存泄漏
    if (md5 && objectUrls.has(md5)) {
      URL.revokeObjectURL(objectUrls.get(md5)!);
      objectUrls.delete(md5);
    }

    // 调用原始删除函数
    removeRefFile(index);

    // 更新长度记录（防止下次 effect 误判为新增）
    prevRefFilesLengthRef.current = useConfigStore.getState().refFiles.length;
  }, [removeRefFile]);

  // 处理区域点击
  const handleAreaClick = () => {
    if (!isExpanded) {
      setIsExpanded(true);
    }
  };

  // 处理点击上传按钮
  const handleUploadClick = async () => {
    // 如果在 Tauri 环境下，优先使用原生对话框，速度更快且体验更好
    if (window.__TAURI_INTERNALS__) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const { readFile } = await import('@tauri-apps/plugin-fs');
        
        const selected = await open({
          multiple: true,
          filters: [{
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'webp']
          }]
        });

        if (Array.isArray(selected) && selected.length > 0) {
           const remainingSlots = 10 - refFiles.length;
           const filesToProcess = selected.slice(0, remainingSlots);
           
           const newFiles: ExtendedFile[] = [];
           for (const path of filesToProcess) {
             try {
               // 获取文件名
               const name = path.split(/[/\\]/).pop() || 'image.jpg';
               // 建立一个空的 File 对象，但带有 __path 属性
               // 这样我们就避免了通过 IPC 传输二进制数据
               const file = new File([], name, { type: 'image/jpeg' }) as ExtendedFile;
               file.__path = path;
               // 使用路径作为唯一的 MD5 标识，避免重复读取计算
               file.__md5 = `path-${path}`;
               newFiles.push(file);
             } catch (err) {
               console.error(`Failed to process file at ${path}:`, err);
             }
           }
           
           if (newFiles.length > 0) {
              addRefFiles(newFiles);
              toast.success(`已添加 ${newFiles.length} 张参考图`);
           }
         }
        return;
      } catch (err) {
        console.error('Failed to use native dialog:', err);
        // 如果原生对话框失败，降级到标准 input
      }
    }
    
    // 降级方案：触发隐藏的 input
    fileInputRef.current?.click();
  };

  const showDragOver = isDraggingOver || (isInternalDragging && isOverDropTarget);

  return (
    <div
      ref={dropRef}
      className="space-y-2"
      onPaste={handlePaste}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ WebkitAppRegion: 'no-drag' } as any}
    >
      {/* 标题行 + 折叠按钮 */}
      <div
        className={cn(
          "flex items-center justify-between rounded-xl transition-all",
          showDragOver && "bg-blue-50 ring-2 ring-blue-400 ring-dashed"
        )}
        onClick={handleAreaClick}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="p-1 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0"
            title={isExpanded ? "收起参考图区域" : "展开参考图区域"}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>
          <label
            className="text-sm font-medium text-gray-700 flex items-center gap-2 cursor-pointer"
          >
            <ImageIcon className="w-4 h-4 text-blue-500" />
            风格参考图 ({refFiles.length}/10)
          </label>
        </div>
        <div className="flex items-center gap-2">
          {showDragOver && (
            <span className="text-[10px] text-blue-600 font-medium">
              松开添加图片
            </span>
          )}
          {refFiles.length > 0 && !showDragOver && (
            <span className="text-[10px] font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">
              图生图模式已激活
            </span>
          )}
        </div>
      </div>

      {/* 收起状态提示 */}
      {!isExpanded && refFiles.length === 0 && (
        <div className="text-[11px] text-slate-400 italic pl-7">
          点击展开可上传参考图片进行图生图
        </div>
      )}

      {/* 可折叠内容区域 */}
      {isExpanded && (
        <>
          {/* 预览列表 */}
          {refFiles.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none snap-x">
                  {refFiles.map((file, index) => {
                      // 使用 MD5 作为稳定的 key（压缩后 MD5 会变化，但每个文件阶段是稳定的）
                      const md5 = (file as ExtendedFile).__md5 || `${file.name}-${file.size}-${file.lastModified}`;
                      // 使用缓存的 ObjectURL 或创建新的
                      if (!objectUrlsRef.current.has(md5)) {
                        let url: string;
                        const extFile = file as ExtendedFile;
                        if (extFile.__path) {
                           // 如果有本地路径，优先使用 getImageUrl 统一处理（兼容 asset:// 与 http 回退）
                           url = getImageUrl(extFile.__path);
                           if (!url) url = URL.createObjectURL(file);
                        } else {
                           url = URL.createObjectURL(file);
                        }
                        objectUrlsRef.current.set(md5, url);
                      }
                      const url = objectUrlsRef.current.get(md5)!;

                      return (
                          <div key={md5} className="relative flex-shrink-0 w-20 h-20 rounded-2xl overflow-hidden border-2 border-white shadow-sm snap-start group">
                              <img src={url} alt="ref" className="w-full h-full object-cover" />
                              <button
                                onClick={() => handleRemoveFile(index)}
                                className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="w-3 h-3" />
                              </button>
                          </div>
                      );
                  })}
              </div>
          )}

          {/* 上传按钮/区域 */}
          {refFiles.length < 10 && (
              <button
                onClick={handleUploadClick}
                className={cn(
                    "w-full py-3 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-2 transition-all group",
                    refFiles.length > 0 ? "py-2" : "py-4",
                    isDraggingOver
                      ? "border-blue-500 bg-blue-100"
                      : "border-slate-200 hover:border-blue-400 hover:bg-blue-50/30"
                )}
              >
                <ImagePlus className="w-6 h-6 text-slate-300 group-hover:text-blue-500 transition-colors" />
                <div className="flex flex-col items-center">
                    <span className="text-xs font-bold text-slate-400 group-hover:text-blue-600">
                        {refFiles.length > 0 ? "继续添加" : "添加参考图"}
                    </span>
                    <span className="text-[10px] text-slate-400 mt-0.5">(支持多选或拖拽)</span>
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                />
              </button>
          )}
        </>
      )}
    </div>
  );
}
