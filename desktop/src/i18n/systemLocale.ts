export const getSystemLocale = async (): Promise<string | null> => {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    try {
      const { locale } = await import('@tauri-apps/plugin-os');
      const tauriLocale = await locale();
      if (tauriLocale) return tauriLocale;
    } catch {
      // ignore and fall back
    }
  }

  if (typeof navigator !== 'undefined') {
    return navigator.language || navigator.languages?.[0] || null;
  }

  return null;
};
