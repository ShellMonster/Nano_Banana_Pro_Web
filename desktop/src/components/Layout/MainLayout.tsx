import React, { useState, useEffect, useRef, Suspense, lazy, useMemo } from 'react';
import { Header } from './Header';
import { FloatingTabSwitch } from './FloatingTabSwitch';
import GenerateArea from '../GenerateArea';
import { useGenerateStore } from '../../store/generateStore';
import { useHistoryStore } from '../../store/historyStore';
import { ChevronLeft, ChevronRight, SlidersHorizontal, X, AlertTriangle, Loader2 } from 'lucide-react';
import api from '../../services/api';
import { toast } from '../../store/toastStore';
import { VersionBadge } from '../common/VersionBadge';
import { InternalDragLayer } from '../common/InternalDragLayer';
import { getTaskStatus } from '../../services/generateApi';
import { getUpdateSource } from '../../store/updateSourceStore';
import { TemplateMarketDrawer } from '../TemplateMarket/TemplateMarketDrawer';

// 使用懒加载减少初始包体积
const ConfigPanel = lazy(() => import('../ConfigPanel'));
const HistoryPanel = lazy(() => import('../HistoryPanel'));

// 懒加载加载中状态
const PanelLoader = () => (
  <div className="flex-1 flex items-center justify-center bg-white/50 backdrop-blur-sm rounded-3xl">
    <div className="flex flex-col items-center gap-3">
      <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      <span className="text-sm text-slate-500">正在加载模块...</span>
    </div>
  </div>
);

import { tauriInitPromise } from '../../services/api';

export default function MainLayout() {
  const currentTab = useGenerateStore((s) => s.currentTab);
  const setTab = useGenerateStore((s) => s.setTab);
  const isSidebarOpen = useGenerateStore((s) => s.isSidebarOpen);
  const setSidebarOpen = useGenerateStore((s) => s.setSidebarOpen);
  const taskId = useGenerateStore((s) => s.taskId);
  const status = useGenerateStore((s) => s.status);
  const images = useGenerateStore((s) => s.images);
  const totalCount = useGenerateStore((s) => s.totalCount);
  const completedCount = useGenerateStore((s) => s.completedCount);
  const errorMessage = useGenerateStore((s) => s.error);

  const [isHydrated, setIsHydrated] = useState(false);
  const [isTauriReady, setIsTauriReady] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isBackendHealthy, setIsBackendHealthy] = useState<boolean | null>(null);
  const [isTemplateMarketOpen, setIsTemplateMarketOpen] = useState(false);
  const safeTab = currentTab === 'history' ? 'history' : 'generate';
  const lastTaskIdRef = useRef<string | null>(null);

  // 1. 确保状态恢复
  useEffect(() => {
    setIsHydrated(true);
    tauriInitPromise.then(() => setIsTauriReady(true));
  }, []);

  useEffect(() => {
    import('../HistoryPanel');
  }, []);

  useEffect(() => {
    if (currentTab !== 'generate' && currentTab !== 'history') {
      setTab('generate');
    }
  }, [currentTab, setTab]);

  useEffect(() => {
    if (taskId) {
      lastTaskIdRef.current = taskId;
    }
  }, [taskId]);

  // 2. 检查后端健康状态
  useEffect(() => {
    if (!isHydrated || !isTauriReady) return;

    let retryCount = 0;
    const maxRetries = 5;

    const checkHealth = async () => {
      try {
        await api.get('/health');
        setIsBackendHealthy(true);
        retryCount = 0; // 重置重试计数
      } catch (error) {
        console.error('Backend health check failed:', error);
        
        // 只有在重试多次都失败后才提示用户，给 Sidecar 启动留出时间
        if (retryCount >= maxRetries) {
          setIsBackendHealthy(false);
          toast.error('无法连接到本地后端服务，请尝试重启应用');
        } else {
          retryCount++;
        }
      }
    };

    // 延迟 1 秒进行第一次检查，给 Sidecar 启动时间
    const initialTimer = setTimeout(checkHealth, 1000);
    const intervalTimer = setInterval(checkHealth, 5000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [isHydrated]);

  const hasPrefetchedHistoryRef = useRef(false);
  useEffect(() => {
    if (!isHydrated || !isTauriReady) return;
    if (hasPrefetchedHistoryRef.current) return;

    const historyState = useHistoryStore.getState();
    if (historyState.items.length > 0 || historyState.loading) {
      hasPrefetchedHistoryRef.current = true;
      return;
    }

    hasPrefetchedHistoryRef.current = true;
    historyState.loadHistory(true, { silent: true }).catch(() => {
      hasPrefetchedHistoryRef.current = false;
    });
  }, [isHydrated, isTauriReady]);

  // 轻量同步：生成区状态变化时写回历史列表，避免两边状态不一致
  useEffect(() => {
    if (!isHydrated || !isTauriReady) return;
    const syncTaskId = taskId || (status !== 'idle' ? lastTaskIdRef.current : null);
    if (!syncTaskId) return;

    const taskImages = images.filter((img) => img.taskId === syncTaskId);
    const historyStatus = status === 'idle' ? undefined : status;
    useHistoryStore.getState().upsertTask({
      id: syncTaskId,
      status: historyStatus,
      totalCount,
      completedCount,
      errorMessage: status === 'failed' ? (errorMessage || '') : '',
      images: taskImages,
      updatedAt: new Date().toISOString()
    });
  }, [isHydrated, isTauriReady, taskId, status, totalCount, completedCount, images, errorMessage]);

  const hasCurrentTaskImages = useMemo(() => {
    if (!taskId) return false;
    return images.some((img) => img.taskId === taskId);
  }, [images, taskId]);

  // 冷启动恢复：如果本地持久化了 processing taskId，但生成区没有任何该任务的卡片
  // 常见于：退出 App 后重开，Sidecar 后端尚未就绪导致未能及时同步，UI 会“卡在生成中但列表空”
  const isRecoveringTaskRef = useRef(false);
  useEffect(() => {
    if (!isHydrated || !isTauriReady) return;
    if (status !== 'processing' || !taskId) return;
    if (hasCurrentTaskImages) return;
    if (isRecoveringTaskRef.current) return;

    isRecoveringTaskRef.current = true;
    let cancelled = false;

    const recover = async () => {
      const maxAttempts = 12;
      for (let attempt = 0; attempt < maxAttempts && !cancelled; attempt++) {
        try {
          const taskData = await getTaskStatus(taskId);
          if (cancelled) return;

          const current = useGenerateStore.getState();
          if (current.status !== 'processing' || current.taskId !== taskId) return;

          // 后端 task.status 为 pending/processing/completed/failed
          if (taskData.status === 'processing' || taskData.status === 'pending') {
            current.restoreTaskState({
              taskId,
              status: 'processing',
              totalCount: taskData.totalCount,
              completedCount: taskData.completedCount,
              images: taskData.images || []
            });
            return;
          }

          if (taskData.status === 'completed') {
            // 恢复完成态：保留图片展示，避免用户感觉“生成丢了”
            current.restoreTaskState({
              taskId,
              status: 'processing',
              totalCount: taskData.totalCount,
              completedCount: taskData.completedCount,
              images: taskData.images || []
            });
            current.completeTask();
            return;
          }

          if (taskData.status === 'failed') {
            current.failTask(taskData.errorMessage || '生成任务失败');
            return;
          }

          // 兜底：未知状态，清理本地任务状态，避免卡在 processing
          current.clearTaskState();
          return;
        } catch (err) {
          // Sidecar 启动/端口切换期间可能短暂失败：做有限次重试，避免“永远卡住”
          const delay = Math.min(500 * (attempt + 1), 3000);
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      // 重试仍失败：如果仍然没有任何可展示的卡片，清理掉 processing 状态避免 UI 假死
      const current = useGenerateStore.getState();
      if (current.status === 'processing' && current.taskId === taskId && current.images.length === 0) {
        current.clearTaskState();
      }
    };

    recover().finally(() => {
      isRecoveringTaskRef.current = false;
    });

    return () => {
      cancelled = true;
    };
  }, [isHydrated, isTauriReady, status, taskId, hasCurrentTaskImages]);

  // 任务恢复逻辑：冷启动恢复 + 轮询/WS 驱动进度更新

  // 常驻 Watchdog：当轮询/WS 因组件卸载或竞态停摆时，兜底同步任务完成态
  // 典型场景：移动端抽屉关闭导致 ConfigPanel 卸载，useGenerate 内的轮询随之停止
  const isTaskWatchdogRunningRef = useRef(false);
  const hasWarnedCountMismatchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isHydrated || !isTauriReady) return;

    let cancelled = false;
    const POLL_MS = 3000;
    const POLL_ALIVE_THRESHOLD_MS = 4500;

    const tick = async () => {
      if (cancelled) return;

      const state = useGenerateStore.getState();
      const currentTaskId = state.taskId;
      if (state.status !== 'processing' || !currentTaskId) return;

      const now = Date.now();
      const last = state.lastMessageTime ?? state.startTime ?? now;
      const staleMs = now - last;

      // 若已有“看起来活着”的轮询在跑，就不要重复拉（避免桌面端双重轮询）
      const source = getUpdateSource();
      const pollingSeemsAlive = source === 'polling' && state.connectionMode === 'polling' && staleMs < POLL_ALIVE_THRESHOLD_MS;
      if (pollingSeemsAlive) return;

      if (isTaskWatchdogRunningRef.current) return;
      isTaskWatchdogRunningRef.current = true;

      try {
        const taskData = await getTaskStatus(currentTaskId);
        if (cancelled) return;

        const latest = useGenerateStore.getState();
        if (latest.status !== 'processing' || latest.taskId !== currentTaskId) return;

        // 同步图片与进度（保持生成区展示最新结果）
        if (taskData.images && taskData.images.length > 0) {
          latest.updateProgressBatch(taskData.completedCount, taskData.images);
        } else {
          latest.updateProgress(taskData.completedCount, null);
        }

        // 若后端已完成/失败，立即结束生成态（避免“时间一直计数但不结束”）
        if (taskData.status === 'completed') {
          if (
            taskData.totalCount > 1 &&
            (taskData.images?.length || 0) < taskData.totalCount &&
            hasWarnedCountMismatchRef.current !== currentTaskId
          ) {
            hasWarnedCountMismatchRef.current = currentTaskId;
            toast.info(`本次请求期望生成 ${taskData.totalCount} 张，但后端仅返回 ${taskData.images?.length || 0} 张`);
          }
          latest.completeTask();
          return;
        }

        if (taskData.status === 'failed') {
          latest.failTask(taskData.errorMessage || '生成任务失败');
          return;
        }

        if (taskData.status === 'partial') {
          toast.info('生成任务部分完成，请查看历史记录');
          latest.completeTask();
          return;
        }

        // 仍在 processing：若 WebSocket 模式下长时间无更新，切到 polling 让后续逻辑可接管
        if (staleMs > POLL_ALIVE_THRESHOLD_MS && latest.connectionMode !== 'polling') {
          latest.setConnectionMode('polling');
        }
      } catch (err) {
        // 网络/端口切换短暂失败：不打断用户，仅在需要时切到 polling 以便重试
        const latest = useGenerateStore.getState();
        if (!cancelled && latest.status === 'processing' && latest.taskId === currentTaskId && latest.connectionMode !== 'polling') {
          latest.setConnectionMode('polling');
        }
      } finally {
        isTaskWatchdogRunningRef.current = false;
      }
    };

    const timer = setInterval(() => void tick(), POLL_MS);
    const immediate = setTimeout(() => void tick(), 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(immediate);
    };
  }, [isHydrated, isTauriReady]);

  const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

  if (!isHydrated) return null;

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc] overflow-hidden font-sans antialiased text-slate-900">
      {/* macOS overlay + transparent 下没有系统拖动区：提供全局“边缘拖动条”，且始终在弹窗之上 */}
      {isTauri && (
        <>
          <div
            className="fixed top-0 left-0 right-0 h-2 z-[10000] [-webkit-app-region:drag]"
            data-tauri-drag-region
          />
          <div
            className="fixed bottom-0 left-0 right-0 h-2 z-[10000] [-webkit-app-region:drag]"
            data-tauri-drag-region
          />
          <div
            className="fixed top-0 bottom-0 left-0 w-2 z-[10000] [-webkit-app-region:drag]"
            data-tauri-drag-region
          />
          <div
            className="fixed top-0 bottom-0 right-0 w-2 z-[10000] [-webkit-app-region:drag]"
            data-tauri-drag-region
          />
        </>
      )}

      <Header />
      <InternalDragLayer />

      {isBackendHealthy === false && (
        <div className="mx-4 mt-2 p-3 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 animate-in fade-in slide-in-from-top-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <div className="text-sm font-bold">
            本地服务连接失败。这可能是由于服务正在启动或被防火墙拦截。
          </div>
        </div>
      )}

      <main className="flex-1 flex overflow-hidden p-4 gap-4 relative">
        {/* 桌面端：左侧配置栏 */}
        <aside
            className={`
                hidden md:flex bg-white/70 backdrop-blur-xl rounded-3xl shadow-sm border border-white/40 flex-shrink-0 flex-col overflow-hidden transition-all duration-500 ease-in-out relative
                ${isSidebarOpen ? 'w-96 opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-full ml-[-1rem]'}
            `}
        >
          <div className="w-96 h-full">
            <Suspense fallback={<PanelLoader />}>
              <ConfigPanel />
            </Suspense>
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
                        <Suspense fallback={<PanelLoader />}>
                            <ConfigPanel />
                        </Suspense>
                    </div>
                </div>
            </div>
        )}

        {/* 桌面端：右侧悬浮 Tab 切换 */}
        {!isTemplateMarketOpen && <FloatingTabSwitch />}

        {/* 右侧主内容区域 */}
        <section className="flex-1 bg-white md:bg-white/70 backdrop-blur-xl rounded-2xl md:rounded-3xl shadow-sm border border-white/40 overflow-hidden relative">
          <TemplateMarketDrawer onOpenChange={setIsTemplateMarketOpen} />
          <div className={`absolute inset-0 transition-opacity duration-500 ${safeTab === 'generate' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
             <GenerateArea />
          </div>
          <div className={`absolute inset-0 transition-opacity duration-500 ${safeTab === 'history' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
             <Suspense fallback={<PanelLoader />}>
               <HistoryPanel isActive={safeTab === 'history'} />
             </Suspense>
          </div>
        </section>
      </main>

      <VersionBadge />
    </div>
  );
}
