import React, { useEffect, useRef } from 'react';
import { SearchBar } from './SearchBar';
import { HistoryList } from './HistoryList';
import { useHistoryStore } from '../../store/historyStore';

interface HistoryPanelProps {
    isActive: boolean;
}

export default function HistoryPanel({ isActive }: HistoryPanelProps) {
  const loadHistory = useHistoryStore((s) => s.loadHistory);

  // 使用 ref 存储上一次的 isActive 值，检测变化
  const prevIsActiveRef = useRef<boolean>();
  const hasLoadedRef = useRef(false);
  const isLoadingRef = useRef(false);

  useEffect(() => {
    const itemsLength = useHistoryStore.getState().items.length;
    console.log('[HistoryPanel] useEffect 触发:', {
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
      console.log('[HistoryPanel] 不是刚激活，跳过');
      return;
    }

    // 如果已经加载过，跳过
    if (hasLoadedRef.current) {
      console.log('[HistoryPanel] 已经加载过，跳过');
      return;
    }

    // 如果已经有数据，标记为已加载并跳过
    if (itemsLength > 0) {
      console.log('[HistoryPanel] 已有数据，标记为已加载:', itemsLength);
      hasLoadedRef.current = true;
      return;
    }

    if (isLoadingRef.current) {
      console.log('[HistoryPanel] 正在加载中，跳过');
      return;
    }

    console.log('[HistoryPanel] 🔥 开始加载历史记录');
    isLoadingRef.current = true;

    loadHistory(true)
      .then(() => {
        console.log('[HistoryPanel] ✅ 加载成功');
        hasLoadedRef.current = true;
      })
      .catch((error) => {
        console.error('[HistoryPanel] ❌ 加载失败:', error);
      })
      .finally(() => {
        isLoadingRef.current = false;
      });
  }, [isActive, loadHistory]); // 只依赖 isActive，不依赖 items.length

  return (
    <div className="h-full bg-gray-50 flex flex-col">
      <div className="p-4 bg-white border-b border-gray-200 shadow-sm z-10">
        <SearchBar />
      </div>

      <div className="flex-1 min-h-0">
        <HistoryList />
      </div>
    </div>
  );
}
