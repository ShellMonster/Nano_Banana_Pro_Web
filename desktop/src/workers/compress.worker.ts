/**
 * 图片压缩 Web Worker
 * 在后台线程中处理图片压缩，避免阻塞主线程
 */

// Worker 全局类型定义
interface CompressRequest {
  __requestId: number;
  imageData: ArrayBuffer;
  fileName: string;
  fileType: string;
  maxSizeMB: number;
  maxDimension: number;
}

interface CompressResponse {
  __requestId: number;
  success: boolean;
  data?: {
    blob: ArrayBuffer;
    fileName: string;
    fileType: string;
    originalSize: number;
    compressedSize: number;
    compressed: boolean;
    width: number;
    height: number;
  };
  error?: string;
}

// 监听主线程消息
self.onmessage = async (e: MessageEvent<CompressRequest>) => {
  const { __requestId, imageData, fileName, fileType, maxSizeMB, maxDimension } = e.data;

  try {
    // 1. 从 ArrayBuffer 创建 Blob
    const blob = new Blob([imageData], { type: fileType });

    // 2. 使用 createImageBitmap 异步解码图片
    const bitmap = await createImageBitmap(blob);

    // 3. 计算目标尺寸
    let width = bitmap.width;
    let height = bitmap.height;

    if (width > height) {
      if (width > maxDimension) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      }
    } else {
      if (height > maxDimension) {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
    }

    // 4. 使用 OffscreenCanvas 进行压缩
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Failed to create canvas context');
    }

    // 绘制图片
    ctx.drawImage(bitmap, 0, 0, width, height);

    // 5. 初始质量 0.8，逐步降低直到满足大小要求
    const targetBytes = maxSizeMB * 1024 * 1024;
    let quality = 0.8;
    let compressedBlob: Blob | null = null;
    let attempts = 0;
    const maxAttempts = 8; // 最多尝试8次

    while (attempts < maxAttempts) {
      attempts++;
      compressedBlob = await canvas.convertToBlob({
        type: 'image/jpeg',
        quality
      });

      if (!compressedBlob) {
        throw new Error('Compression failed: cannot create blob');
      }

      // 满足大小要求或质量已到最低
      if (compressedBlob.size <= targetBytes || quality <= 0.1) {
        break;
      }

      quality -= 0.1;
    }

    // 确保 compressedBlob 不为 null
    if (!compressedBlob) {
      throw new Error('Compression failed: cannot create final blob');
    }

    // 6. 转换为 ArrayBuffer 返回
    const arrayBuffer = await compressedBlob.arrayBuffer();
    const isCompressed = compressedBlob.size < blob.size;

    // 7. 发送结果回主线程
    const response: CompressResponse = {
      __requestId,
      success: true,
      data: {
        blob: arrayBuffer,
        fileName,
        fileType: 'image/jpeg',
        originalSize: blob.size,
        compressedSize: compressedBlob.size,
        compressed: isCompressed,
        width,
        height
      }
    };

    self.postMessage(response);

    // 8. 清理资源
    bitmap.close();

  } catch (error) {
    const response: CompressResponse = {
      __requestId,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    self.postMessage(response);
  }
};

// 导出类型供外部使用
export type { CompressRequest, CompressResponse };
