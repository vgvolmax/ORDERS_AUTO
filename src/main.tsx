import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './styles/app.css';
import './features/orders/SupplierOrdersDrawer.css';
import './styles/volmax.css';

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
        <strong>«Волмакс Буст» не запустился</strong>
        <p>Скачайте и распакуйте архив ORDERS_AUTO.zip целиком, затем снова откройте index.html.</p>
      </div>
    `;
  }
}

// Production uses a deferred classic IIFE bundle for reliable file:// startup.
// Keep this guard so the same entry also remains safe in the Vite dev workflow.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp, { once: true });
} else {
  mountApp();
}
