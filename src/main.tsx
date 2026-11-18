import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import './i18n';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './components/ui';
import { applyTheme, storedTheme } from './lib/hooks';

applyTheme(storedTheme());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => count < 2 && !/cs:|JWT|permission/.test((err as Error)?.message ?? ''),
      refetchOnWindowFocus: true,
      networkMode: 'online',
    },
    mutations: { networkMode: 'online', retry: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
