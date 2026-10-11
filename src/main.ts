import './styles/global.css';
import { Router } from './app/core/router.ts';
import { screens } from './app/screens.ts';
import './app/components/app-nav/app-nav.ts';
import { applyStoredTheme } from './app/theme.ts';
import './app/components/lock-screen/lock-screen.ts';
import { initVault } from './app/vault.ts';

applyStoredTheme();

const outlet = document.querySelector<HTMLElement>('#router-outlet');
if (!outlet) throw new Error('index.html has no #router-outlet');

const router = new Router(outlet, import.meta.env.BASE_URL, 'budget-app').register(screens);
if (import.meta.env.DEV) {
  // §16.2: the evaluation page exists in development builds only.
  await import('./app/components/eval-page/eval-page.ts');
  router.register([{ path: '/eval', component: 'eval-page', title: 'Evaluation' }]);
}
document.body.append(document.createElement('lock-screen'));
// NFR-STO-002: screens wait for the vault (data.ts) before reading anything.
void initVault();
void router.render();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // NFR-STO-005: works offline after first load.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err: unknown) => {
      console.warn('Service worker registration failed', err);
    });
  });
}
