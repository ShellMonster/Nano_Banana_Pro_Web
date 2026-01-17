/**
 * Web Worker 管理器
 * 负责创建和管理图片压缩 Worker
 */

// 使用 Vite 的 Worker 导入语法
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - Vite 会处理这个导入
import CompressWorker from '../workers/compress.worker.ts?worker';

interface CompressOptions {
  maxSizeMB?: number;
  maxDimension?: number;
}

interface CompressResult {
  blob: Blob;
  fileName: string;
  fileType: string;
  originalSize: number;
  compressedSize: number;
  compressed: boolean;
  width: number;
  height: number;
}

class ImageCompressorWorker {
  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (value: CompressResult) => void; reject: (error: Error) => void }>();

  constructor() {
    this.init();
  }

  private init() {
    try {
      // Vite 的 ?worker 后缀会返回一个 Worker 构造函数
      this.worker = new CompressWorker();

      this.worker.onmessage = (e: MessageEvent) => {
        const { success, data, error } = e.data;

        // 查找对应的 Promise
        const request = this.pendingRequests.get(e.data.__requestId);
        if (!request) return;

        this.pendingRequests.delete(e.data.__requestId);

        if (success && data) {
          // 将 ArrayBuffer 转回 Blob
          const blob = new Blob([data.blob], { type: data.fileType });
          request.resolve({
            blob,
            fileName: data.fileName,
            fileType: data.fileType,
            originalSize: data.originalSize,
            compressedSize: data.compressedSize,
            compressed: data.compressed,
            width: data.width,
            height: data.height
          });
        } else {
          request.reject(new Error(error || 'Compression failed'));
        }
      };

      this.worker.onerror = (e) => {
        // 拒绝所有待处理的请求
        this.pendingRequests.forEach(({ reject }) => {
          reject(new Error('Worker thread error'));
        });
        this.pendingRequests.clear();
      };
    } catch (error) {
      console.error('[WorkerManager] worker init failed:', error);
    }
  }

  /**
   * 压缩图片
   * @param file - 要压缩的文件
   * @param options - 压缩选项
   * @returns Promise<CompressResult>
   */
  async compress(file: File, options: CompressOptions = {}): Promise<CompressResult> {
    const { maxSizeMB = 1, maxDimension = 1024 } = options;

    if (!this.worker) {
      // 清理所有待处理的请求
      this.pendingRequests.forEach(({ reject }) => {
        reject(new Error('Worker not initialized'));
      });
      this.pendingRequests.clear();
      throw new Error('Worker not initialized');
    }

    return new Promise((resolve, reject) => {
      // 读取文件为 ArrayBuffer
      const reader = new FileReader();
      reader.onload = () => {
        if (!reader.result) {
          reject(new Error('File read failed: empty result'));
          return;
        }

        const imageData = reader.result as ArrayBuffer;

        // 生成请求ID
        const requestId = ++this.requestId;
        this.pendingRequests.set(requestId, { resolve, reject });

        // 发送数据到 Worker
        this.worker!.postMessage({
          __requestId: requestId,
          imageData,
          fileName: file.name,
          fileType: file.type,
          maxSizeMB,
          maxDimension
        });
      };

      reader.onerror = () => {
        reject(new Error('File read failed'));
      };

      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * 终止 Worker
   */
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.pendingRequests.clear();
    }
  }
}

// 单例模式
let workerInstance: ImageCompressorWorker | null = null;

export function getCompressorWorker(): ImageCompressorWorker {
  if (!workerInstance) {
    workerInstance = new ImageCompressorWorker();
  }
  return workerInstance;
}

export function terminateCompressorWorker() {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
}

export type { CompressOptions, CompressResult };
