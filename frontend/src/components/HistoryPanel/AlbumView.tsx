import React, { useCallback, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { Grid, type CellComponentProps, type GridImperativeAPI } from 'react-window';
import { FolderCard } from './FolderCard';
import { getFolders, Folder } from '../../services/folderApi';
import { toast } from '../../store/toastStore';

// 模拟文件夹图片数量数据（后续可从后端获取）
interface FolderWithCount extends Folder {
  imageCount: number;
  coverImage?: string;
}

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

const getRowExtraHeight = (width: number) => (width >= 640 ? 80 : 72);

export interface AlbumViewRef {
  refresh: () => void;
}

/**
 * AlbumView 组件 - 相册视图
 * 
 * 使用 react-window Grid 展示文件夹网格。
 * 类似 HistoryList.tsx 的实现，但展示文件夹而不是图片。
 */
export const AlbumView = forwardRef<AlbumViewRef, {}>(function AlbumView(props, ref) {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<FolderWithCount[]>([]);
  const [loading, setLoading] = useState(false);
  const gridRef = React.useRef<GridImperativeAPI | null>(null);
  const scrollTopRef = React.useRef(0);
  const gridMetricsRef = React.useRef({ innerHeight: 0, rowHeight: 0, rowCount: 0 });

  // 加载文件夹数据
  const loadFolders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getFolders();
      // 模拟数据，后续可从后端获取图片数量和封面
      const foldersWithCount: FolderWithCount[] = data.map(folder => ({
        ...folder,
        imageCount: 0, // 后续从后端获取
        coverImage: undefined // 后续从后端获取
      }));
      setFolders(foldersWithCount);
    } catch (error) {
      console.error('Failed to load folders:', error);
      toast.error(t('history.folder.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // 暴露刷新方法给父组件
  useImperativeHandle(ref, () => ({
    refresh: loadFolders
  }), [loadFolders]);

  // 初始加载
  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  const handleFolderClick = useCallback((folder: FolderWithCount) => {
    console.log('Folder clicked:', folder);
    // TODO: 实现打开文件夹详情的逻辑
  }, []);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    scrollTopRef.current = event.currentTarget.scrollTop;
  }, []);

  type CellData = {
    folders: FolderWithCount[];
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
      folders,
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
      
      if (index >= folders.length) {
        return <div {...ariaAttributes} style={cellStyle} />;
      }
      
      // 数组索引访问，已通过边界检查，不是对象注入漏洞
      const folder = folders[Number(index)];

      return (
        <div {...ariaAttributes} style={cellStyle}>
          <div style={{ width: itemWidth, height: itemHeight }}>
            <FolderCard 
              folder={folder} 
              imageCount={folder.imageCount}
              coverImage={folder.coverImage}
              onClick={() => { handleFolderClick(folder); }}
            />
          </div>
        </div>
      );
    },
    [handleFolderClick]
  );

  if (loading && folders.length === 0) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (folders.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 text-sm">
        {t('history.folder.empty')}
      </div>
    );
  }

  return (
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
          const rowCount = Math.ceil(folders.length / columnCount);
          
          gridMetricsRef.current = {
            innerHeight,
            rowHeight: itemHeight + gap,
            rowCount
          };

          const cellProps: CellData = {
            folders,
            columnCount,
            itemWidth: columnWidth,
            itemHeight,
            gap
          };

          return (
            <div
              style={{ padding }}
              className="h-full"
              onContextMenu={(event) => { event.preventDefault(); }}
            >
              <Grid
                gridRef={gridRef}
                columnCount={columnCount}
                columnWidth={columnWidth + gap}
                rowCount={rowCount}
                rowHeight={itemHeight + gap}
                cellComponent={Cell}
                cellProps={cellProps}
                overscanCount={2}
                style={{ height: innerHeight, width: innerWidth }}
                onScroll={handleScroll}
              />
            </div>
          );
        }}
      />
    </div>
  );
});

export default AlbumView;
