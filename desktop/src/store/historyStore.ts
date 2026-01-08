import { create } from 'zustand';
import { HistoryItem } from '../types';
import { getHistory, searchHistory, deleteHistory, deleteBatchHistory, deleteImage, getHistoryDetail } from '../services/historyApi';
import { mapBackendHistoryResponse, mapBackendTaskToFrontend } from '../utils/mapping';
import { useGenerateStore } from './generateStore';
import { toast } from './toastStore';

interface HistoryState {
  items: HistoryItem[];
  loading: boolean;
  hasMore: boolean;
  page: number;
  total: number;
  searchKeyword: string;

  loadHistory: (reset?: boolean, options?: { silent?: boolean }) => Promise<void>;
  loadMore: () => Promise<void>;
  setSearchKeyword: (keyword: string) => void;
  deleteItem: (id: string) => Promise<void>;
  deleteItems: (ids: string[]) => Promise<void>;
  deleteImage: (imageId: string, taskId: string) => Promise<void>;
  getDetail: (id: string) => Promise<HistoryItem>;
}

let latestHistoryRequestId = 0;

export const useHistoryStore = create<HistoryState>((set, get) => ({
  items: [],
  loading: false,
  hasMore: true,
  page: 1,
  total: 0,
  searchKeyword: '',

  loadHistory: async (reset = false, options) => {
    // 请求序号：防止慢请求覆盖快请求（搜索/翻页/重置时常见）
    const requestId = ++latestHistoryRequestId;

    const { page, searchKeyword } = get();
    const currentPage = reset ? 1 : page;

    set({ loading: true });

    try {
        const response = searchKeyword
            ? await searchHistory({
                page: currentPage,
                pageSize: 10,
                keyword: searchKeyword
              })
            : await getHistory({
                page: currentPage,
                pageSize: 10
              });

        // 如果已经有更新的请求在进行/完成，忽略当前结果
        if (latestHistoryRequestId !== requestId) {
          return;
        }

        // 响应拦截器已返回 res.data（即 { data, total }）
        const { list, total } = mapBackendHistoryResponse(response);

        // 排序：
        // 1. 正在生成中的任务（pending + processing）最前面（临时置顶）
        // 2. 其他任务保持后端返回的顺序（后端已按时间倒序返回）
        const sortedList = [...list].sort((a, b) => {
          // 优先级1：pending 或 processing 状态的任务置顶
          const aIsActive = a.status === 'pending' || a.status === 'processing';
          const bIsActive = b.status === 'pending' || b.status === 'processing';

          if (aIsActive && !bIsActive) {
            return -1; // a 是 pending/processing，b 不是，a 排前面
          }
          if (!aIsActive && bIsActive) {
            return 1; // b 是 pending/processing，a 不是，b 排前面
          }

          // 优先级2：都不是 active 状态，保持后端返回的顺序
          // 后端已经按创建时间倒序返回，无需再排序
          return 0;
        });

        // 计算最终的完整列表（用于更新 state 和同步）
        const finalItems = reset ? sortedList : (() => {
            const existingMap = new Map(get().items.map(item => [item.id, item]));
            for (const item of sortedList) {
                if (!existingMap.has(item.id)) {
                    existingMap.set(item.id, item);
                }
            }
            const newItems = Array.from(existingMap.values());
            // 对合并后的完整列表重新排序，确保顺序正确
            newItems.sort((a, b) => {
              const aIsActive = a.status === 'pending' || a.status === 'processing';
              const bIsActive = b.status === 'pending' || b.status === 'processing';

              if (aIsActive && !bIsActive) {
                return -1;
              }
              if (!aIsActive && bIsActive) {
                return 1;
              }

              // 保持后端返回的时间顺序
              return 0;
            });
            return newItems;
        })();

        // 更新状态
        set({
            items: finalItems,
            total,
            page: currentPage,
            hasMore: finalItems.length < total,
            loading: false
        });

        // 同步：检查历史记录中是否有当前正在生成的任务
        syncWithGenerateStore(finalItems);

        // 如果是重置加载（如切换 Tab 或手动刷新），默认提示成功；
        // 但在非历史页（例如点击“开始生成”触发的后台同步）不打扰用户。
        if (reset && !options?.silent) {
            const currentTab = useGenerateStore.getState().currentTab;
            if (currentTab === 'history') {
              toast.success('历史记录已更新');
            }
        }
    } catch (error) {
        // 旧请求失败不提示，避免搜索抖动时刷屏
        if (latestHistoryRequestId !== requestId) {
          return;
        }

        console.error('Failed to load history:', error);
        const errorMessage = error instanceof Error ? error.message : '加载历史记录失败';
        toast.error(errorMessage);
        set({ loading: false });
    }
  },

  loadMore: async () => {
    const { page, hasMore, loading } = get();
    if (!hasMore || loading) return;
    
    set({ page: page + 1 });
    await get().loadHistory(false);
  },

  setSearchKeyword: (searchKeyword) => {
      set({ searchKeyword });
      get().loadHistory(true, { silent: true }); // 搜索时重置并重新加载（不弹“已更新”提示）
  },

  deleteItem: async (id) => {
    try {
        await deleteHistory(id);
        set((state) => ({
            items: state.items.filter(item => item.id !== id),
            total: state.total - 1
        }));
        toast.success('记录已删除');
    } catch (error) {
        console.error('Failed to delete history item:', error);
        const errorMessage = error instanceof Error ? error.message : '删除记录失败';
        toast.error(errorMessage);
    }
  },

  deleteItems: async (ids) => {
      try {
          await deleteBatchHistory(ids);
          const idSet = new Set(ids);
          set((state) => ({
              items: state.items.filter(item => !idSet.has(item.id)),
              total: state.total - ids.length
          }));
          toast.success(`已删除 ${ids.length} 条记录`);
      } catch (error) {
          console.error('Failed to delete history items:', error);
          const errorMessage = error instanceof Error ? error.message : '批量删除失败';
          toast.error(errorMessage);
      }
  },

  // 删除单张图片：先本地移除，再刷新列表
  deleteImage: async (imageId: string, taskId: string) => {
      try {
          // 先调用删除 API
          await deleteImage(imageId);

          // 同步：生成区也可能缓存了同一张图片，删除后应一并移除
          //（generateStore.removeImage 内部会同时移除选中状态）
          useGenerateStore.getState().removeImage(imageId);

          // 本地移除图片（立即更新 UI）
          set((state) => {
              const updatedItems = state.items.map(item => {
                  if (item.id === taskId && item.images) {
                      const filteredImages = item.images.filter(img => img.id !== imageId);
                      return {
                          ...item,
                          images: filteredImages,
                          completedCount: filteredImages.length
                      };
                  }
                  return item;
              }).filter(item => {
                  // 如果任务没有图片了，从列表中移除
                  return !(item.id === taskId && (!item.images || item.images.length === 0));
              });

              const removedTaskCount = state.items.length - updatedItems.length;
              const nextTotal = Math.max(0, state.total - removedTaskCount);

              return {
                  items: updatedItems,
                  total: nextTotal,
                  hasMore: updatedItems.length < nextTotal
              };
          });

          toast.success('图片已删除');

          // 后台刷新列表以同步后端状态
          await get().loadHistory(true, { silent: true });
      } catch (error) {
          console.error('Failed to delete image:', error);
          const errorMessage = error instanceof Error ? error.message : '删除图片失败';
          toast.error(errorMessage);
          throw error;
      }
  },

  // 获取详情
  getDetail: async (id: string) => {
    try {
      const response = await getHistoryDetail(id);
      const task = mapBackendTaskToFrontend(response);
      return task;
    } catch (error) {
      console.error('Failed to fetch detail:', error);
      throw error;
    }
  }
}));

// 同步函数：检查历史记录中是否有当前正在生成的任务，并同步状态
function syncWithGenerateStore(historyItems: HistoryItem[]) {
  const generateStore = useGenerateStore.getState();
  const currentTaskId = generateStore.taskId;
  const currentStatus = generateStore.status;

  // 如果本地没有任务ID，直接返回
  if (!currentTaskId) {
    return;
  }

  // 在历史记录中查找当前任务
  const currentTaskInHistory = historyItems.find(item => item.id === currentTaskId);

  if (!currentTaskInHistory) {
    // 历史记录中没有找到这个任务
    // 如果本地状态是 processing，说明任务可能已过期或被删除，清理本地状态
    if (currentStatus === 'processing') {
      console.log('Task not found in history, clearing local state');
      generateStore.clearTaskState();
    }
    return;
  }

  // 找到了任务，对比状态
  const historyStatus = currentTaskInHistory.status;

  // 如果历史记录中任务不是 processing 状态，清空本地状态
  if (historyStatus !== 'processing' && currentStatus === 'processing') {
    console.log(`Task status mismatch: local=${currentStatus}, history=${historyStatus}, clearing local state`);

    if (historyStatus === 'completed') {
      // 任务已完成：同步最后结果并结束生成态（避免生成区“卡在生成中”）
      if (currentTaskInHistory.images.length > 0) {
        generateStore.updateProgressBatch(currentTaskInHistory.completedCount, currentTaskInHistory.images);
      } else {
        generateStore.updateProgress(currentTaskInHistory.completedCount, null);
      }
      generateStore.completeTask();
      // 不显示 toast，避免打扰
    } else if (historyStatus === 'failed') {
      // 任务失败：结束生成态并提示
      generateStore.failTask(currentTaskInHistory.errorMessage || '生成任务失败');
      toast.error(`生成任务失败：${currentTaskInHistory.errorMessage || '未知错误'}`);
    } else if (historyStatus === 'partial') {
      // 部分完成：同步已生成的结果并结束生成态
      if (currentTaskInHistory.images.length > 0) {
        generateStore.updateProgressBatch(currentTaskInHistory.completedCount, currentTaskInHistory.images);
      } else {
        generateStore.updateProgress(currentTaskInHistory.completedCount, null);
      }
      generateStore.completeTask();
      toast.info('生成任务部分完成，请查看历史记录');
    } else {
      generateStore.clearTaskState();
    }
    return;
  }

  // 如果本地状态不是 processing，但历史记录中是 processing，不应该发生（跳过）
  if (currentStatus !== 'processing') {
    return;
  }

  // 两边都是 processing，同步进度
  // 同步所有历史记录中的图片，避免中间图片丢失
  if (currentTaskInHistory.images.length > 0) {
    currentTaskInHistory.images.forEach((image) => {
      generateStore.updateProgress(currentTaskInHistory.completedCount, image);
    });
  } else {
    // 如果没有图片，至少同步进度数
    generateStore.updateProgress(currentTaskInHistory.completedCount, null);
  }
  console.log('Synced: Task progress from history');
}
