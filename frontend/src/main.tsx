import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { initI18n } from './i18n'
import { useConfigStore } from './store/configStore'

const mountApp = () => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

const bootstrap = async () => {
  const language = await initI18n()
  const { language: storedLanguage, languageResolved, setLanguage, setLanguageResolved } = useConfigStore.getState()
  const hasStoredLanguage = typeof storedLanguage === 'string' && storedLanguage.trim().length > 0
  if (!hasStoredLanguage) {
    setLanguage('system')
    setLanguageResolved(language)
  } else if (storedLanguage === 'system' && !languageResolved) {
    setLanguageResolved(language)
  }
  mountApp()
}

void bootstrap()
