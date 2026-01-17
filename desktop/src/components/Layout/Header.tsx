import React, { useState } from 'react';
import { LayoutGrid, History, Settings } from 'lucide-react';
import { cn } from '../common/Button';
import { SettingsModal } from '../Settings/SettingsModal';
import { useGenerateStore } from '../../store/generateStore';
import { useTranslation } from 'react-i18next';

export function Header() {
  const { t } = useTranslation();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const currentTab = useGenerateStore((s) => s.currentTab);
  const setTab = useGenerateStore((s) => s.setTab);

  const handleTabChange = (tab: 'generate' | 'history') => {
      setTab(tab);
  };

  return (
    <header 
      className="h-16 flex items-center justify-between px-4 sm:px-8 z-50 sticky top-0 bg-[#f8fafc]/50 backdrop-blur-md pt-2 relative"
    >
      {/* 这里的 data-tauri-drag-region 放在背景层，确保不干扰子元素点击 */}
      <div className="absolute inset-0 [-webkit-app-region:drag]" data-tauri-drag-region />
      
      {/* 左侧：Logo */}
      <div className="flex items-center gap-2 sm:gap-3 pointer-events-none relative z-10">
        <div className="w-8 h-8 sm:w-9 sm:h-9 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200">
            <span className="text-white font-bold text-lg sm:text-xl tracking-tighter">B</span>
        </div>
        <h1 className="text-sm sm:text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600 hidden xs:block">
          {t('app.headerTitle')}
        </h1>
      </div>

      {/* 移动端：Tab 切换 (只在小屏幕显示) */}
      <div className="md:hidden flex items-center gap-1 bg-white/60 backdrop-blur-sm rounded-xl p-1 shadow-sm border border-slate-200/50 relative z-10">
        <button
          onClick={() => handleTabChange('generate')}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
            currentTab === 'generate'
              ? "bg-white text-blue-600 shadow-sm"
              : "text-slate-500 hover:text-slate-700 hover:bg-white/50"
          )}
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          <LayoutGrid className="w-4 h-4" />
          <span>{t('nav.generate')}</span>
        </button>
        <button
          onClick={() => handleTabChange('history')}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
            currentTab === 'history'
              ? "bg-white text-blue-600 shadow-sm"
              : "text-slate-500 hover:text-slate-700 hover:bg-white/50"
          )}
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          <History className="w-4 h-4" />
          <span>{t('nav.history')}</span>
        </button>
      </div>

      {/* 右侧：设置按钮 */}
      <div className="w-[40px] sm:w-[140px] flex justify-end relative z-10">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2.5 text-slate-500 hover:text-blue-600 hover:bg-white rounded-xl transition-all duration-300 shadow-none hover:shadow-sm"
            title={t('nav.settings')}
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            <Settings className="w-5 h-5" />
          </button>
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </header>
  );
}
