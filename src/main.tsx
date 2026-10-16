import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles.css'

// A tapped notification normally moves this page to its task through the
// service worker; a page opened before the worker took over cannot be moved
// that way, so the worker asks it to go there itself (see sw.js).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data as { type?: string; url?: string } | null
    if (data?.type !== 'open-url' || typeof data.url !== 'string') return
    const target = new URL(data.url, window.location.href)
    if (target.origin !== window.location.origin || !target.pathname.startsWith(import.meta.env.BASE_URL)) return
    window.location.assign(target.href)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
