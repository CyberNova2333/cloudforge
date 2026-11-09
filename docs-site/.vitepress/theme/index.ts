// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import Layout from './Layout.vue';
import {
  checkAndApplyLanguageRedirect,
  setupLanguageSwitcherListener,
} from './i18n';
import './style.css';

const theme: Theme = {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ router, siteData }) {
    if (typeof window === 'undefined') return;
    setupLanguageSwitcherListener();
    checkAndApplyLanguageRedirect(siteData.value?.base || '/');

    // 动效加载失败时仍保留完整的阅读与外观切换功能。
    void import('./toggle')
      .then(({ setupAppearanceToggle }) => setupAppearanceToggle())
      .catch(() => undefined);
    void Promise.all([
      import('./vendor/animejs/anime.esm.min.js'),
      import('./motion'),
    ])
      .then(([anime, { setupDocsMotion }]) => setupDocsMotion(router, anime))
      .catch(() => undefined);
  },
};

export default theme;
