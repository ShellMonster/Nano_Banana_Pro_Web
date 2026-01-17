import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';
import jaJP from './locales/ja-JP.json';
import koKR from './locales/ko-KR.json';
import { getSystemLocale } from './systemLocale';

export const SUPPORTED_LANGUAGES = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'zh-CN';

const normalizeLanguage = (lang?: string | null): SupportedLanguage | null => {
  if (!lang) return null;
  const trimmed = lang.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('ja')) return 'ja-JP';
  if (lower.startsWith('ko')) return 'ko-KR';
  if (lower.startsWith('en')) return 'en-US';
  return 'en-US';
};

type StoredLanguageState = {
  language?: string;
  languageResolved?: string | null;
};

const getStoredLanguageState = (): StoredLanguageState | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem('app-config-storage');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      language: parsed?.state?.language ?? null,
      languageResolved: parsed?.state?.languageResolved ?? null
    };
  } catch {
    return null;
  }
};

const resources = {
  'zh-CN': { translation: zhCN },
  'en-US': { translation: enUS },
  'ja-JP': { translation: jaJP },
  'ko-KR': { translation: koKR }
};

const updateDocumentLanguage = (lang: string) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.title = i18n.t('app.title');
  }

  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(i18n.t('app.title')))
      .catch(() => undefined);
  }
};

export const initI18n = async (): Promise<SupportedLanguage> => {
  if (i18n.isInitialized) {
    updateDocumentLanguage(i18n.language);
    return i18n.language as SupportedLanguage;
  }

  const storedState = getStoredLanguageState();
  const storedLanguage = storedState?.language;
  const storedResolved = normalizeLanguage(storedState?.languageResolved || null);
  let resolved: SupportedLanguage | null = null;

  if (storedLanguage === 'system') {
    resolved = storedResolved;
  } else if (storedLanguage) {
    resolved = normalizeLanguage(storedLanguage);
  } else if (storedResolved) {
    resolved = storedResolved;
  }

  if (!resolved) {
    const systemLocale = await getSystemLocale();
    resolved = normalizeLanguage(systemLocale) || DEFAULT_LANGUAGE;
  }

  await i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: resolved,
      fallbackLng: DEFAULT_LANGUAGE,
      interpolation: { escapeValue: false }
    });

  updateDocumentLanguage(i18n.language);
  i18n.on('languageChanged', updateDocumentLanguage);

  return i18n.language as SupportedLanguage;
};

export default i18n;
