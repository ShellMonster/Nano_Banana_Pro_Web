import React, { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { Input } from '../common/Input';
import { useHistoryStore } from '../../store/historyStore';
import { useTranslation } from 'react-i18next';

export function SearchBar() {
  const { t } = useTranslation();
  const setSearchKeyword = useHistoryStore(s => s.setSearchKeyword);
  const globalKeyword = useHistoryStore(s => s.searchKeyword);
  const [localValue, setLocalValue] = useState(globalKeyword);
  const isFirstRenderRef = useRef(true);

  // 同步全局关键词到本地（当 store 中的关键词变化时）
  useEffect(() => {
    if (globalKeyword !== localValue) {
      setLocalValue(globalKeyword);
    }
  }, [globalKeyword]);

  // 防抖处理
  useEffect(() => {
    // 跳过首次渲染，避免初始化时触发搜索
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }

    const timer = setTimeout(() => {
      setSearchKeyword(localValue);
    }, 500); // 500ms 防抖

    return () => clearTimeout(timer);
  }, [localValue, setSearchKeyword]);

  return (
    <div className="relative">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
      <Input
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={t('history.searchPlaceholder')}
        className="pl-11 bg-slate-50 border-none rounded-2xl h-12 focus:bg-white transition-all shadow-sm"
      />
    </div>
  );
}
