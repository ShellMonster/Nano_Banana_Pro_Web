import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { GeneratedImage, HistoryItem } from '../types';
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
  lastLoadedAt: number | null;

  loadHistory: (reset?: boolean, options?: { silent?: boolean }) => Promise<void>;
  loadMore: () => Promise<void>;
  setSearchKeyword: (keyword: string) => void;
  deleteItem: (id: string) => Promise<void>;
  deleteItems: (ids: string[]) => Promise<void>;
  deleteImage: (imageId: string, taskId: string) => Promise<void>;
  getDetail: (id: string) => Promise<HistoryItem>;
  upsertTask: (task: HistoryTaskUpdate) => void;
}

let latestHistoryRequestId = 0;

type HistoryTaskUpdate = Partial<HistoryItem> & { id: string };

const mergeImages = (existing: GeneratedImage[] = [], incoming: GeneratedImage[] = []) => {
  if (!incoming.length) return existing;
  const imageMap = new Map(existing.map((img) => [img.id, img]));
  incoming.forEach((img) => {
    const prev = imageMap.get(img.id);
    imageMap.set(img.id, prev ? { ...prev, ...img } : img);
  });
  return Array.from(imageMap.values());
};

const mergeTask = (existing: HistoryItem | undefined, incoming: HistoryTaskUpdate): HistoryItem => {
  if (!existing) {
    return {
      id: incoming.id,
      prompt: incoming.prompt || '',
      model: incoming.model || '',
      totalCount: incoming.totalCount ?? 0,
      completedCount: incoming.completedCount ?? 0,
      status: incoming.status || 'processing',
      options: incoming.options || '',
      errorMessage: incoming.errorMessage || '',
      createdAt: incoming.createdAt || new Date().toISOString(),
      updatedAt: incoming.updatedAt || new Date().toISOString(),
      images: incoming.images ? [...incoming.images] : []
    };
  }

  const mergedImages = mergeImages(existing.images, incoming.images || []);
  const nextTotal =
    typeof incoming.totalCount === 'number' && incoming.totalCount > 0 ? incoming.totalCount : existing.totalCount;
  const nextCompleted =
    typeof incoming.completedCount === 'number'
      ? Math.max(existing.completedCount, incoming.completedCount)
      : existing.completedCount;

  return {
    ...existing,
    ...incoming,
    prompt: incoming.prompt || existing.prompt,
    model: incoming.model || existing.model,
    options: incoming.options || existing.options,
    errorMessage: incoming.errorMessage || existing.errorMessage,
    totalCount: nextTotal,
    completedCount: nextCompleted,
    createdAt: incoming.createdAt || existing.createdAt,
    updatedAt: incoming.updatedAt || existing.updatedAt,
    images: mergedImages
  };
};

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
  items: [],
  loading: false,
  hasMore: true,
  page: 1,
  total: 0,
  searchKeyword: '',
  lastLoadedAt: null,

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
            lastLoadedAt: Date.now(),
            loading: false
        });

        // 同步：检查历史记录中是否有当前正在生成的任务
        syncWithGenerateStore(finalItems);
    } catch (error) {
        // 旧请求失败不提示，避免搜索抖动时刷屏
        if (latestHistoryRequestId !== requestId) {
          return;
        }

        console.error('Failed to load history:', error);
        if (!options?.silent) {
          const errorMessage = error instanceof Error ? error.message : '加载历史记录失败';
          toast.error(errorMessage);
        }
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
      get().loadHistory(true, { silent: true }); // 搜索时重置并重新加载
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

          // 后台轻量同步（不重置分页，避免滚动跳顶）
          get().loadHistory(false, { silent: true });
      } catch (error) {
          console.error('Failed to delete image:', error);
          const errorMessage = error instanceof Error ? error.message : '删除图片失败';
          toast.error(errorMessage);
          throw error;
      }
  },

  upsertTask: (task) => {
    set((state) => {
      const existingIndex = state.items.findIndex((item) => item.id === task.id);
      const nextItems = [...state.items];
      if (existingIndex >= 0) {
        nextItems[existingIndex] = mergeTask(nextItems[existingIndex], task);
      } else {
        nextItems.unshift(mergeTask(undefined, task));
      }
      return { items: nextItems };
    });
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
    }),
    {
      name: 'history-cache',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        items: state.items,
        total: state.total,
        page: state.page,
        lastLoadedAt: state.lastLoadedAt
      }),
      merge: (persistedState, currentState) => {
        const incoming = persistedState as Partial<HistoryState> | undefined;
        if (!incoming || typeof incoming !== 'object') {
          return currentState;
        }
        const items = Array.isArray(incoming.items) ? incoming.items : currentState.items;
        const total = typeof incoming.total === 'number' ? incoming.total : currentState.total;
        const page = typeof incoming.page === 'number' ? incoming.page : currentState.page;
        const lastLoadedAt =
          typeof incoming.lastLoadedAt === 'number' ? incoming.lastLoadedAt : currentState.lastLoadedAt;
        return {
          ...currentState,
          items,
          total,
          page,
          lastLoadedAt,
          hasMore: items.length < total,
          loading: false
        };
      }
    }
  )
);

// 同步函数：检查历史记录中是否有当前正在生成的任务，并同步状态
function syncWithGenerateStore(historyItems: HistoryItem[]) {
  const generateStore = useGenerateStore.getState();
  const currentTaskId = generateStore.taskId;
  const currentStatus = generateStore.status;
  const historyMap = new Map(historyItems.map((item) => [item.id, item]));

  // 先同步非当前任务的 pending 占位符，避免历史已完成但生成区仍显示“生成中”
  if (generateStore.images.length > 0) {
    const pendingTaskIds = new Set(
      generateStore.images
        .filter((img) => img.taskId && img.status !== 'failed' && (img.status === 'pending' || !img.url))
        .map((img) => img.taskId)
    );

    if (currentTaskId) pendingTaskIds.delete(currentTaskId);

    pendingTaskIds.forEach((taskId) => {
      const historyItem = historyMap.get(taskId);
      if (!historyItem) return;

      const shouldRemovePending = historyItem.status !== 'processing' && historyItem.status !== 'pending';
      generateStore.mergeImagesForTask(taskId, historyItem.images || [], { removePending: shouldRemovePending });
    });
  }

  // 如果本地没有任务ID，直接返回
  if (!currentTaskId) {
    return;
  }

  // 在历史记录中查找当前任务
  const currentTaskInHistory = historyMap.get(currentTaskId);

  if (!currentTaskInHistory) {
    return;
  }

  // 找到了任务，对比状态
  const historyStatus = currentTaskInHistory.status;

  // 如果历史记录中任务不是 processing 状态，清空本地状态
  if (historyStatus !== 'processing' && currentStatus === 'processing') {
    console.log(`Task status mismatch: local=${currentStatus}, history=${historyStatus}, clearing local state`);

    if (historyStatus === 'completed') {
      generateStore.clearTaskState();
      // 任务已完成，不显示提示（避免打扰）
    } else if (historyStatus === 'failed') {
      generateStore.clearTaskState();
      // 任务失败，显示提示
      toast.error(`生成任务失败：${currentTaskInHistory.errorMessage || '未知错误'}`);
    } else if (historyStatus === 'partial') {
      generateStore.clearTaskState();
      // 部分完成
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
