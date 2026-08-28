import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './styles/app.css';

function mountApp(): void {
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('Root element was not found');
  }

  try {
    createRoot(root).render(
      <React.StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </React.StrictMode>,
    );
  } catch (error) {
    console.error('ORDERS_AUTO startup failure', error);
    root.innerHTML = `
      <div class="startup-fallback app-failure" role="alert">
        <strong>ORDERS_AUTO не запустился</strong>
        <p>Скачайте свежий ORDERS_AUTO.html и попробуйте открыть его повторно.</p>
      </div>
    `;
  }
}

// The production single-file build is converted from an inline module to a
// classic script so it can run directly from file://. Vite may place that
// script in <head>, where classic scripts execute immediately. Defer mounting
// until the document is parsed so #root exists in both file:// and dev builds.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp, { once: true });
} else {
  mountApp();
}
