import { create } from 'zustand';

export interface InternalDragPayload {
  id: string;
  name?: string;
  url?: string;
  thumbnailUrl?: string;
  path?: string;
  filePath?: string;
  thumbnailPath?: string;
  getBlob?: () => Promise<Blob | null>;
}

interface InternalDragState {
  isActive: boolean;
  isDragging: boolean;
  activePointerId: number | null;
  startX: number;
  startY: number;
  x: number;
  y: number;
  payload: InternalDragPayload | null;
  dropTarget: HTMLElement | null;
  isOverDropTarget: boolean;
  dropCounter: number;
  droppedPayload: InternalDragPayload | null;
  lastDragEndAt: number;
  startDrag: (payload: InternalDragPayload, pointerId: number, x: number, y: number) => void;
  updatePosition: (x: number, y: number) => void;
  setDragging: (value: boolean) => void;
  endDrag: () => void;
  setDropTarget: (el: HTMLElement | null) => void;
  setOverDropTarget: (value: boolean) => void;
  triggerDrop: (payload: InternalDragPayload) => void;
  clearDrop: () => void;
}

export const useInternalDragStore = create<InternalDragState>((set, get) => ({
  isActive: false,
  isDragging: false,
  activePointerId: null,
  startX: 0,
  startY: 0,
  x: 0,
  y: 0,
  payload: null,
  dropTarget: null,
  isOverDropTarget: false,
  dropCounter: 0,
  droppedPayload: null,
  lastDragEndAt: 0,

  startDrag: (payload, pointerId, x, y) =>
    set({
      isActive: true,
      isDragging: false,
      activePointerId: pointerId,
      startX: x,
      startY: y,
      x,
      y,
      payload,
      isOverDropTarget: false,
    }),
  updatePosition: (x, y) => set({ x, y }),
  setDragging: (value) => set({ isDragging: value }),
  endDrag: () => {
    const { isDragging } = get();
    set({
      isActive: false,
      isDragging: false,
      activePointerId: null,
      payload: null,
      isOverDropTarget: false,
      lastDragEndAt: isDragging ? Date.now() : get().lastDragEndAt,
    });
  },
  setDropTarget: (el) => set({ dropTarget: el }),
  setOverDropTarget: (value) => set({ isOverDropTarget: value }),
  triggerDrop: (payload) =>
    set((state) => ({
      droppedPayload: payload,
      dropCounter: state.dropCounter + 1,
    })),
  clearDrop: () => set({ droppedPayload: null }),
}));
