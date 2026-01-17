import SparkMD5 from 'spark-md5';
import { ExtendedFile } from '../types';
import { getCompressorWorker, type CompressOptions } from './workerManager';
import i18n from '../i18n';

/**
 * 计算文件的 MD5 哈希值
 * 使用分块读取，避免大文件占用过多内存
 * @param file - 要计算 MD5 的文件
 * @returns Promise<string> - MD5 哈希值
 */
export function calculateMd5(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const spark = new SparkMD5.ArrayBuffer();
    const chunkSize = 2 * 1024 * 1024; // 2MB 每块
    let offset = 0;

    const loadNextChunk = () => {
      const chunk = file.slice(offset, offset + chunkSize);
      reader.readAsArrayBuffer(chunk);
    };

    reader.onload = (e) => {
      if (!e.target?.result) {
        reject(new Error(i18n.t('errors.fileReadEmpty')));
        return;
      }
      spark.append(e.target.result as ArrayBuffer);
      offset += chunkSize;

      if (offset < file.size) {
        loadNextChunk();
      } else {
        const md5 = spark.end();
        resolve(md5);
      }
    };

    reader.onerror = () => {
      reject(new Error(i18n.t('errors.fileReadFailed')));
    };

    loadNextChunk();
  });
}

/**
 * 压缩图片到指定大小（使用 Web Worker）
 * 通过降低 JPEG 质量和缩小尺寸来实现
 * @param file - 要压缩的图片文件
 * @param maxSizeMB - 目标大小（MB），默认 1MB
 * @returns Promise<File> - 压缩后的文件（ExtendedFile 类型）
 */
export async function compressImage(file: File, maxSizeMB: number = 1): Promise<ExtendedFile> {
  try {
    // 使用 Web Worker 进行压缩（不阻塞主线程）
    const worker = getCompressorWorker();
    const result = await worker.compress(file, {
      maxSizeMB,
      maxDimension: 1024
    });

    // 创建 ExtendedFile 对象
    const compressedFile = new File([result.blob], result.fileName, {
      type: result.fileType,
      lastModified: Date.now()
    }) as ExtendedFile;

    // 标记压缩信息
    if (result.compressed) {
      compressedFile.__compressed = true;
      compressedFile.__originalSize = result.originalSize;
    }

    return compressedFile;
  } catch (error) {
    console.error('[Worker compress] failed, fallback:', error);
    // Worker 失败，使用回退方案（在主线程压缩）
    return compressImageFallback(file, maxSizeMB);
  }
}

/**
 * 压缩图片回退方案（主线程）
 * 当 Web Worker 不可用时使用
 */
function compressImageFallback(file: File, maxSizeMB: number = 1): Promise<ExtendedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // 计算目标尺寸（最大边长 1024px，保持比例）
        const MAX_DIMENSION = 1024;
        if (width > height) {
          if (width > MAX_DIMENSION) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          }
        } else {
          if (height > MAX_DIMENSION) {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error(i18n.t('errors.canvasContextFailed')));
          return;
        }

        // 绘制图片
        ctx.drawImage(img, 0, 0, width, height);

        // 初始质量 0.8，逐步降低直到满足大小要求
        let quality = 0.8;
        let attempts = 0;
        const maxAttempts = 10; // 最多尝试10次，防止无限递归

        const tryCompress = () => {
          attempts++;

          if (attempts > maxAttempts) {
            reject(new Error(i18n.t('errors.compressAttemptsExceeded')));
            return;
          }

          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error(i18n.t('errors.compressBlobFailed')));
                return;
              }

              // 检查大小
              const sizeMB = blob.size / 1024 / 1024;

              if (sizeMB <= maxSizeMB || quality <= 0.1) {
                // 满足大小要求或质量已到最低，使用当前结果
                const compressedFile = new File([blob], file.name, {
                  type: 'image/jpeg',
                  lastModified: Date.now()
                }) as ExtendedFile;
                // 标记为压缩文件，并记录原始大小
                compressedFile.__compressed = true;
                compressedFile.__originalSize = file.size;
                resolve(compressedFile);
              } else {
                // 继续降低质量
                quality -= 0.1;
                tryCompress();
              }
            },
            'image/jpeg',
            quality
          );
        };

        tryCompress();
      };
      img.onerror = () => reject(new Error(i18n.t('errors.imageLoadFailed')));
    };
    reader.onerror = () => reject(new Error(i18n.t('errors.fileReadFailed')));
  });
}

/**
 * 从 URL 获取文件并计算 MD5（边下载边计算）
 * 使用流式读取，添加文件大小限制防止内存溢出
 * @param url - 图片 URL
 * @returns Promise<{ blob: Blob; md5: string } | null> - Blob 和 MD5，失败返回 null
 */
export async function fetchFileWithMd5(url: string): Promise<{ blob: Blob; md5: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error(i18n.t('errors.responseStreamMissing'));
    }

    const spark = new SparkMD5.ArrayBuffer();
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB 限制，防止内存溢出

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      totalSize += value.length;

      // 检查文件大小限制
      if (totalSize > MAX_FILE_SIZE) {
        reader.cancel(); // 取消下载
        return null;
      }

      // 边下载边计算 MD5
      // 注意：value 可能是 view（带 byteOffset），不能直接用 value.buffer
      spark.append(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    }

    const md5 = spark.end();
    // 类型转换：chunks 是 Uint8Array[]，需要转换为 BlobPart[]
    const blob = new Blob(chunks as any, { type: response.headers.get('Content-Type') || 'image/jpeg' });

    return { blob, md5 };
  } catch (error) {
    return null;
  }
}
