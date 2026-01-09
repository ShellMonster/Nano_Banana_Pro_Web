import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface ConfigState {
  // 生图配置
  imageProvider: string;
  imageApiBaseUrl: string;
  imageApiKey: string;
  imageModel: string;

  // 对话配置
  chatApiBaseUrl: string;
  chatApiKey: string;
  chatModel: string;
  
  prompt: string;
  count: number;
  imageSize: string;
  aspectRatio: string;
  refFiles: File[];

  setImageProvider: (provider: string) => void;
  setImageApiBaseUrl: (url: string) => void;
  setImageApiKey: (key: string) => void;
  setImageModel: (model: string) => void;
  setChatApiBaseUrl: (url: string) => void;
  setChatApiKey: (key: string) => void;
  setChatModel: (model: string) => void;
  setPrompt: (prompt: string) => void;
  setCount: (count: number) => void;
  setImageSize: (size: string) => void;
  setAspectRatio: (ratio: string) => void;
  addRefFiles: (files: File[]) => void;
  removeRefFile: (index: number) => void;
  clearRefFiles: () => void;

  reset: () => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      imageProvider: 'gemini',
      imageApiBaseUrl: 'https://generativelanguage.googleapis.com',
      imageApiKey: '',
      imageModel: 'gemini-3-pro-image-preview',
      chatApiBaseUrl: 'https://api.openai.com/v1',
      chatApiKey: '',
      chatModel: 'gemini-3-flash-preview',
      prompt: '',
      count: 1,
      imageSize: '2K',
      aspectRatio: '1:1',
      refFiles: [],

      setImageProvider: (imageProvider) => set({ imageProvider }),
      setImageApiBaseUrl: (imageApiBaseUrl) => set({ imageApiBaseUrl }),
      setImageApiKey: (imageApiKey) => set({ imageApiKey }),
      setImageModel: (imageModel) => set({ imageModel }),
      setChatApiBaseUrl: (chatApiBaseUrl) => set({ chatApiBaseUrl }),
      setChatApiKey: (chatApiKey) => set({ chatApiKey }),
      setChatModel: (chatModel) => set({ chatModel }),
      setPrompt: (prompt) => set({ prompt }),
      setCount: (count) => set({ count }),
      setImageSize: (imageSize) => set({ imageSize }),
      setAspectRatio: (aspectRatio) => set({ aspectRatio }),

      addRefFiles: (files) => set((state) => ({
          // 限制最多 10 张
          refFiles: [...state.refFiles, ...files].slice(0, 10)
      })),

      removeRefFile: (index) => set((state) => ({
          refFiles: state.refFiles.filter((_, i) => i !== index)
      })),

      clearRefFiles: () => set({ refFiles: [] }),

      reset: () => set({
        imageApiBaseUrl: 'https://generativelanguage.googleapis.com',
        imageModel: 'gemini-3-pro-image-preview',
        chatApiBaseUrl: 'https://api.openai.com/v1',
        chatModel: 'gemini-3-flash-preview',
        prompt: '',
        count: 1,
        imageSize: '2K',
        aspectRatio: '1:1',
        refFiles: [],
      })
    }),
    {
      name: 'app-config-storage',
      storage: createJSONStorage(() => localStorage),
      version: 3,
      // 关键：不要将 File 对象序列化到 localStorage（File 对象无法序列化）
      partialize: (state) => {
          const { refFiles, ...rest } = state;
          return rest;
      },
      migrate: (persistedState, version) => {
        const state = persistedState as any;
        let next = state;
        if (version < 2) {
          next = {
            ...state,
            imageProvider: state.imageProvider ?? state.provider ?? 'gemini',
            imageApiBaseUrl: state.imageApiBaseUrl ?? state.apiBaseUrl ?? 'https://generativelanguage.googleapis.com',
            imageApiKey: state.imageApiKey ?? state.apiKey ?? '',
            imageModel: state.imageModel ?? state.model ?? 'gemini-3-pro-image-preview',
            chatApiBaseUrl: state.chatApiBaseUrl ?? 'https://api.openai.com/v1',
            chatApiKey: state.chatApiKey ?? '',
            chatModel: state.chatModel ?? state.textModel ?? '',
          };
        }
        if (version < 3) {
          const chatKey = String(next.chatApiKey ?? '').trim();
          const chatModel = String(next.chatModel ?? '').trim();
          const shouldDefault = !chatKey && (chatModel === '' || chatModel === 'gpt-4o-mini');
          if (shouldDefault) {
            next = { ...next, chatModel: 'gemini-3-flash-preview' };
          }
        }
        return next;
      },
    }
  )
);
