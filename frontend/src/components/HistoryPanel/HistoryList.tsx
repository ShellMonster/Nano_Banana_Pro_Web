import React, { useCallback, useMemo } from 'react';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { Grid, type CellComponentProps } from 'react-window';
import { useHistoryStore } from '../../store/historyStore';
import { useShallow } from 'zustand/react/shallow';
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

const isImageItem = (item: RenderItem): item is FlattenedImage => 'url' in item;

const getColumnCount = (containerWidth: number, viewportWidth: number | undefined, gap: number) => {
  const basis = viewportWidth ?? containerWidth;
  let count = 2;
  if (basis >= 1280) {
    count = 5;
  } else if (basis >= 1024) {
    count = 4;
  } else if (basis >= 768) {
    count = 3;
  }

  const minCardWidth = 170;
  while (count > 2) {
    const requiredWidth = count * minCardWidth + (count - 1) * gap;
    if (containerWidth >= requiredWidth) break;
    count -= 1;
  }
  return count;
};

const getGapSize = (width: number) => (width >= 640 ? 16 : 12);

const getRowExtraHeight = (width: number) => (width >= 640 ? 96 : 88);

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
  const { items, loading, hasMore, loadMore } = useHistoryStore(
    useShallow((s) => ({
      items: s.items,
      loading: s.loading,
      hasMore: s.hasMore,
      loadMore: s.loadMore
    }))
  );
  const [selectedImage, setSelectedImage] = React.useState<FlattenedImage | null>(null);

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
  const renderItems = useMemo(() => {
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

  // 判断项是否为图片
  const allImageItems = useMemo(() => renderItems.filter(isImageItem), [renderItems]);

  type CellData = {
    items: RenderItem[];
    columnCount: number;
    itemWidth: number;
    itemHeight: number;
    gap: number;
  };

  const Cell = useCallback(
    ({
      columnIndex,
      rowIndex,
      style,
      ariaAttributes,
      items,
      columnCount,
      itemWidth,
      itemHeight,
      gap
    }: CellComponentProps<CellData>) => {
      const index = rowIndex * columnCount + columnIndex;
      const cellStyle: React.CSSProperties = {
        ...style,
        width: itemWidth + gap,
        height: itemHeight + gap,
        paddingRight: gap,
        paddingBottom: gap,
        boxSizing: 'border-box'
      };
      if (index >= items.length) {
        return <div {...ariaAttributes} style={cellStyle} />;
      }
      const item = items[index];

      return (
        <div {...ariaAttributes} style={cellStyle}>
          <div style={{ width: itemWidth, height: itemHeight }}>
            {isImageItem(item) ? (
              <ImageCard image={item} onClick={handleImageClick} />
            ) : (
              <FailedTaskCard task={item} onClick={handleEmptyTaskClick} />
            )}
          </div>
        </div>
      );
    },
    [handleImageClick, handleEmptyTaskClick]
  );

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
        <div className="h-full min-h-0">
          <AutoSizer
            className="h-full w-full"
            renderProp={({ width, height }) => {
              if (!width || !height) return null;
              const padding = 16;
              const innerWidth = Math.max(0, width - padding * 2);
              const innerHeight = Math.max(0, height - padding * 2);
              if (innerWidth <= 0 || innerHeight <= 0) return null;

              const viewportWidth =
                typeof window !== 'undefined'
                  ? window.innerWidth || document.documentElement.clientWidth
                  : innerWidth;
              const gap = getGapSize(innerWidth);
              const columnCount = getColumnCount(innerWidth, viewportWidth, gap);
              const columnWidth = Math.floor((innerWidth - gap * columnCount) / columnCount);
              const itemHeight = columnWidth + getRowExtraHeight(innerWidth);
              const rowCount = Math.ceil(renderItems.length / columnCount);

              const cellProps: CellData = {
                items: renderItems,
                columnCount,
                itemWidth: columnWidth,
                itemHeight,
                gap
              };

              return (
                <div style={{ padding }} className="h-full">
                  <Grid
                    columnCount={columnCount}
                    columnWidth={columnWidth + gap}
                    rowCount={rowCount}
                    rowHeight={itemHeight + gap}
                    cellComponent={Cell}
                    cellProps={cellProps}
                    overscanCount={2}
                    style={{ height: innerHeight, width: innerWidth }}
                    onCellsRendered={(_, allCells) => {
                      if (hasMore && !loading && allCells.rowStopIndex >= rowCount - 1) {
                        loadMore();
                      }
                    }}
                  />
                </div>
              );
            }}
          />
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
