import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { initDiagnosticLogger } from './utils/diagnosticLogger'
import { initI18n } from './i18n'
import { useConfigStore } from './store/configStore'

const mountApp = () => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )

  // 移除首屏兜底层（避免白屏闪烁）：
  // 只有在 React 已经渲染出内容后再淡出，避免“先移除兜底 -> 再渲染 UI”的白屏间隙
  ;(() => {
    const boot = document.getElementById('boot');
    const root = document.getElementById('root');
    if (!boot || !root) return;

    const start = performance.now();
    const maxWaitMs = 10_000;

    const tryRemove = () => {
      const hasContent = root.childElementCount > 0;
      const timedOut = performance.now() - start > maxWaitMs;
      if (!hasContent && !timedOut) {
        requestAnimationFrame(tryRemove);
        return;
      }

      boot.style.transition = 'opacity 180ms ease';
      boot.style.opacity = '0';
      window.setTimeout(() => boot.remove(), 200);
    };

    requestAnimationFrame(tryRemove);
  })();
};

const bootstrap = async () => {
  initDiagnosticLogger();
  const language = await initI18n();
  const { language: storedLanguage, languageResolved, setLanguage, setLanguageResolved } = useConfigStore.getState();
  const hasStoredLanguage = typeof storedLanguage === 'string' && storedLanguage.trim().length > 0;
  if (!hasStoredLanguage) {
    setLanguage('system');
    setLanguageResolved(language);
  } else if (storedLanguage === 'system' && !languageResolved) {
    setLanguageResolved(language);
  }
  mountApp();
};

void bootstrap();
