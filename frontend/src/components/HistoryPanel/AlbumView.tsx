import React, { useCallback, useEffect, useImperativeHandle, useMemo, useState, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { Grid, type CellComponentProps, type GridImperativeAPI } from 'react-window';
import { ArrowLeft } from 'lucide-react';
import { FolderCard } from './FolderCard';
import { ImageCard } from './ImageCard';
import { ImagePreview } from '../GenerateArea/ImagePreview';
import { FlattenedImage } from './HistoryList';
import { getFolders, getFolderImages, Folder } from '../../services/folderApi';
import { toast } from '../../store/toastStore';
import { mapBackendHistoryResponse } from '../../utils/mapping';

interface FolderWithCount extends Folder {
  imageCount: number;
  coverImage?: string;
}

const PAGE_SIZE = 20;

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
const getFolderRowExtraHeight = (width: number) => (width >= 640 ? 80 : 72);
const getImageRowExtraHeight = (width: number) => (width >= 640 ? 96 : 88);

const getResolutionLabel = (w: number, h: number) => {
  const max = Math.max(w, h);
  if (max >= 3840) return '4K';
  if (max >= 2048) return '2K';
  if (max >= 1024) return '1K';
  return 'SD';
};

const getRatioLabel = (w: number, h: number) => {
  const r = w / h;
  if (Math.abs(r - 1) < 0.1) return '1:1';
  if (Math.abs(r - 1.77) < 0.1) return '16:9';
  if (Math.abs(r - 0.56) < 0.1) return '9:16';
  if (Math.abs(r - 1.33) < 0.1) return '4:3';
  if (Math.abs(r - 0.75) < 0.1) return '3:4';
  return `${w}:${h}`;
};

const getSafeArrayItem = <T,>(items: T[], idx: number): T | undefined => {
  if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) {
    return undefined;
  }
  return items[idx];
};

export interface AlbumViewRef {
  refresh: () => void;
}

export const AlbumView = forwardRef<AlbumViewRef, {}>(function AlbumView(_props, ref) {
  const { t } = useTranslation();

  const [folders, setFolders] = useState<FolderWithCount[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);

  const [selectedFolder, setSelectedFolder] = useState<FolderWithCount | null>(null);
  const [folderImages, setFolderImages] = useState<FlattenedImage[]>([]);
  const [folderImagesLoading, setFolderImagesLoading] = useState(false);
  const [folderImagesHasMore, setFolderImagesHasMore] = useState(true);
  const [folderImagesPage, setFolderImagesPage] = useState(1);
  const [folderImagesTotal, setFolderImagesTotal] = useState(0);
  const [selectedImage, setSelectedImage] = useState<FlattenedImage | null>(null);

  const folderGridRef = React.useRef<GridImperativeAPI | null>(null);
  const imageGridRef = React.useRef<GridImperativeAPI | null>(null);

  const loadFolders = useCallback(async () => {
    setFoldersLoading(true);
    try {
      const data = await getFolders();
      const foldersWithCount: FolderWithCount[] = data.map((folder) => ({
        ...folder,
        imageCount: folder.image_count ?? 0,
        coverImage: undefined
      }));
      setFolders(foldersWithCount);
    } catch (error) {
      console.error('Failed to load folders:', error);
      toast.error(t('history.folder.loadFailed'));
    } finally {
      setFoldersLoading(false);
    }
  }, [t]);

  const fetchFolderImages = useCallback(async (folderId: number, page: number) => {
    const response = await getFolderImages(folderId, { page, pageSize: PAGE_SIZE });
    const { list, total } = mapBackendHistoryResponse(response);

    const nextImages: FlattenedImage[] = [];
    list.forEach((task) => {
      if (task.images.length === 0) return;
      task.images.forEach((img) => {
        const normalizedUrl = img.url || img.filePath || img.thumbnailPath;
        const normalizedThumbnailUrl = img.thumbnailUrl || img.thumbnailPath || img.filePath || normalizedUrl;
        if (!normalizedUrl) return;
        nextImages.push({
          ...img,
          url: normalizedUrl,
          thumbnailUrl: normalizedThumbnailUrl,
          prompt: task.prompt || '',
          model: task.model || '',
          taskCreatedAt: task.createdAt || '',
          imageSizeLabel: getResolutionLabel(img.width, img.height),
          aspectRatioLabel: getRatioLabel(img.width, img.height)
        });
      });
    });

    return { images: nextImages, total };
  }, []);

  const openFolder = useCallback(async (folder: FolderWithCount) => {
    setSelectedFolder(folder);
    setFolderImages([]);
    setFolderImagesPage(1);
    setFolderImagesHasMore(true);
    setFolderImagesTotal(0);
    setFolderImagesLoading(true);

    try {
      const { images, total } = await fetchFolderImages(folder.id, 1);
      setFolderImages(images);
      setFolderImagesTotal(total);
      setFolderImagesHasMore(images.length < total);
      setFolderImagesPage(1);
    } catch (error) {
      console.error('Failed to load folder images:', error);
      toast.error(t('history.toast.loadFailed'));
    } finally {
      setFolderImagesLoading(false);
    }
  }, [fetchFolderImages, t]);

  const loadMoreFolderImages = useCallback(async () => {
    if (!selectedFolder || folderImagesLoading || !folderImagesHasMore) return;

    const nextPage = folderImagesPage + 1;
    setFolderImagesLoading(true);
    try {
      const { images, total } = await fetchFolderImages(selectedFolder.id, nextPage);
      setFolderImages((prev) => {
        const existingIds = new Set(prev.map((item) => item.id));
        const merged = [...prev];
        images.forEach((item) => {
          if (!existingIds.has(item.id)) {
            merged.push(item);
          }
        });
        return merged;
      });
      setFolderImagesTotal(total);
      setFolderImagesPage(nextPage);
      setFolderImagesHasMore(nextPage * PAGE_SIZE < total);
    } catch (error) {
      console.error('Failed to load more folder images:', error);
      toast.error(t('history.toast.loadFailed'));
    } finally {
      setFolderImagesLoading(false);
    }
  }, [fetchFolderImages, folderImages.length, folderImagesHasMore, folderImagesLoading, folderImagesPage, selectedFolder, t]);

  const closeFolder = useCallback(() => {
    setSelectedFolder(null);
    setFolderImages([]);
    setFolderImagesPage(1);
    setFolderImagesHasMore(true);
    setFolderImagesTotal(0);
    setSelectedImage(null);
  }, []);

  useImperativeHandle(ref, () => ({
    refresh: () => {
      void loadFolders();
      if (selectedFolder) {
        void openFolder(selectedFolder);
      }
    }
  }), [loadFolders, openFolder, selectedFolder]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  const folderCell = useCallback(({
    columnIndex,
    rowIndex,
    style,
    ariaAttributes,
    folders: folderData,
    columnCount,
    itemWidth,
    itemHeight,
    gap
  }: CellComponentProps<{ folders: FolderWithCount[]; columnCount: number; itemWidth: number; itemHeight: number; gap: number }>) => {
    const index = rowIndex * columnCount + columnIndex;
    const cellStyle: React.CSSProperties = {
      ...style,
      width: itemWidth + gap,
      height: itemHeight + gap,
      paddingRight: gap,
      paddingBottom: gap,
      boxSizing: 'border-box'
    };

    if (index >= folderData.length) {
      return <div {...ariaAttributes} style={cellStyle} />;
    }

    const folder = getSafeArrayItem(folderData, index);
    if (!folder) {
      return <div {...ariaAttributes} style={cellStyle} />;
    }
    return (
      <div {...ariaAttributes} style={cellStyle}>
        <div style={{ width: itemWidth, height: itemHeight }}>
          <FolderCard
            folder={folder}
            imageCount={folder.imageCount}
            coverImage={folder.coverImage}
            onClick={() => { void openFolder(folder); }}
          />
        </div>
      </div>
    );
  }, [openFolder]);

  const imageCell = useCallback(({
    columnIndex,
    rowIndex,
    style,
    ariaAttributes,
    images,
    columnCount,
    itemWidth,
    itemHeight,
    gap
  }: CellComponentProps<{ images: FlattenedImage[]; columnCount: number; itemWidth: number; itemHeight: number; gap: number }>) => {
    const index = rowIndex * columnCount + columnIndex;
    const cellStyle: React.CSSProperties = {
      ...style,
      width: itemWidth + gap,
      height: itemHeight + gap,
      paddingRight: gap,
      paddingBottom: gap,
      boxSizing: 'border-box'
    };

    if (index >= images.length) {
      return <div {...ariaAttributes} style={cellStyle} />;
    }

    const image = getSafeArrayItem(images, index);
    if (!image) {
      return <div {...ariaAttributes} style={cellStyle} />;
    }
    return (
      <div {...ariaAttributes} style={cellStyle}>
        <div style={{ width: itemWidth, height: itemHeight }}>
          <ImageCard image={image} onClick={setSelectedImage} />
        </div>
      </div>
    );
  }, []);

  const folderTitle = useMemo(() => {
    if (!selectedFolder) return '';
    return `${selectedFolder.name} (${folderImagesTotal})`;
  }, [folderImagesTotal, selectedFolder]);

  if (!selectedFolder) {
    if (foldersLoading && folders.length === 0) {
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
            const itemHeight = columnWidth + getFolderRowExtraHeight(innerWidth);
            const rowCount = Math.ceil(folders.length / columnCount);

            return (
              <div
                style={{ padding }}
                className="h-full"
                onContextMenu={(event) => { event.preventDefault(); }}
              >
                <Grid
                  gridRef={folderGridRef}
                  columnCount={columnCount}
                  columnWidth={columnWidth + gap}
                  rowCount={rowCount}
                  rowHeight={itemHeight + gap}
                  cellComponent={folderCell}
                  cellProps={{
                    folders,
                    columnCount,
                    itemWidth: columnWidth,
                    itemHeight,
                    gap
                  }}
                  overscanCount={2}
                  style={{ height: innerHeight, width: innerWidth }}
                />
              </div>
            );
          }}
        />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-4 pt-3 pb-2 border-b border-gray-200 bg-white flex items-center gap-3">
        <button
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
          onClick={closeFolder}
        >
          <ArrowLeft className="w-4 h-4" />
          {t('history.folder.backToFolders')}
        </button>
        <div className="text-sm text-gray-700 truncate" title={folderTitle}>
          {folderTitle}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {folderImagesLoading && folderImages.length === 0 ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : folderImages.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-sm">
            {t('history.folder.emptyInFolder')}
          </div>
        ) : (
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
              const itemHeight = columnWidth + getImageRowExtraHeight(innerWidth);
              const rowCount = Math.ceil(folderImages.length / columnCount);

              return (
                <div
                  style={{ padding }}
                  className="h-full"
                  onContextMenu={(event) => { event.preventDefault(); }}
                >
                  <Grid
                    gridRef={imageGridRef}
                    columnCount={columnCount}
                    columnWidth={columnWidth + gap}
                    rowCount={rowCount}
                    rowHeight={itemHeight + gap}
                    cellComponent={imageCell}
                    cellProps={{
                      images: folderImages,
                      columnCount,
                      itemWidth: columnWidth,
                      itemHeight,
                      gap
                    }}
                    overscanCount={2}
                    style={{ height: innerHeight, width: innerWidth }}
                    onCellsRendered={(_, allCells) => {
                      if (folderImagesHasMore && !folderImagesLoading && allCells.rowStopIndex >= rowCount - 1) {
                        void loadMoreFolderImages();
                      }
                    }}
                  />
                </div>
              );
            }}
          />
        )}
      </div>

      {selectedImage && (
        <ImagePreview
          image={selectedImage}
          images={folderImages}
          onImageChange={setSelectedImage}
          onClose={() => { setSelectedImage(null); }}
        />
      )}
    </div>
  );
});

export default AlbumView;
