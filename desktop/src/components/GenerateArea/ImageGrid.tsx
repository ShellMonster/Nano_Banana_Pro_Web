import React, { useCallback, useMemo } from 'react';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { ImageCard } from './ImageCard';
import { useGenerateStore } from '../../store/generateStore';
import { useShallow } from 'zustand/react/shallow';
import { GeneratedImage } from '../../types';

interface ImageGridProps {
  onPreview: (image: GeneratedImage) => void;
}

// 最大显示图片数量限制
const MAX_IMAGES = 100;
const GRID_PADDING = 16;

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

export function ImageGrid({ onPreview }: ImageGridProps) {
  const { images, selectedIds, toggleSelect } = useGenerateStore(
    useShallow((s) => ({
      images: s.images,
      selectedIds: s.selectedIds,
      toggleSelect: s.toggleSelect
    }))
  );

  // 限制最大显示数量，防止 DOM 爆炸
  const displayedImages = useMemo(() => {
    return images.slice(0, MAX_IMAGES);
  }, [images]);

  // 是否有超过限制的图片
  const hasOverflow = useMemo(() => {
    return images.length > MAX_IMAGES;
  }, [images.length]);

  const handlePreview = useCallback((image: GeneratedImage) => {
    onPreview(image);
  }, [onPreview]);

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400">
        <div className="w-24 h-24 bg-gray-100 rounded-full mb-4 flex items-center justify-center">
          <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <p>暂无生成的图片，请在左侧配置并开始生成</p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
      <AutoSizer
        className="h-full w-full"
        renderProp={({ width }) => {
          if (!width) return null;
          const innerWidth = Math.max(0, width - GRID_PADDING * 2);
          if (innerWidth <= 0) return null;

          const viewportWidth =
            typeof window !== 'undefined'
              ? window.innerWidth || document.documentElement.clientWidth
              : innerWidth;
          const gap = getGapSize(innerWidth);
          const columnCount = getColumnCount(innerWidth, viewportWidth, gap);
          const columnWidth = Math.floor((innerWidth - gap * columnCount) / columnCount);
          if (columnWidth <= 0) return null;
          const itemHeight = columnWidth + getRowExtraHeight(innerWidth);

          return (
            <div style={{ padding: GRID_PADDING }} className="h-full">
              <div
                className="grid content-start"
                style={{
                  gridTemplateColumns: `repeat(${columnCount}, ${columnWidth}px)`,
                  gridAutoRows: `${itemHeight}px`,
                  gap,
                  paddingRight: gap
                }}
                onContextMenu={(event) => event.preventDefault()}
              >
                {displayedImages.map((img) => (
                  <ImageCard
                    key={img.id}
                    image={img}
                    selected={selectedIds.has(img.id)}
                    onSelect={toggleSelect}
                    onClick={handlePreview}
                  />
                ))}
              </div>
            </div>
          );
        }}
      />

      {/* 超过限制时的提示 */}
      {hasOverflow && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 m-6 mt-0">
          <p className="text-sm text-blue-800 text-center">
            显示前 {MAX_IMAGES} 张图片，共 {images.length} 张
            <span className="block text-xs text-blue-600 mt-1">
              提示：为获得最佳性能，建议分批生成或清理历史记录
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
