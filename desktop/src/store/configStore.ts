import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PersistedRefImage } from '../types';

const IMAGE_MODELS = {
  FLASH: { value: 'gemini-3.1-flash-image-preview', label: 'Flash' },
  PRO: { value: 'gemini-3-pro-image-preview', label: 'Pro' },
} as const;

const OPENAI_IMAGE_MODELS = {
  GPT_IMAGE_1: { value: 'gpt-image-2-all', label: 'GPT Image 2 All' },
  GPT_IMAGE_2: { value: 'gpt-image-2', label: 'GPT Image 2' },
} as const;

export const OPENAI_IMAGE_SIZE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: '1024x1024', label: '1024 x 1024' },
  { value: '1024x1536', label: '1024 x 1536' },
  { value: '1536x1024', label: '1536 x 1024' }
] as const;

export const OPENAI_IMAGE_QUALITY_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' }
] as const;

// Model options for the dropdown selectors
export const GEMINI_IMAGE_MODEL_OPTIONS = [
  { value: IMAGE_MODELS.FLASH.value, label: `${IMAGE_MODELS.FLASH.label} (${IMAGE_MODELS.FLASH.value})` },
  { value: IMAGE_MODELS.PRO.value, label: `${IMAGE_MODELS.PRO.label} (${IMAGE_MODELS.PRO.value})` },
] as const;

export const OPENAI_IMAGE_MODEL_OPTIONS = [
  { value: OPENAI_IMAGE_MODELS.GPT_IMAGE_1.value, label: `${OPENAI_IMAGE_MODELS.GPT_IMAGE_1.label} (${OPENAI_IMAGE_MODELS.GPT_IMAGE_1.value})` },
  { value: OPENAI_IMAGE_MODELS.GPT_IMAGE_2.value, label: `${OPENAI_IMAGE_MODELS.GPT_IMAGE_2.label} (${OPENAI_IMAGE_MODELS.GPT_IMAGE_2.value})` },
] as const;

export const IMAGE_MODEL_OPTIONS = GEMINI_IMAGE_MODEL_OPTIONS;

export const getImageModelOptions = (provider: string) => (
  provider === 'openai-image' ? OPENAI_IMAGE_MODEL_OPTIONS : GEMINI_IMAGE_MODEL_OPTIONS
);

export const getDefaultImageModelForProvider = (provider: string) => {
  const options = getImageModelOptions(provider);
  return options[0].value;
};

const normalizeImageModelForProvider = (provider: string, rawModel: unknown) => {
  const model = typeof rawModel === 'string' ? rawModel.trim() : '';
  const options = getImageModelOptions(provider);
  const isValid = options.some((option) => option.value === model);
  return isValid ? model : getDefaultImageModelForProvider(provider);
};

// 默认生图模型名称
export const DEFAULT_IMAGE_MODEL = getDefaultImageModelForProvider('gemini');

export const VISION_MODEL_OPTIONS = [
  { value: 'gemini-3-flash-preview', label: 'Flash (gemini-3-flash-preview)' },
] as const;

export const CUSTOM_MODEL_VALUE = '__custom__';

// Model configuration with supported aspect ratios
export const IMAGE_MODEL_CONFIG: Record<string, { aspectRatios: string[] }> = {
  [IMAGE_MODELS.FLASH.value]: {
    aspectRatios: ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9']
  },
  [IMAGE_MODELS.PRO.value]: {
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
  },
  [OPENAI_IMAGE_MODELS.GPT_IMAGE_1.value]: {
    aspectRatios: ['auto', '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9']
  },
  [OPENAI_IMAGE_MODELS.GPT_IMAGE_2.value]: {
    aspectRatios: ['auto', '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9']
  }
};

export const isUsingDynamicOpenAIImageSize = (provider: string, model?: string): boolean => (
  provider === 'openai-image' && String(model || '').toLowerCase().includes('gpt-image-2')
);
export const isReferenceImageSupported = (_provider: string): boolean => true;
export const isUsingNativeImageSize = (provider: string, model?: string): boolean => (
  provider === 'openai-image' && !isUsingDynamicOpenAIImageSize(provider, model)
);
export const isQualityControlSupported = (provider: string): boolean => provider === 'openai-image';

// Helper function to get supported aspect ratios for a model
export const getModelAspectRatios = (model: string): string[] => {
  const ratios = IMAGE_MODEL_CONFIG[model]?.aspectRatios;
  return (ratios && ratios.length > 0) ? ratios : ['1:1'];
};

interface ConfigState {
  // 生图配置
  imageProvider: string;
  imageApiBaseUrl: string;
  imageApiKey: string;
  imageModel: string;
  imageTimeoutSeconds: number;
  imageMaxRetries: number;
  enableRefImageCompression: boolean;

  // 识图配置（逆向提示词用）
  visionProvider: string;
  visionApiBaseUrl: string;
  visionApiKey: string;
  visionModel: string;
  visionTimeoutSeconds: number;
  visionMaxRetries: number;
  visionSyncedConfig: {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    timeoutSeconds: number;
  } | null;

  // 对话配置
  chatProvider: string;
  chatApiBaseUrl: string;
  chatApiKey: string;
  chatModel: string;
  chatTimeoutSeconds: number;
  chatMaxRetries: number;
  chatSyncedConfig: {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    timeoutSeconds: number;
  } | null;
  defaultPromptOptimizeMode: 'off' | 'text' | 'json';
  enableSystemNotifications: boolean;
  notifyOnlyWhenBackground: boolean;
  notifyOnFailure: boolean;

  language: string;
  languageResolved: string | null;

  // 新手引导
  showOnboarding: boolean;  // 是否在下次启动时显示引导

  prompt: string;
  count: number;
  imageSize: string;
  aspectRatio: string;
  imageNativeSize: string;
  imageQuality: string;
  refFiles: File[];
  refImageEntries: PersistedRefImage[];

  setImageProvider: (provider: string) => void;
  setImageApiBaseUrl: (url: string) => void;
  setImageApiKey: (key: string) => void;
  setImageModel: (model: string) => void;
  setImageTimeoutSeconds: (seconds: number) => void;
  setImageMaxRetries: (count: number) => void;
  setEnableRefImageCompression: (enabled: boolean) => void;
  setVisionProvider: (provider: string) => void;
  setVisionApiBaseUrl: (url: string) => void;
  setVisionApiKey: (key: string) => void;
  setVisionModel: (model: string) => void;
  setVisionTimeoutSeconds: (seconds: number) => void;
  setVisionMaxRetries: (count: number) => void;
  setVisionSyncedConfig: (config: { apiBaseUrl: string; apiKey: string; model: string; timeoutSeconds: number } | null) => void;
  setChatProvider: (provider: string) => void;
  setChatApiBaseUrl: (url: string) => void;
  setChatApiKey: (key: string) => void;
  setChatModel: (model: string) => void;
  setChatTimeoutSeconds: (seconds: number) => void;
  setChatMaxRetries: (count: number) => void;
  setChatSyncedConfig: (config: { apiBaseUrl: string; apiKey: string; model: string; timeoutSeconds: number } | null) => void;
  setDefaultPromptOptimizeMode: (mode: 'off' | 'text' | 'json') => void;
  setEnableSystemNotifications: (enabled: boolean) => void;
  setNotifyOnlyWhenBackground: (enabled: boolean) => void;
  setNotifyOnFailure: (enabled: boolean) => void;
  setLanguage: (language: string) => void;
  setLanguageResolved: (languageResolved: string | null) => void;
  setShowOnboarding: (show: boolean) => void;
  setPrompt: (prompt: string) => void;
  setCount: (count: number) => void;
  setImageSize: (size: string) => void;
  setAspectRatio: (ratio: string) => void;
  setImageNativeSize: (size: string) => void;
  setImageQuality: (quality: string) => void;
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
      imageModel: DEFAULT_IMAGE_MODEL,
      imageTimeoutSeconds: 500,
      imageMaxRetries: 1,
      enableRefImageCompression: true,
      visionProvider: 'gemini-chat',
      visionApiBaseUrl: '',
      visionApiKey: '',
      visionModel: 'gemini-3-flash-preview',
      visionTimeoutSeconds: 150,
      visionMaxRetries: 1,
      visionSyncedConfig: null,
      chatProvider: 'openai-chat',
      chatApiBaseUrl: 'https://api.openai.com/v1',
      chatApiKey: '',
      chatModel: 'gemini-3-flash-preview',
      chatTimeoutSeconds: 150,
      chatMaxRetries: 1,
      chatSyncedConfig: null,
      defaultPromptOptimizeMode: 'off',
      enableSystemNotifications: true,
      notifyOnlyWhenBackground: true,
      notifyOnFailure: true,
      language: 'system',
      languageResolved: null,
      showOnboarding: true,  // 首次启动默认显示引导
      prompt: '',
      count: 1,
      imageSize: '2K',
      aspectRatio: '1:1',
      imageNativeSize: 'auto',
      imageQuality: 'auto',
      refFiles: [],
      refImageEntries: [],

      setImageProvider: (imageProvider) => set({ imageProvider }),
      setImageApiBaseUrl: (imageApiBaseUrl) => set({ imageApiBaseUrl }),
      setImageApiKey: (imageApiKey) => set({ imageApiKey }),
      setImageModel: (imageModel) => set({ imageModel }),
      setImageTimeoutSeconds: (imageTimeoutSeconds) => set({ imageTimeoutSeconds }),
      setImageMaxRetries: (imageMaxRetries) => set({ imageMaxRetries }),
      setEnableRefImageCompression: (enableRefImageCompression) => set({ enableRefImageCompression }),
      setVisionProvider: (visionProvider) => set({ visionProvider }),
      setVisionApiBaseUrl: (visionApiBaseUrl) => set({ visionApiBaseUrl }),
      setVisionApiKey: (visionApiKey) => set({ visionApiKey }),
      setVisionModel: (visionModel) => set({ visionModel }),
      setVisionTimeoutSeconds: (visionTimeoutSeconds) => set({ visionTimeoutSeconds }),
      setVisionMaxRetries: (visionMaxRetries) => set({ visionMaxRetries }),
      setVisionSyncedConfig: (visionSyncedConfig) => set({ visionSyncedConfig }),
      setChatProvider: (chatProvider) => set({ chatProvider }),
      setChatApiBaseUrl: (chatApiBaseUrl) => set({ chatApiBaseUrl }),
      setChatApiKey: (chatApiKey) => set({ chatApiKey }),
      setChatModel: (chatModel) => set({ chatModel }),
      setChatTimeoutSeconds: (chatTimeoutSeconds) => set({ chatTimeoutSeconds }),
      setChatMaxRetries: (chatMaxRetries) => set({ chatMaxRetries }),
      setChatSyncedConfig: (chatSyncedConfig) => set({ chatSyncedConfig }),
      setDefaultPromptOptimizeMode: (defaultPromptOptimizeMode) => set({ defaultPromptOptimizeMode }),
      setEnableSystemNotifications: (enableSystemNotifications) => set({ enableSystemNotifications }),
      setNotifyOnlyWhenBackground: (notifyOnlyWhenBackground) => set({ notifyOnlyWhenBackground }),
      setNotifyOnFailure: (notifyOnFailure) => set({ notifyOnFailure }),
      setLanguage: (language) => set({ language }),
      setLanguageResolved: (languageResolved) => set({ languageResolved }),
      setShowOnboarding: (showOnboarding) => set({ showOnboarding }),
      setPrompt: (prompt) => set({ prompt }),
      setCount: (count) => set({ count }),
      setImageSize: (imageSize) => set({ imageSize }),
      setAspectRatio: (aspectRatio) => set({ aspectRatio }),
      setImageNativeSize: (imageNativeSize) => set({ imageNativeSize }),
      setImageQuality: (imageQuality) => set({ imageQuality }),
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
        imageModel: DEFAULT_IMAGE_MODEL,
        imageTimeoutSeconds: 500,
        imageMaxRetries: 1,
        enableRefImageCompression: true,
        visionProvider: 'gemini-chat',
        visionApiBaseUrl: '',
        visionApiKey: '',
        visionModel: 'gemini-3-flash-preview',
        visionTimeoutSeconds: 150,
        visionMaxRetries: 1,
        visionSyncedConfig: null,
        chatProvider: 'openai-chat',
        chatApiBaseUrl: 'https://api.openai.com/v1',
        chatModel: 'gemini-3-flash-preview',
        chatTimeoutSeconds: 150,
        chatMaxRetries: 1,
        chatSyncedConfig: null,
        defaultPromptOptimizeMode: 'off',
        enableSystemNotifications: true,
        notifyOnlyWhenBackground: true,
        notifyOnFailure: true,
        prompt: '',
        count: 1,
        imageSize: '2K',
        aspectRatio: '1:1',
        imageNativeSize: 'auto',
        imageQuality: 'auto',
        refFiles: [],
        refImageEntries: [],
      })
    }),
    {
      name: 'app-config-storage',
      storage: createJSONStorage(() => localStorage),
      version: 19,
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
            imageModel: state.imageModel ?? state.model ?? DEFAULT_IMAGE_MODEL,
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
        if (version < 9) {
          next = {
            ...next,
            imageTimeoutSeconds: next.imageTimeoutSeconds ?? 500,
            chatTimeoutSeconds: next.chatTimeoutSeconds ?? 150
          };
          if (next.chatSyncedConfig && next.chatSyncedConfig.timeoutSeconds == null) {
            next = {
              ...next,
              chatSyncedConfig: {
                ...next.chatSyncedConfig,
                timeoutSeconds: next.chatTimeoutSeconds ?? 150
              }
            };
          }
        }
        // 版本 10: 添加识图配置，默认继承生图配置
        if (version < 10) {
          next = {
            ...next,
            visionProvider: 'gemini-chat',
            visionApiBaseUrl: next.imageApiBaseUrl ?? '',
            visionApiKey: next.imageApiKey ?? '',
            visionModel: 'gemini-3-flash-preview',
            visionTimeoutSeconds: 150,
            visionSyncedConfig: null
          };
        }
        // 版本 11: 添加新手引导开关，首次启动默认显示
        if (version < 11) {
          next = {
            ...next,
            showOnboarding: true
          };
        }
        if (version < 13) {
          next = {
            ...next,
            imageMaxRetries: next.imageMaxRetries ?? 1,
            visionMaxRetries: next.visionMaxRetries ?? 1,
            chatMaxRetries: next.chatMaxRetries ?? 1
          };
        }
        if (version < 15) {
          next = {
            ...next,
            enableSystemNotifications: next.enableSystemNotifications ?? true,
            notifyOnlyWhenBackground: next.notifyOnlyWhenBackground ?? true,
            notifyOnFailure: next.notifyOnFailure ?? true
          };
        }
        if (version < 17) {
          next = {
            ...next,
            imageModel: next.imageModel ?? DEFAULT_IMAGE_MODEL
          };
        }
        if (version < 18) {
          next = {
            ...next,
            imageNativeSize: next.imageNativeSize ?? 'auto',
            imageQuality: next.imageQuality ?? 'auto'
          };
        }
        if (version < 19) {
          const imageProvider = String(next.imageProvider ?? 'gemini').trim() || 'gemini';
          const imageNativeSize = typeof next.imageNativeSize === 'string' && next.imageNativeSize.trim()
            ? next.imageNativeSize.trim()
            : 'auto';
          const imageQuality = typeof next.imageQuality === 'string' && next.imageQuality.trim()
            ? next.imageQuality.trim()
            : 'auto';

          next = {
            ...next,
            imageProvider,
            imageModel: normalizeImageModelForProvider(imageProvider, next.imageModel),
            imageNativeSize,
            imageQuality
          };
        }

        return next;
      },
    }
  )
);
