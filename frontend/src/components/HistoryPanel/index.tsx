import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderPlus } from 'lucide-react';
import { SearchBar } from './SearchBar';
import { HistoryList } from './HistoryList';
import { ViewToggle } from './ViewToggle';
import { AlbumView, AlbumViewRef } from './AlbumView';
import { CreateFolderDialog } from './CreateFolderDialog';
import { useHistoryStore } from '../../store/historyStore';

interface HistoryPanelProps {
    isActive: boolean;
}

export default function HistoryPanel({ isActive }: HistoryPanelProps) {
  const { t } = useTranslation();
  const loadHistory = useHistoryStore((s) => s.loadHistory);
  const viewMode = useHistoryStore((s) => s.viewMode);
  const setViewMode = useHistoryStore((s) => s.setViewMode);
  
  const [isCreateFolderDialogOpen, setIsCreateFolderDialogOpen] = useState(false);
  const albumViewRef = useRef<AlbumViewRef>(null);

  // 使用 ref 存储上一次的 isActive 值，检测变化
  const prevIsActiveRef = useRef<boolean>();
  const hasLoadedRef = useRef(false);
  const isLoadingRef = useRef(false);

  useEffect(() => {
    const itemsLength = useHistoryStore.getState().items.length;
    console.log('[HistoryPanel] useEffect triggered:', {
      isActive,
      prevIsActive: prevIsActiveRef.current,
      isLoading: isLoadingRef.current,
      hasLoaded: hasLoadedRef.current,
      itemsLength
    });

    // 只在激活状态下加载
    if (!isActive) {
      prevIsActiveRef.current = isActive;
      return;
    }

    // 检测 isActive 是否从 false 变为 true 或从未设置过
    const justActivated = prevIsActiveRef.current === false || prevIsActiveRef.current === undefined;
    prevIsActiveRef.current = isActive;

    // 只在刚激活时考虑加载
    if (!justActivated) {
      console.log('[HistoryPanel] not newly active, skip');
      return;
    }

    // 如果已经加载过，跳过
    if (hasLoadedRef.current) {
      console.log('[HistoryPanel] already loaded, skip');
      return;
    }

    // 如果已经有数据，标记为已加载并跳过
    if (itemsLength > 0) {
      console.log('[HistoryPanel] data exists, mark loaded:', itemsLength);
      hasLoadedRef.current = true;
      return;
    }

    if (isLoadingRef.current) {
      console.log('[HistoryPanel] loading in progress, skip');
      return;
    }

    console.log('[HistoryPanel] start loading history');
    isLoadingRef.current = true;

    loadHistory(true)
      .then(() => {
        console.log('[HistoryPanel] load success');
        hasLoadedRef.current = true;
      })
      .catch((error) => {
        console.error('[HistoryPanel] load failed:', error);
      })
      .finally(() => {
        isLoadingRef.current = false;
      });
  }, [isActive, loadHistory]); // 只依赖 isActive，不依赖 items.length

  return (
    <div className="h-full bg-gray-50 flex flex-col">
      <div className="p-4 bg-white border-b border-gray-200 shadow-sm z-10">
        <div className="flex items-center justify-between gap-4">
          <SearchBar />
          <div className="flex items-center gap-2">
            {viewMode === 'album' && (
              <button
                onClick={() => setIsCreateFolderDialogOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
              >
                <FolderPlus className="w-4 h-4" />
                {t('history.folder.create')}
              </button>
            )}
            <ViewToggle viewMode={viewMode} onChange={setViewMode} />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {viewMode === 'timeline' ? <HistoryList /> : <AlbumView ref={albumViewRef} />}
      </div>
      
      <CreateFolderDialog
        isOpen={isCreateFolderDialogOpen}
        onClose={() => setIsCreateFolderDialogOpen(false)}
        onSuccess={() => {
          albumViewRef.current?.refresh();
        }}
      />
    </div>
  );
}
