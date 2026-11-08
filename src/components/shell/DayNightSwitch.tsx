import { useEffect, useRef } from 'react';
import { useTheme } from './ThemeProvider';

const REF_CSS =
  '* { margin: 0; padding: 0; transition: 0.7s; -webkit-tap-highlight-color:rgba(0,0,0,0); } .container { position: absolute;top: 50%;left: 50%;margin-top: -35em;margin-left: -90em;width: 180em; height: 70em; display: inline-block; vertical-align: bottom; transform: translate3d(0, 0, 0); } .components{ position:fixed; width: 180em; height: 70em; background-color: rgba(70, 133, 192,1); border-radius: 100em; box-shadow: inset 0 0 5em 3em rgba(0, 0, 0, 0.5); overflow: hidden; transition: 0.7s; transition-timing-function: cubic-bezier( 0,0.5, 1,1); cursor: pointer; } .main-button{ margin: 7.5em 0 0 7.5em; width: 55em; height:55em; background-color: rgba(255, 195, 35,1); border-radius: 50%; box-shadow:3em 3em 5em rgba(0, 0, 0, 0.5), inset -3em -5em 3em -3em rgba(0, 0, 0, 0.5), inset 4em 5em 2em -2em rgba(255, 230, 80,1); transition: 1.0s; transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1.00); } .moon{ position: absolute; background-color: rgba(150, 160, 180, 1); box-shadow:inset 0em 0em 1em 1em rgba(0, 0, 0, 0.3) ; border-radius: 50%; transition: 0.5s; opacity: 0; } .moon:nth-child(1){ top: 7.5em; left: 25em; width: 12.5em; height: 12.5em; } .moon:nth-child(2){ top: 20em; left: 7.5em; width: 20em; height: 20em; } .moon:nth-child(3){ top: 32.5em; left: 32.5em; width: 12.5em; height: 12.5em; } .daytime-background { position: absolute; border-radius: 50%; transition: 1.0s; transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1.00); } .daytime-background:nth-child(2){ top: -20em; left: -20em; width: 110em; height:110em; background-color: rgba(255, 255, 255,0.2); z-index: -2; } .daytime-background:nth-child(3){ top: -32.5em; left: -17.5em; width: 135em; height:135em; background-color: rgba(255, 255, 255,0.1); z-index: -3; } .daytime-background:nth-child(4){ top: -45em; left: -15em; width: 160em; height:160em; background-color: rgba(255, 255, 255,0.05); z-index: -4; } .cloud,.cloud-light{ transform: translateY(10em); transition: 1.0s; transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1.00); } .cloud-son{ position: absolute; background-color: #fff; border-radius: 50%; z-index: -1; transition: transform 6s,right 1s,bottom 1s; } .cloud-son:nth-child(6n+1){ right: -20em; bottom: 10em; width: 50em; height: 50em; } .cloud-son:nth-child(6n+2) { right: -10em; bottom: -25em; width: 60em; height: 60em; } .cloud-son:nth-child(6n+3) { right: 20em; bottom: -40em; width: 60em; height: 60em; } .cloud-son:nth-child(6n+4) { right: 50em; bottom: -35em; width: 60em; height: 60em; } .cloud-son:nth-child(6n+5) { right: 75em; bottom: -60em; width: 75em; height: 75em; } .cloud-son:nth-child(6n+6) { right: 110em; bottom: -50em; width: 60em; height: 60em; } .cloud{ z-index: -2; } .cloud-light{ position: absolute; right: 0em; bottom: 25em; opacity: 0.5; z-index: -3; } .stars{ transform: translateY(-125em); z-index: -2; transition: 1.0s; transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1.00); } .big { --size: 7.5em; } .medium { --size: 5em; } .small { --size: 3em; } .star { position: absolute; width: calc(2*var(--size)); height: calc(2*var(--size)); } .star:nth-child(1){ top: 11em; left: 39em; animation-name: star; animation-duration: 3.5s; } .star:nth-child(2){ top: 39em; left: 91em; animation-name: star; animation-duration: 4.1s; } .star:nth-child(3){ top: 26em; left: 19em; animation-name: star; animation-duration: 4.9s; } .star:nth-child(4){ top: 37em; left: 66em; animation-name: star; animation-duration: 5.3s; } .star:nth-child(5){ top: 21em; left: 75em; animation-name: star; animation-duration: 3s; } .star:nth-child(6){ top: 51em; left: 38em; animation-name: star; animation-duration: 2.2s; } @keyframes star { 0%,20%{ transform: scale(0); } 20%,100% { transform: scale(1); } } .star-son{ float: left; } .star-son:nth-child(1) { --pos: left 0; } .star-son:nth-child(2) { --pos: right 0; } .star-son:nth-child(3) { --pos: 0 bottom; } .star-son:nth-child(4) { --pos: right bottom; } .star-son { width: var(--size); height: var(--size); background-image: radial-gradient(circle var(--size) at var(--pos), transparent var(--size), #fff); } .star{ transform: scale(1); transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1.00); transition: 1s; animation-iteration-count:infinite; animation-direction: alternate; animation-timing-function: linear; } .twinkle { transform: scale(0); }';

const REF_HTML =
  '<div class="components"><div class="main-button"><div class="moon"></div><div class="moon"></div><div class="moon"></div></div><div class="daytime-background"></div><div class="daytime-background"></div><div class="daytime-background"></div><div class="cloud"><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div></div><div class="cloud-light"><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div></div><div class="stars"><div class="star big"><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div></div><div class="star big"><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div></div><div class="star medium"><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div></div><div class="star medium"><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div></div><div class="star small"><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div></div><div class="star small"><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div></div></div></div>';

const EXTRA_CSS = `
.dn-plane, .dn-bear { position: absolute; left: 0; top: 0; z-index: -1; opacity: 0;
  pointer-events: none; transition: opacity 0.8s ease; }
.dn-plane svg, .dn-bear svg { display: block; overflow: visible; }
.dn-plane svg { width: 24em; height: 14.5em; }
.dn-bear svg { width: 30em; height: 30em; }
.is-day .dn-plane { opacity: 0.95; }
.is-night .dn-bear { opacity: 0.95; }
.dn-plane { animation: dn-plane-fly 9.5s linear infinite; }
.dn-bear { animation: dn-bear-float 17s linear infinite; }
@keyframes dn-plane-fly {
  0% { transform: translate(-28em, 14em) rotate(-4deg); }
  35% { transform: translate(70em, 9em) rotate(2deg); }
  70% { transform: translate(150em, 15em) rotate(-2deg); }
  100% { transform: translate(196em, 10em) rotate(4deg); }
}
@keyframes dn-bear-float {
  0% { transform: translate(-30em, 34em) rotate(-10deg); }
  30% { transform: translate(50em, 27em) rotate(6deg); }
  55% { transform: translate(112em, 33em) rotate(-6deg); }
  80% { transform: translate(160em, 26em) rotate(8deg); }
  100% { transform: translate(200em, 32em) rotate(-10deg); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .dn-plane, .dn-bear { animation: none !important; opacity: 0 !important; }
}
`;

const EXTRA_HTML = `
<div class="dn-plane" aria-hidden="true">
  <svg viewBox="0 0 30 18">
    <path d="M30 9 L1 0.5 L11 9 Z" fill="#fff"/>
    <path d="M30 9 L11 9 L1 17.5 Z" fill="rgba(0,0,0,0.16)"/>
    <path d="M30 9 L6 9" stroke="rgba(0,0,0,0.10)" stroke-width="1" fill="none"/>
  </svg>
</div>
<div class="dn-bear" aria-hidden="true">
  <svg viewBox="-20 -20 40 40">
    <rect x="-9" y="2" width="18" height="14" rx="5" fill="#b9c4d4"/>
    <ellipse cx="0" cy="9" rx="7.5" ry="8" fill="#e6ecf5"/>
    <ellipse cx="-7.6" cy="7" rx="2.8" ry="2.2" fill="#cfd9e6"/>
    <ellipse cx="7.6" cy="7" rx="2.8" ry="2.2" fill="#cfd9e6"/>
    <circle cx="-6.2" cy="-8" r="3.4" fill="#a8845c"/>
    <circle cx="6.2" cy="-8" r="3.4" fill="#a8845c"/>
    <circle cx="-6.2" cy="-8" r="1.7" fill="#c9a583"/>
    <circle cx="6.2" cy="-8" r="1.7" fill="#c9a583"/>
    <circle cx="0" cy="-1.5" r="8" fill="#a8845c"/>
    <ellipse cx="0" cy="2.2" rx="3.6" ry="2.7" fill="#d8b894"/>
    <circle cx="0" cy="1.3" r="1.1" fill="#4a3628"/>
    <circle cx="-3" cy="-3" r="1.15" fill="#2b2b3a"/>
    <circle cx="3" cy="-3" r="1.15" fill="#2b2b3a"/>
    <circle cx="0" cy="-1" r="13.5" fill="rgba(255,255,255,0.16)" stroke="#fff" stroke-width="1.6"/>
    <path d="M-9.5 -8.5 a10.5 10.5 0 0 1 6.5 -7" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
</div>`;

function applyShadowState(shadow: ShadowRoot, dark: boolean) {
  const box = shadow.querySelector('.container');
  if (!box) return;
  box.classList.remove('is-day', 'is-night');
  box.classList.add(dark ? 'is-night' : 'is-day');
  const knob = shadow.querySelector<HTMLElement>('.main-button');
  const bgs = shadow.querySelectorAll<HTMLElement>('.daytime-background');
  const cloud = shadow.querySelector<HTMLElement>('.cloud');
  const cloudLight = shadow.querySelector<HTMLElement>('.cloud-light');
  const track = shadow.querySelector<HTMLElement>('.components');
  const moons = shadow.querySelectorAll<HTMLElement>('.moon');
  const stars = shadow.querySelector<HTMLElement>('.stars');
  if (!knob || !cloud || !cloudLight || !track || !stars) return;
  if (dark) {
    knob.style.transform = 'translateX(110em)';
    knob.style.backgroundColor = 'rgba(195, 200, 210, 1)';
    knob.style.boxShadow =
      '3em 3em 5em rgba(0,0,0,0.5), inset -3em -5em 3em -3em rgba(0,0,0,0.5), inset 4em 5em 2em -2em rgba(255,255,210,1)';
    if (bgs[0]) bgs[0].style.transform = 'translateX(110em)';
    if (bgs[1]) bgs[1].style.transform = 'translateX(80em)';
    if (bgs[2]) bgs[2].style.transform = 'translateX(50em)';
    cloud.style.transform = 'translateY(80em)';
    cloudLight.style.transform = 'translateY(80em)';
    track.style.backgroundColor = 'rgba(25,30,50,1)';
    moons.forEach((m) => {
      m.style.opacity = '1';
    });
    stars.style.transform = 'translateY(-62.5em)';
    stars.style.opacity = '1';
  } else {
    knob.style.transform = 'translateX(0)';
    knob.style.backgroundColor = 'rgba(255,195,35,1)';
    knob.style.boxShadow =
      '3em 3em 5em rgba(0,0,0,0.5), inset -3em -5em 3em -3em rgba(0,0,0,0.5), inset 4em 5em 2em -2em rgba(255,230,80,1)';
    bgs.forEach((b) => {
      b.style.transform = 'translateX(0)';
    });
    cloud.style.transform = 'translateY(10em)';
    cloudLight.style.transform = 'translateY(10em)';
    track.style.backgroundColor = 'rgba(70,133,192,1)';
    moons.forEach((m) => {
      m.style.opacity = '0';
    });
    stars.style.transform = 'translateY(-125em)';
    stars.style.opacity = '0';
  }
}

export function DayNightSwitch() {
  const { dark, setMode } = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const darkRef = useRef(dark);
  darkRef.current = dark;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!shadowRef.current) {
      const wrap = document.createElement('div');
      wrap.setAttribute('aria-hidden', 'true');
      wrap.style.cssText =
        'position:absolute;left:50%;top:50%;width:180px;height:70px;margin-left:-90px;margin-top:-35px;transform:scale(0.46);transform-origin:center;pointer-events:none';
      const scene = document.createElement('div');
      scene.style.cssText = 'position:absolute;inset:0;width:180px;height:70px';
      const shadow = scene.attachShadow({ mode: 'closed' });
      const box = document.createElement('div');
      box.className = 'container';
      box.style.fontSize = '1px';
      box.innerHTML = REF_HTML;
      const comp = box.querySelector<HTMLElement>('.components');
      if (comp) comp.insertAdjacentHTML('beforeend', EXTRA_HTML);
      const style = document.createElement('style');
      style.textContent = REF_CSS + EXTRA_CSS;
      shadow.appendChild(style);
      shadow.appendChild(box);
      wrap.appendChild(scene);
      host.appendChild(wrap);
      shadowRef.current = shadow;

      if (comp) {
        comp.style.transition = 'none';
        applyShadowState(shadow, darkRef.current);
        window.setTimeout(() => comp.style.removeProperty('transition'), 60);
      }
    }

    const shadow = shadowRef.current;
    if (!shadow) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const knob = shadow.querySelector<HTMLElement>('.main-button');
    const cloud = shadow.querySelector<HTMLElement>('.cloud');
    const sons = shadow.querySelectorAll<HTMLElement>('.cloud-son');
    const dirs = ['2em', '-2em'];

    const onEnter = () => {
      if (reduced?.matches || !knob || !cloud) return;
      knob.style.transform = darkRef.current
        ? 'translateX(100em)'
        : 'translateX(10em)';
      cloud.style.transform = 'translateY(14em)';
    };
    const onLeave = () => applyShadowState(shadow, darkRef.current);

    host.addEventListener('mouseenter', onEnter);
    host.addEventListener('mouseleave', onLeave);

    const timer = window.setInterval(() => {
      if (document.hidden || reduced?.matches) return;
      sons.forEach((s) => {
        s.style.transform = `translate(${dirs[Math.floor(Math.random() * 2)]}, ${dirs[Math.floor(Math.random() * 2)]})`;
      });
    }, 1000);

    return () => {
      window.clearInterval(timer);
      host.removeEventListener('mouseenter', onEnter);
      host.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  useEffect(() => {
    if (shadowRef.current) {
      applyShadowState(shadowRef.current, dark);
    }
  }, [dark]);

  const toggle = () => {
    const nextDark = !dark;
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      document.documentElement.classList.add('dn-color-shift');
      window.setTimeout(
        () => document.documentElement.classList.remove('dn-color-shift'),
        760
      );
    }
    setMode(nextDark ? 'dark' : 'light');
  };

  return (
    <div
      ref={hostRef}
      className="dn-host"
      role="switch"
      tabIndex={0}
      aria-checked={dark}
      aria-label="切换深色/浅色模式"
      title="切换深色/浅色模式（默认跟随系统）"
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
      style={{
        position: 'relative',
        display: 'inline-block',
        width: '84px',
        height: '32px',
        verticalAlign: 'middle',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    />
  );
}
