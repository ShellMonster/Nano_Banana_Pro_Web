import { create } from 'zustand';

interface PromptHistoryState {
  history: string[];
  index: number;
  record: (value: string) => void;
  undo: () => string | null;
  redo: () => string | null;
  reset: (value?: string) => void;
}

export const usePromptHistoryStore = create<PromptHistoryState>((set, get) => ({
  history: [''],
  index: 0,
  record: (value) => set((state) => {
    const trimmed = value ?? '';
    const current = state.history[state.index] ?? '';
    if (trimmed === current) return state;

    const nextHistory = state.history.slice(0, state.index + 1);
    nextHistory.push(trimmed);
    return { history: nextHistory, index: nextHistory.length - 1 };
  }),
  undo: () => {
    const { history, index } = get();
    if (index <= 0) return null;
    const nextIndex = index - 1;
    set({ index: nextIndex });
    return history[nextIndex] ?? '';
  },
  redo: () => {
    const { history, index } = get();
    if (index >= history.length - 1) return null;
    const nextIndex = index + 1;
    set({ index: nextIndex });
    return history[nextIndex] ?? '';
  },
  reset: (value) => {
    const next = value ?? '';
    set({ history: [next], index: 0 });
  }
}));
