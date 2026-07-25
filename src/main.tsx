import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './settings/fonts'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { applyAppearance } from './settings/settings'
import { useSettingsStore } from './settings/settingsStore'

// Paint the saved theme, accent and fonts before the first render so the page
// never flashes the default light theme on the way to a dark preference.
applyAppearance(useSettingsStore.getState(), document.documentElement)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
