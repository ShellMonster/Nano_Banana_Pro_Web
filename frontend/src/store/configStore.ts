import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PersistedRefImage } from '../types';

interface ConfigState {
  // 生图配置
  imageProvider: string;
  imageApiBaseUrl: string;
  imageApiKey: string;
  imageModel: string;

  // 对话配置
  chatProvider: string;
  chatApiBaseUrl: string;
  chatApiKey: string;
  chatModel: string;
  chatSyncedConfig: {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
  } | null;

  language: string;
  languageResolved: string | null;
  
  prompt: string;
  count: number;
  imageSize: string;
  aspectRatio: string;
  refFiles: File[];
  refImageEntries: PersistedRefImage[];

  setImageProvider: (provider: string) => void;
  setImageApiBaseUrl: (url: string) => void;
  setImageApiKey: (key: string) => void;
  setImageModel: (model: string) => void;
  setChatProvider: (provider: string) => void;
  setChatApiBaseUrl: (url: string) => void;
  setChatApiKey: (key: string) => void;
  setChatModel: (model: string) => void;
  setChatSyncedConfig: (config: { apiBaseUrl: string; apiKey: string; model: string } | null) => void;
  setLanguage: (language: string) => void;
  setLanguageResolved: (languageResolved: string | null) => void;
  setPrompt: (prompt: string) => void;
  setCount: (count: number) => void;
  setImageSize: (size: string) => void;
  setAspectRatio: (ratio: string) => void;
  setRefFiles: (files: File[]) => void;
  addRefFiles: (files: File[]) => void;
  removeRefFile: (index: number) => void;
  clearRefFiles: () => void;
  setRefImageEntries: (entries: PersistedRefImage[]) => void;

  reset: () => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      imageProvider: 'gemini',
      imageApiBaseUrl: 'https://generativelanguage.googleapis.com',
      imageApiKey: '',
      imageModel: 'gemini-3-pro-image-preview',
      chatProvider: 'openai-chat',
      chatApiBaseUrl: 'https://api.openai.com/v1',
      chatApiKey: '',
      chatModel: 'gemini-3-flash-preview',
      chatSyncedConfig: null,
      language: 'system',
      languageResolved: null,
      prompt: '',
      count: 1,
      imageSize: '2K',
      aspectRatio: '1:1',
      refFiles: [],
      refImageEntries: [],

      setImageProvider: (imageProvider) => set({ imageProvider }),
      setImageApiBaseUrl: (imageApiBaseUrl) => set({ imageApiBaseUrl }),
      setImageApiKey: (imageApiKey) => set({ imageApiKey }),
      setImageModel: (imageModel) => set({ imageModel }),
      setChatProvider: (chatProvider) => set({ chatProvider }),
      setChatApiBaseUrl: (chatApiBaseUrl) => set({ chatApiBaseUrl }),
      setChatApiKey: (chatApiKey) => set({ chatApiKey }),
      setChatModel: (chatModel) => set({ chatModel }),
      setChatSyncedConfig: (chatSyncedConfig) => set({ chatSyncedConfig }),
      setLanguage: (language) => set({ language }),
      setLanguageResolved: (languageResolved) => set({ languageResolved }),
      setPrompt: (prompt) => set({ prompt }),
      setCount: (count) => set({ count }),
      setImageSize: (imageSize) => set({ imageSize }),
      setAspectRatio: (aspectRatio) => set({ aspectRatio }),
      setRefFiles: (refFiles) => set({ refFiles }),
      setRefImageEntries: (refImageEntries) => set({ refImageEntries }),

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
        chatProvider: 'openai-chat',
        chatApiBaseUrl: 'https://api.openai.com/v1',
        chatModel: 'gemini-3-flash-preview',
        chatSyncedConfig: null,
        prompt: '',
        count: 1,
        imageSize: '2K',
        aspectRatio: '1:1',
        refFiles: [],
        refImageEntries: [],
      })
    }),
    {
      name: 'app-config-storage',
      storage: createJSONStorage(() => localStorage),
      version: 8,
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
        if (version < 4) {
          next = { ...next, chatSyncedConfig: next.chatSyncedConfig ?? null };
        }
        if (version < 5) {
          const base = String(next.chatApiBaseUrl ?? '').toLowerCase();
          const model = String(next.chatModel ?? '').toLowerCase();
          const inferred = base.includes('generativelanguage') || model.startsWith('gemini')
            ? 'gemini-chat'
            : 'openai-chat';
          next = { ...next, chatProvider: next.chatProvider ?? inferred };
        }
        if (version < 6) {
          next = { ...next, refImageEntries: next.refImageEntries ?? [] };
        }
        if (version < 7) {
          next = { ...next, language: next.language ?? '' };
        }
        if (version < 8) {
          const rawLanguage = typeof next.language === 'string' ? next.language.trim() : '';
          next = {
            ...next,
            language: rawLanguage ? next.language : 'system',
            languageResolved: next.languageResolved ?? null
          };
        }
        return next;
      },
    }
  )
);
