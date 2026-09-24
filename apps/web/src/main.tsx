import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import './index.css';
import './i18n';
import { router } from './router';
import { ThemeProvider } from './providers/ThemeProvider';
import { QueryProvider } from './providers/QueryProvider';
import { ToastProvider } from './providers/ToastProvider';
import { AuthProvider } from './providers/AuthProvider';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <HelmetProvider>
        <QueryProvider>
          <ToastProvider>
            <AuthProvider><RouterProvider router={router} /></AuthProvider>
          </ToastProvider>
        </QueryProvider>
      </HelmetProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
