import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import MainLayout from './components/Layout/MainLayout';
import { ToastContainer } from './components/common/Toast';
import i18n from './i18n';
import { useConfigStore } from './store/configStore';

const queryClient = new QueryClient();

function App() {
  const language = useConfigStore((s) => s.language);

  useEffect(() => {
    if (!language) return;
    if (i18n.language !== language) {
      void i18n.changeLanguage(language);
    }
  }, [language]);

  return (
    <QueryClientProvider client={queryClient}>
      <MainLayout />
      <ToastContainer />
    </QueryClientProvider>
  );
}

export default App;
