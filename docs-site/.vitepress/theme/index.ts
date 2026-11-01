// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// CyberNova2333 docs theme（富化版）。
// 继承 VitePress 默认主题；Layout 注入装饰层；本地 Anime.js（ESM 构建）驱动
// 入场 / 滚动显现 / 环境漂浮 / 昼夜场景开关。不改动后端与构建功能；
// 动画库缺席时文档照常可读（CSS 不预隐藏任何内容）。
import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import Layout from './Layout.vue';
import './style.css';

const theme: Theme = {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ router }) {
    if (typeof window === 'undefined') return;
    // 本地打包的 Anime.js（ESM，无 CDN）。加载失败不影响文档功能。
    // 昼夜开关不依赖动画库：即使库加载失败也能显示与切换
    import('./toggle').then((t) => t.setupAppearanceToggle()).catch(() => {});
    import('./vendor/animejs/anime.esm.min.js')
      .then((anime) => {
        (window as any).anime = anime;
        return import('./motion');
      })
      .then((m) => m.setupDocsMotion(router))
      .catch(() => {});
  },
};

export default theme;
