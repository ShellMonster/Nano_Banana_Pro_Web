import React, { useState, useEffect, useRef } from 'react';
import { Header } from './Header';
import { FloatingTabSwitch } from './FloatingTabSwitch';
import ConfigPanel from '../ConfigPanel';
import GenerateArea from '../GenerateArea';
import HistoryPanel from '../HistoryPanel';
import { useGenerateStore } from '../../store/generateStore';
import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from 'lucide-react';
import { useHistoryStore } from '../../store/historyStore';
import { TemplateMarketDrawer } from '../TemplateMarket/TemplateMarketDrawer';

export default function MainLayout() {
  const currentTab = useGenerateStore((s) => s.currentTab);
  const isSidebarOpen = useGenerateStore((s) => s.isSidebarOpen);
  const setSidebarOpen = useGenerateStore((s) => s.setSidebarOpen);
  const taskId = useGenerateStore((s) => s.taskId);
  const status = useGenerateStore((s) => s.status);

  const [isHydrated, setIsHydrated] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isTemplateMarketOpen, setIsTemplateMarketOpen] = useState(false);

  // 确保状态恢复
  useEffect(() => setIsHydrated(true), []);

  // 刷新后如果仍有进行中的任务，后台拉一次历史触发 syncWithGenerateStore 做纠偏/恢复
  // 避免“必须切到历史页才恢复”的业务闭环缺口
  const hasSyncedProcessingTaskRef = useRef(false);
  useEffect(() => {
    if (!isHydrated) return;
    if (hasSyncedProcessingTaskRef.current) return;
    if (status !== 'processing' || !taskId) return;

    hasSyncedProcessingTaskRef.current = true;
    useHistoryStore.getState().loadHistory(true).catch(() => {});
  }, [isHydrated, status, taskId]);

  // 任务恢复逻辑：由历史记录加载后的 syncWithGenerateStore 处理

  if (!isHydrated) return null;

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc] overflow-hidden font-sans antialiased text-slate-900">
      <Header />

      <main className="flex-1 flex overflow-hidden p-4 gap-4 relative">
        {/* 桌面端：左侧配置栏 */}
        <aside
            className={`
                hidden md:flex bg-white/70 backdrop-blur-xl rounded-3xl shadow-sm border border-white/40 flex-shrink-0 flex-col overflow-hidden transition-all duration-500 ease-in-out relative
                ${isSidebarOpen ? 'w-96 opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-full ml-[-1rem]'}
            `}
        >
          <div className="w-96 h-full">
            <ConfigPanel />
          </div>
        </aside>

        {/* 桌面端：收起/展开切换按钮 */}
        <button
            onClick={() => setSidebarOpen(!isSidebarOpen)}
            className={`
                hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 z-40 w-6 h-12 bg-white/80 backdrop-blur-md border border-slate-200 shadow-sm items-center justify-center transition-all duration-500
                ${isSidebarOpen ? 'left-[24.5rem] rounded-l-lg' : 'left-4 rounded-r-lg'}
                hover:bg-white hover:text-blue-600 group
            `}
        >
            {isSidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {/* 移动端：浮动配置按钮 */}
        <button
            onClick={() => setIsMobileDrawerOpen(true)}
            className="md:hidden fixed right-6 bottom-6 z-[60] w-14 h-14 bg-gradient-to-tr from-blue-600 to-indigo-500 text-white rounded-full shadow-2xl flex items-center justify-center active:scale-90 transition-transform"
        >
            <SlidersHorizontal className="w-6 h-6" />
        </button>

        {/* 移动端：配置抽屉 (Drawer) */}
        {isMobileDrawerOpen && (
            <div className="md:hidden fixed inset-0 z-[100] flex flex-col justify-end">
                <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsMobileDrawerOpen(false)} />
                <div className="relative bg-white rounded-t-[2.5rem] shadow-2xl animate-in slide-in-from-bottom duration-300 max-h-[90vh] flex flex-col">
                    <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100">
                        <h3 className="text-xl font-black">生成配置</h3>
                        <button onClick={() => setIsMobileDrawerOpen(false)} className="p-2 bg-slate-100 rounded-xl"><X className="w-5 h-5" /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4">
                        <ConfigPanel />
                    </div>
                </div>
            </div>
        )}

        {/* 桌面端：右侧悬浮 Tab 切换 */}
        {!isTemplateMarketOpen && <FloatingTabSwitch />}

        {/* 右侧主内容区域 */}
        <section className="flex-1 bg-white md:bg-white/70 backdrop-blur-xl rounded-2xl md:rounded-3xl shadow-sm border border-white/40 overflow-hidden relative">
          <TemplateMarketDrawer onOpenChange={setIsTemplateMarketOpen} />
          <div className={`absolute inset-0 transition-opacity duration-500 ${currentTab === 'generate' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
             <GenerateArea />
          </div>
          <div className={`absolute inset-0 transition-opacity duration-500 ${currentTab === 'history' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
             <HistoryPanel isActive={currentTab === 'history'} />
          </div>
        </section>
      </main>
    </div>
  );
}
