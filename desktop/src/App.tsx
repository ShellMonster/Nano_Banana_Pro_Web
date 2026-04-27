import { useEffect } from 'react';
import MainLayout from './components/Layout/MainLayout';
import { ToastContainer } from './components/common/Toast';
import { UpdaterModal } from './components/common/UpdaterModal';
import { OnboardingTour } from './components/Onboarding/OnboardingTour';
import i18n, { changeAppLanguage } from './i18n';
import { useGenerationNotifications } from './hooks/useGenerationNotifications';
import { useConfigStore } from './store/configStore';
import { useGenerateStore } from './store/generateStore';

function App() {
  const language = useConfigStore((s) => s.language);
  const languageResolved = useConfigStore((s) => s.languageResolved);
  const generateStatus = useGenerateStore((s) => s.status);
  const isSubmitting = useGenerateStore((s) => s.isSubmitting);
  useGenerationNotifications();

  useEffect(() => {
    if (!language) return;
    const nextLanguage = language === 'system' ? languageResolved : language;
    if (!nextLanguage) return;
    if (i18n.language !== nextLanguage) {
      void changeAppLanguage(nextLanguage);
    }
  }, [language, languageResolved]);

  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
    if (!isTauri) return;

    const active = generateStatus === 'processing' || isSubmitting;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_generation_active', { active });
      } catch (error) {
        console.warn('[quit-guard] 同步生成状态失败', error);
      }
    })();
  }, [generateStatus, isSubmitting]);

  return (
    <>
      <MainLayout />
      <OnboardingTour />
      <UpdaterModal />
      <ToastContainer />
    </>
  );
}

export default App;
