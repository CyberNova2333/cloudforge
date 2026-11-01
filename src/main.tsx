/* Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). */
import React from 'react';
import ReactDOM from 'react-dom/client';
// Styles, in cascade order: Primer and the existing page styles, the self-hosted fonts, then the design system.
import './index.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles/index.css';
// Registers <agent-robot-avatar> (bundled, never from a CDN).
import 'agent-robot-avatar';
import App from './App';
import { ThemeProvider } from './components/shell/ThemeProvider';
import { ToastProvider } from './components/ui/Toast';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>
);
