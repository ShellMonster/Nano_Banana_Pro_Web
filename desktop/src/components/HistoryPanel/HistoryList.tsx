import React, { useCallback, useEffect, useRef } from 'react';
import { useHistoryStore } from '../../store/historyStore';
import { GeneratedImage, GenerationTask } from '../../types';
import { getImageUrl } from '../../services/api';
import { ImagePreview } from '../GenerateArea/ImagePreview';
import { ImageCard } from './ImageCard';
import { FailedTaskCard } from './FailedTaskCard';

// 扩展 Image 类型以包含展示信息
export interface FlattenedImage extends GeneratedImage {
    taskCreatedAt?: string;
    imageSizeLabel?: string;
    aspectRatioLabel?: string;
}

// 用于渲染的项目类型
export type RenderItem = FlattenedImage | GenerationTask;

// 判断是否为空图片任务（生成中、排队中或失败的任务）
const isEmptyTask = (task: GenerationTask): boolean => {
    // 1. 如果状态是排队中、生成中或失败，必然显示为任务卡片
    if (task.status === 'pending' || task.status === 'processing' || task.status === 'failed') {
        return true;
    }
    // 2. 如果状态是已完成或部分完成，但完全没有图片对象
    if (!task.images || task.images.length === 0) {
        return true;
    }
    // 3. 检查是否有至少一个可以显示的路径（包含 URL）
    const hasAnyPath = task.images.some(img => 
        img.filePath || 
        img.thumbnailPath || 
        img.url || 
        (img as any).imageUrl || 
        (img as any).thumbnailUrl ||
        (img as any).local_path ||
        (img as any).thumbnail_path ||
        (img as any).image_url ||
        (img as any).thumbnail_url
    );
    return !hasAnyPath;
};

export function HistoryList() {
  const items = useHistoryStore(s => s.items);
  const loading = useHistoryStore(s => s.loading);
  const hasMore = useHistoryStore(s => s.hasMore);
  const loadMore = useHistoryStore(s => s.loadMore);
  const [selectedImage, setSelectedImage] = React.useState<FlattenedImage | null>(null);
  const observerTargetRef = useRef<HTMLDivElement>(null);

  // 辅助函数：根据像素计算分辨率标签
  const getResolutionLabel = useCallback((w: number, h: number) => {
      const max = Math.max(w, h);
      if (max >= 3840) return '4K';
      if (max >= 2048) return '2K';
      if (max >= 1024) return '1K';
      return 'SD';
  }, []);

  // 辅助函数：根据像素计算比例标签
  const getRatioLabel = useCallback((w: number, h: number) => {
      const r = w / h;
      if (Math.abs(r - 1) < 0.1) return '1:1';
      if (Math.abs(r - 1.77) < 0.1) return '16:9';
      if (Math.abs(r - 0.56) < 0.1) return '9:16';
      if (Math.abs(r - 1.33) < 0.1) return '4:3';
      if (Math.abs(r - 0.75) < 0.1) return '3:4';
      return `${w}:${h}`;
  }, []);

  // 处理图片点击
  const handleImageClick = useCallback((image: FlattenedImage) => {
    setSelectedImage(image);
  }, []);

  // 处理空任务点击
  const handleEmptyTaskClick = useCallback(() => {
    console.log('Empty task clicked');
  }, []);

  // 1. 数据处理：合并所有渲染项到单一列表
  const renderItems = React.useMemo(() => {
      if (!Array.isArray(items)) return [];

      const allItems: RenderItem[] = [];

      items.forEach(task => {
          if (!task) return;

          // 如果任务没有图片或图片数组为空，作为空任务处理
          if (isEmptyTask(task)) {
              allItems.push(task);
          } else if (Array.isArray(task.images) && task.images.length > 0) {
              // 有图片的任务，打平处理
              task.images.filter(Boolean).forEach(img => {
                  allItems.push({
                      ...img,
                      url: img.url || getImageUrl(img.filePath || img.thumbnailPath),
                      thumbnailUrl: img.thumbnailUrl || getImageUrl(img.thumbnailPath || img.filePath),
                      prompt: task.prompt || '',
                      model: task.model || '',
                      taskCreatedAt: task.createdAt || new Date().toISOString(),
                      // 基于图片真实的 width 和 height 计算标签
                      imageSizeLabel: getResolutionLabel(img.width, img.height),
                      aspectRatioLabel: getRatioLabel(img.width, img.height)
                  });
              });
          }
      });

      return allItems;
  }, [items, getResolutionLabel, getRatioLabel]);

  // 2. 预筛选所有图片，用于详情页切换，避免在渲染函数中实时 filter
  const allImageItems = React.useMemo(() => {
      return renderItems.filter(isImageItem);
  }, [renderItems]);

  // 判断项是否为图片
  function isImageItem(item: RenderItem): item is FlattenedImage {
      return 'url' in item;
  };

  // 无限滚动加载更多
  useEffect(() => {
    const observerTarget = observerTargetRef.current;
    if (!observerTarget) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(observerTarget);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, loading, loadMore]);

  if (loading && items.length === 0) {
    return (
        <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
    );
  }

  if (items.length === 0) {
      return (
          <div className="text-center py-12 text-gray-500 text-sm">
              暂无历史记录
          </div>
      );
  }

  return (
    <>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {renderItems.map((item, index) => {
                if (isImageItem(item)) {
                    return (
                        <ImageCard
                            key={`image-${item.id}`}
                            image={item}
                            onClick={handleImageClick}
                        />
                    );
                } else {
                    return (
                        <FailedTaskCard
                            key={`task-${item.id}`}
                            task={item}
                            onClick={handleEmptyTaskClick}
                        />
                    );
                }
            })}
        </div>

        {/* 加载更多触发器 */}
        <div ref={observerTargetRef} className="py-4">
            {loading && renderItems.length > 0 && (
                <div className="flex justify-center items-center gap-2 text-sm text-gray-500">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                    <span>加载中...</span>
                </div>
            )}
            {!hasMore && renderItems.length > 0 && (
                <div className="text-center text-sm text-gray-400">
                    已加载全部历史记录
                </div>
            )}
        </div>

        {/* 详情弹窗（显示完整图片） */}
        {selectedImage && (
            <ImagePreview
                image={selectedImage}
                images={allImageItems}
                onImageChange={setSelectedImage}
                onClose={() => setSelectedImage(null)}
            />
        )}
    </>
  );
}
