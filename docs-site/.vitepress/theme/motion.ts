// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
/* Enterprise 文档站动效（富化版，遵循 animejs-design 指引）：
   时间线入场（重叠偏移）→ IntersectionObserver 滚动显现 → 环境光晕漂浮 loop。
   outQuart 300ms / stagger 48；createScope 管 reduce-motion 与路由清理；
   只用 transform/opacity/clipPath；无 JS 时内容照常可见。 */
import type { Router } from 'vitepress';

export function setupDocsMotion(router: Router) {
  const w = window as any;
  if (!w.anime) return;
  const { animate, createTimeline, createScope, stagger, utils } = w.anime;
  let scope: any;
  let io: IntersectionObserver | null = null;
  let loops: any[] = [];
  let onVis: any = null;

  const q = (s: string, root: ParentNode = document) =>
    Array.from(root.querySelectorAll<HTMLElement>(s));
  const clearInline = (el) => {
    const st = el.style;
    st.removeProperty('transform');
    st.removeProperty('opacity');
    st.removeProperty('clip-path');
  };

  function stopLoops() {
    for (const l of loops) l.pause();
    loops = [];
    if (onVis) {
      document.removeEventListener('visibilitychange', onVis);
      onVis = null;
    }
  }

  function run() {
    scope?.revert?.();
    io?.disconnect();
    io = null;
    stopLoops();
    scope = createScope({
      mediaQueries: { reduced: '(prefers-reduced-motion: reduce)' },
    }).add((self: any) => {
      if (self.matches.reduced) {
        for (const h of q('.vp-doc h2')) h.classList.add('cn-bar-in');
        return;
      }
      document.documentElement.classList.add('motion-on');

      const orbs = q('.cn-deco__orb');
      if (orbs.length) {
        const float = animate(orbs, {
          y: (_el: any, i: number) => [0, i % 2 ? -12 : 10],
          opacity: (_el: any, i: number) => [0.82, 1],
          duration: (_el: any, i: number) => 4600 + i * 1000,
          ease: 'inOutSine',
          loop: true,
          alternate: true,
          autoplay: false,
        });
        loops.push(float);
        const play = () => {
          document.hidden ? float.pause() : float.play();
        };
        onVis = play;
        document.addEventListener('visibilitychange', onVis);
        float.play();
      }

      const tl = createTimeline({
        defaults: { ease: 'outQuart', duration: 300 },
      });
      const nav = q('.VPNavBar');
      const band = q('.cn-deco__band');
      const h1 = q('.vp-doc h1');
      const blocks = q('.vp-doc .content-container > *').slice(0, 12);
      const heroBits = q('.VPHero .main > *').slice(0, 8);
      if (nav.length) tl.add(nav, { opacity: [0, 1], y: [-10, 0] }, 0);
      if (band.length)
        tl.add(band, { scaleX: [0, 1], duration: 700, ease: 'outQuint' }, 60);
      if (h1.length)
        tl.add(
          h1,
          {
            opacity: [0, 1],
            y: [10, 0],
            clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'],
            duration: 460,
          },
          100
        );
      if (heroBits.length)
        tl.add(
          heroBits,
          { opacity: [0, 1], y: [14, 0], delay: stagger(48) },
          '<+=100'
        );
      if (blocks.length)
        tl.add(
          blocks,
          { opacity: [0, 1], y: [12, 0], delay: stagger(48) },
          h1.length ? '<+=180' : 140
        );

      const revealSel = [
        '.vp-doc h2',
        '.vp-doc h3',
        '.vp-doc .custom-block',
        '.vp-doc table',
        '.vp-doc div[class*="language-"]',
        '.vp-doc blockquote',
        '.VPFeature',
      ].join(', ');
      const revealEls = q(revealSel).filter(
        (el) => el.closest('.VPSidebar') == null
      );
      if (revealEls.length) {
        io = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (!e.isIntersecting) continue;
              const el = e.target as HTMLElement;
              io!.unobserve(el);
              if (el.matches('.vp-doc h2')) el.classList.add('cn-bar-in');
              animate(el, {
                opacity: [0, 1],
                y: [16, 0],
                duration: 320,
                ease: 'outQuart',
                onComplete: () => clearInline(el),
              });
            }
          },
          { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
        );
        for (const el of revealEls) io.observe(el);
      }
      for (const h of q('.vp-doc h2')) {
        if (h.getBoundingClientRect().top < innerHeight)
          h.classList.add('cn-bar-in');
      }
    });
  }

  if (document.readyState !== 'loading') run();
  else document.addEventListener('DOMContentLoaded', run, { once: true });
  router.onAfterRouteChanged = () => {
    requestAnimationFrame(run);
  };
}

// 折磨人开关（深浅色切换）：每次 run 尝试绑定，内部全局去重
import { setupAppearanceToggle } from './toggle';
setupAppearanceToggle();
