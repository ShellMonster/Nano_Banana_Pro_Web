import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MainLayout from './components/Layout/MainLayout';
import { ToastContainer } from './components/common/Toast';
import { UpdaterModal } from './components/common/UpdaterModal';
import i18n from './i18n';
import { useConfigStore } from './store/configStore';
import { useGenerateStore } from './store/generateStore';

const queryClient = new QueryClient();

function App() {
  const language = useConfigStore((s) => s.language);
  const generateStatus = useGenerateStore((s) => s.status);
  const isSubmitting = useGenerateStore((s) => s.isSubmitting);

  useEffect(() => {
    if (!language) return;
    if (i18n.language !== language) {
      void i18n.changeLanguage(language);
    }
  }, [language]);

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
    <QueryClientProvider client={queryClient}>
      <MainLayout />
      <UpdaterModal />
      <ToastContainer />
    </QueryClientProvider>
  );
}

export default App;
