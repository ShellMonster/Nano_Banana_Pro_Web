export const getSystemLocale = async (): Promise<string | null> => {
  if (typeof navigator !== 'undefined') {
    return navigator.language || navigator.languages?.[0] || null;
  }
  return null;
};
