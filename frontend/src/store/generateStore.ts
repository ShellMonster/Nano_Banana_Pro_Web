import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { GeneratedImage } from '../types';
import { getImageUrl } from '../services/api';

type MergeOptions = { removePending?: boolean };

function normalizeIncomingImage(image: GeneratedImage): GeneratedImage {
  const { width, height, ...rest } = image as any;
  const url = getImageUrl(image.url || image.filePath || image.thumbnailPath || image.thumbnailUrl || '');
  const thumbnailUrl = getImageUrl(image.thumbnailUrl || image.thumbnailPath || image.filePath || image.url || '');
  const status: GeneratedImage['status'] = image.status === 'failed'
    ? 'failed'
    : (!url ? 'pending' : (image.status ?? 'success'));

  return {
    ...rest,
    ...(typeof width === 'number' && width > 0 ? { width } : {}),
    ...(typeof height === 'number' && height > 0 ? { height } : {}),
    url,
    thumbnailUrl,
    status
  };
}

function upsertImage(list: GeneratedImage[], image: GeneratedImage, fallbackTaskId?: string) {
  const targetTaskId = image.taskId || fallbackTaskId;
  const imageWithTaskId = targetTaskId ? { ...image, taskId: targetTaskId } : image;

  const existingIndex = list.findIndex((img) => img.id === imageWithTaskId.id);
  if (existingIndex !== -1) {
    list[existingIndex] = { ...list[existingIndex], ...imageWithTaskId };
    return;
  }

  if (targetTaskId) {
    const placeholderIndex = list.findIndex(
      (img) => img.status === 'pending' && img.taskId === targetTaskId
    );
    if (placeholderIndex !== -1) {
      list[placeholderIndex] = { ...list[placeholderIndex], ...imageWithTaskId };
      return;
    }
  }

  list.push(imageWithTaskId);
}

interface GenerateState {
  currentTab: 'generate' | 'history';
  isSidebarOpen: boolean; // 新增：持久化侧边栏状态
  isSubmitting: boolean; // 新增：提交中的状态
  taskId: string | null;
  status: 'idle' | 'processing' | 'completed' | 'failed';
  totalCount: number;
  completedCount: number;
  images: GeneratedImage[];
  selectedIds: Set<string>;
  error: string | null;
  startTime: number | null;
  // 新增：连接模式和最后消息时间
  connectionMode: 'websocket' | 'polling' | 'none';
  lastMessageTime: number | null;

  setTab: (tab: 'generate' | 'history') => void;
  setSidebarOpen: (isOpen: boolean) => void; // 新增 Action
  startTask: (taskId: string, totalCount: number, config: { prompt: string, aspectRatio: string, imageSize: string }) => void;
  updateProgress: (completedCount: number, image?: GeneratedImage | null) => void;
  updateProgressBatch: (completedCount: number, images: GeneratedImage[]) => void;
  completeTask: () => void;
  failTask: (error: string) => void;
  dismissError: () => void;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  clearImages: () => void;
  // 新增：切换连接模式和更新消息时间
  setConnectionMode: (mode: 'websocket' | 'polling' | 'none') => void;
  updateLastMessageTime: () => void;
  setSubmitting: (isSubmitting: boolean) => void;
  mergeImagesForTask: (taskId: string, images: GeneratedImage[], options?: MergeOptions) => void;
  // 新增：恢复任务状态（用于刷新后恢复）
  restoreTaskState: (state: { taskId: string; status: 'processing'; totalCount: number; completedCount: number; images: any[] }) => void;
  clearTaskState: () => void;
}

export const useGenerateStore = create<GenerateState>()(
  persist(
    (set) => ({
      currentTab: 'generate',
      isSidebarOpen: true, // 默认展开
      isSubmitting: false,
      taskId: null,
      status: 'idle',
      totalCount: 0,
      completedCount: 0,
      images: [],
      selectedIds: new Set(),
      error: null,
      startTime: null,
      connectionMode: 'none',
      lastMessageTime: null,

      setTab: (currentTab) => set({ currentTab }),
      setSidebarOpen: (isSidebarOpen) => set({ isSidebarOpen }),
      setSubmitting: (isSubmitting) => set({ isSubmitting }),

      startTask: (taskId, totalCount, config) => {
        const placeholders: GeneratedImage[] = Array.from({ length: totalCount }).map((_, i) => ({
            id: `temp-${Date.now()}-${i}`,
            taskId,
            filePath: '',
            thumbnailPath: '',
            fileSize: 0,
            width: 0,
            height: 0,
            mimeType: '',
            createdAt: new Date().toISOString(),
            status: 'pending' as const,
            prompt: config.prompt,
            url: '',
            options: {
                aspectRatio: config.aspectRatio,
                imageSize: config.imageSize
            }
        }));

        set((state) => ({
            currentTab: 'generate',
            taskId,
            status: 'processing',
            totalCount,
            completedCount: 0,
            // 将新生成的占位符放在最前面，保留之前的生成结果（可选，根据用户习惯调整）
            // 这里我们选择保留之前的，这样用户能看到历史生成的图片
            images: [...placeholders, ...state.images].slice(0, 100), 
            error: null,
            selectedIds: new Set(),
            startTime: Date.now(),
            connectionMode: 'websocket',  // 初始使用 WebSocket
            lastMessageTime: Date.now()
        }));
      },

      updateProgress: (completedCount, image) => set((state) => {
        let newImages = [...state.images];
        if (image) {
            const imageWithUrl = normalizeIncomingImage(image);
            upsertImage(newImages, imageWithUrl, image.taskId || state.taskId || undefined);
        }
        return {
            completedCount,
            images: newImages,
            lastMessageTime: Date.now()  // 更新最后消息时间
        };
      }),

      // 批量更新进度（优化轮询性能，减少重复渲染）
      updateProgressBatch: (completedCount, images) => set((state) => {
        let newImages = [...state.images];

        // 批量处理所有图片
        images.forEach(image => {
          const imageWithUrl = normalizeIncomingImage(image);
          upsertImage(newImages, imageWithUrl, image.taskId || state.taskId || undefined);
        });

        return {
          completedCount,
          images: newImages,
          lastMessageTime: Date.now()
        };
      }),

      mergeImagesForTask: (taskId, images, options) => set((state) => {
        let newImages = [...state.images];
        if (images && images.length > 0) {
          images.forEach((image) => {
            const imageWithUrl = normalizeIncomingImage(image);
            upsertImage(newImages, imageWithUrl, taskId);
          });
        }

        if (options?.removePending) {
          newImages = newImages.filter((img) => !(img.taskId === taskId && img.status === 'pending'));
        }

        const shouldTouchLastMessage = state.taskId === taskId;
        return {
          images: newImages,
          ...(shouldTouchLastMessage ? { lastMessageTime: Date.now() } : {})
        };
      }),

      completeTask: () => set((state) => {
        const finishedTaskId = state.taskId;
        const images = finishedTaskId
          ? state.images.filter((img) => !(img.taskId === finishedTaskId && img.status === 'pending'))
          : state.images;

        return {
          status: 'completed',
          connectionMode: 'none',
          taskId: null,
          startTime: null,
          images
        };
      }),
      failTask: (error) => set((state) => {
        const finishedTaskId = state.taskId;
        const images = finishedTaskId
          ? state.images.filter((img) => !(img.taskId === finishedTaskId && img.status === 'pending'))
          : state.images;

        return {
          status: 'failed',
          error,
          connectionMode: 'none',
          taskId: null,
          startTime: null,
          images
        };
      }),
      dismissError: () => set((state) => ({
        ...state,
        error: null,
        status: state.status === 'failed' ? 'idle' : state.status
      })),
      toggleSelect: (id) => set((state) => {
        const newSelected = new Set(state.selectedIds);
        if (newSelected.has(id)) newSelected.delete(id);
        else newSelected.add(id);
        return { selectedIds: newSelected };
      }),
      selectAll: () => set((state) => ({
        selectedIds: new Set(state.images.filter(img => img.status === 'success').map(img => img.id))
      })),
      clearSelection: () => set({ selectedIds: new Set() }),
      clearImages: () => set({ images: [], completedCount: 0, totalCount: 0, taskId: null, status: 'idle', startTime: null, connectionMode: 'none', lastMessageTime: null }),

      // 新增：设置连接模式
      setConnectionMode: (mode) => set({ connectionMode: mode }),

      // 新增：更新最后消息时间
      updateLastMessageTime: () => set({ lastMessageTime: Date.now() }),

      // 新增：恢复任务状态（用于刷新后恢复）
      restoreTaskState: (taskState) => set((state) => {
        // 优化：检查之前的连接模式，避免不必要的切换
        const shouldUsePolling = state.connectionMode === 'none' ||
                                  state.connectionMode === 'polling' ||
                                  !state.taskId;

        return {
          ...state,
          ...taskState,
          // 恢复图片 URL，保留原始状态（Bug #5修复：不强制设为success）
          images: taskState.images.map((img) => ({
            ...img,
            url: getImageUrl(img.id),
            // 保留图片原始状态，如果是pending则保持pending，轮询会更新它
            status: img.status || 'success' as const
          })),
          // 恢复的任务使用轮询模式，更可靠且避免WebSocket连接错误
          // 但如果之前已经是 websocket 模式且正常，则保持
          connectionMode: shouldUsePolling ? 'polling' : state.connectionMode,
          lastMessageTime: Date.now()
        };
      }),

      // 新增：清空任务状态
      clearTaskState: () => set({
        taskId: null,
        status: 'idle',
        totalCount: 0,
        completedCount: 0,
        images: [],
        error: null,
        startTime: null,
        connectionMode: 'none',
        lastMessageTime: null,
        selectedIds: new Set() // Bug #6修复：清空选中状态
      })
    }),
    {
      name: 'generate-ui-storage',
      storage: createJSONStorage(() => localStorage),
      // 持久化 UI 状态 + 任务 ID（用于刷新后恢复）
      partialize: (state) => ({
          currentTab: state.currentTab,
          isSidebarOpen: state.isSidebarOpen,
          // 只在 processing 时保存任务相关状态，其他情况清空避免状态不一致
          taskId: state.status === 'processing' ? state.taskId : null,
          startTime: state.status === 'processing' ? state.startTime : null,
          status: state.status === 'processing' ? 'processing' : 'idle'
      }),
      // 水合后恢复 selectedIds 为空 Set
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.selectedIds = state.selectedIds || new Set();
          if (state.currentTab !== 'generate' && state.currentTab !== 'history') {
            state.currentTab = 'generate';
          }
        }
      }
    }
  )
);
