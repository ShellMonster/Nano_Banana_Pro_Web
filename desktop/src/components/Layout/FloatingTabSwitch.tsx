import React, { useState, useRef, useEffect } from 'react';
import { LayoutGrid, History, ChevronLeft, ChevronRight } from 'lucide-react';
import { useGenerateStore } from '../../store/generateStore';
import { useHistoryStore } from '../../store/historyStore';
import { toast } from '../../store/toastStore';
import { cn } from '../common/Button';
import { useTranslation } from 'react-i18next';

interface TabButtonProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  isExpanded: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function TabButton({ icon, label, active, isExpanded, onClick, disabled }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center justify-center rounded-xl transition-all duration-200",
        "relative overflow-hidden",
        isExpanded ? "w-36 px-4 py-2.5" : "w-10 h-10",
        active
          ? "bg-white text-blue-600 shadow-lg ring-2 ring-blue-500/20"
          : "bg-white/80 text-slate-600 hover:text-slate-800 hover:bg-white hover:shadow-md",
        disabled && "cursor-grabbing pointer-events-none"
      )}
    >
      <div className={cn(
        "flex items-center transition-all duration-200",
        isExpanded ? "gap-2 opacity-100" : "gap-0 opacity-100"
      )}>
        <div className="flex-shrink-0">{icon}</div>
        <span className={cn(
          "whitespace-nowrap text-sm font-medium transition-opacity duration-200",
          isExpanded ? "w-auto opacity-100" : "w-0 opacity-0 overflow-hidden"
        )}>
          {label}
        </span>
      </div>
    </button>
  );
}

const STORAGE_KEY = 'floating-tab-position';

function getSavedPosition(): { top: string } | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to read saved position:', e);
  }
  return null;
}

function savePosition(top: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ top }));
  } catch (e) {
    console.error('Failed to save position:', e);
  }
}

export function FloatingTabSwitch() {
  const { t } = useTranslation();
  const currentTab = useGenerateStore((s) => s.currentTab);
  const setTab = useGenerateStore((s) => s.setTab);

  const [isExpanded, setIsExpanded] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // 拖拽相关状态
  const [position, setPosition] = useState(() => {
    const saved = getSavedPosition();
    return saved?.top || '50%';
  });

  const isDraggingRef = useRef(false);
  const hasMovedRef = useRef(false);
  const dragStartY = useRef(0);
  const dragStartTop = useRef(0);
  const currentTopRef = useRef(0);
  const dragThreshold = 5;
  const containerRef = useRef<HTMLDivElement>(null);

  // 同步 position 到 ref
  useEffect(() => {
    currentTopRef.current = parseFloat(position);
  }, [position]);

  const handleMouseEnter = () => {
    if (isDraggingRef.current) return;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    timeoutRef.current = setTimeout(() => {
      if (isMountedRef.current && !isDraggingRef.current) {
        setIsExpanded(true);
      }
      timeoutRef.current = null;
    }, 180);
  };

  const handleMouseLeave = () => {
    if (isDraggingRef.current) return;
    timeoutRef.current = setTimeout(() => {
      if (isMountedRef.current && !isDraggingRef.current) {
        setIsExpanded(false);
      }
      timeoutRef.current = null;
    }, 150);
  };

  const handleTabChange = async (tab: 'generate' | 'history') => {
    // 如果正在拖拽，不处理点击
    if (isDraggingRef.current) return;

    setTab(tab);
    setIsExpanded(false);

    // 切换到历史记录时，强制触发一次加载以获取最新数据
    if (tab === 'history') {
      console.log('[FloatingTabSwitch] switched to history, trigger load');
      const historyState = useHistoryStore.getState();
      const now = Date.now();
      const shouldReload = !historyState.lastLoadedAt || now - historyState.lastLoadedAt > 15000;
      if (shouldReload && !historyState.loading) {
        historyState.loadHistory(true)
          .catch(err => {
            console.error('Failed to reload history on tab switch:', err);
          });
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;

    dragStartY.current = e.clientY;
    dragStartTop.current = currentTopRef.current;
    hasMovedRef.current = false;
    isDraggingRef.current = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - dragStartY.current;

      if (Math.abs(deltaY) < dragThreshold) {
        return;
      }

      hasMovedRef.current = true;

      if (!isDraggingRef.current) {
        isDraggingRef.current = true;
        setIsExpanded(false);
      }

      const newTopPercent = dragStartTop.current + (deltaY / window.innerHeight) * 100;
      const clampedTop = Math.max(10, Math.min(90, newTopPercent));

      currentTopRef.current = clampedTop;
      setPosition(`${clampedTop}%`);
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        savePosition(`${currentTopRef.current}%`);
      }

      isDraggingRef.current = false;
      hasMovedRef.current = false;

      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    e.preventDefault();
  };

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "hidden md:flex fixed right-6 z-50 flex-col gap-2",
        isDraggingRef.current ? "cursor-grabbing" : "cursor-grab"
      )}
      style={{ top: position, transform: 'translateY(-50%)' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
    >
      <div className={cn(
        "flex flex-col gap-1 bg-white rounded-xl p-1.5 shadow-md border border-slate-200",
        isDraggingRef.current && "shadow-xl ring-2 ring-blue-400/50"
      )}>
        <TabButton
          icon={<LayoutGrid className="w-4 h-4" />}
          label={t('nav.generateArea')}
          active={currentTab === 'generate'}
          isExpanded={isExpanded}
          onClick={() => handleTabChange('generate')}
          disabled={isDraggingRef.current}
        />
        <TabButton
          icon={<History className="w-4 h-4" />}
          label={t('nav.historyArea')}
          active={currentTab === 'history'}
          isExpanded={isExpanded}
          onClick={() => handleTabChange('history')}
          disabled={isDraggingRef.current}
        />
      </div>
    </div>
  );
}
