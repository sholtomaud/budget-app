/**
 * The menu (ADR 0040): every screen in a sidebar on the left, the same on
 * every screen. Pinned, it is wide with names; unpinned, a rail of icons that
 * opens over the page on hover or focus. On phones it is a drawer behind a
 * Menu button. The choice is remembered on this device.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { ROUTE_EVENT } from '../../core/router.ts';
import { publicPath } from '../../core/routes.ts';
import { icon } from '../../icons.ts';
import { screens } from '../../screens.ts';
import { currentTheme, setTheme } from '../../theme.ts';
import template from './app-nav.html?raw';
import style from './app-nav.css?raw';

const PIN_KEY = 'crux-nav-pinned';
const NARROW = '(max-width: 56rem)';

function pref(): boolean {
  try {
    return localStorage.getItem(PIN_KEY) !== 'false';
  } catch {
    return true;
  }
}

export class AppNav extends BaseComponent {
  private readonly onRoute = (e: Event) => {
    this.highlight((e as CustomEvent<string>).detail);
    this.drawer(false);
  };
  private readonly onChat = (e: Event) =>
    this.$('.chat').setAttribute('aria-pressed', String((e as CustomEvent<boolean>).detail));
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.classList.contains('open')) {
      this.drawer(false);
      this.$<HTMLButtonElement>('.burger').focus();
    }
  };

  constructor() {
    super(template, style);
  }

  override init(): void {
    const base = import.meta.env.BASE_URL;
    for (const a of this.querySelectorAll<HTMLAnchorElement>('.brand'))
      a.href = publicPath('/', base);
    this.$('.links').replaceChildren(
      ...screens
        .filter((s) => s.path !== '/' && !s.hidden)
        .map((s) => {
          const a = document.createElement('a');
          a.href = publicPath(s.path, base);
          a.dataset.route = s.path;
          a.title = s.nav;
          const label = document.createElement('span');
          label.className = 'label';
          label.textContent = s.nav;
          a.append(icon(s.path), label);
          const li = document.createElement('li');
          li.append(a);
          return li;
        })
    );
    this.$('.burger').append(icon('menu'));
    this.$('.pin').prepend(icon('pin'));
    this.$('.chat').prepend(icon('chat'));
    const theme = this.$<HTMLButtonElement>('.theme');
    theme.prepend(icon('theme'));
    const label = () =>
      (theme.querySelector('.label')!.textContent =
        currentTheme() === 'dark' ? 'Light theme' : 'Dark theme');
    label();
    theme.onclick = () => {
      setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      label();
    };
    this.$<HTMLButtonElement>('.chat').onclick = () =>
      window.dispatchEvent(new CustomEvent('app:chat-toggle'));
    this.$<HTMLButtonElement>('.pin').onclick = () =>
      this.pin(this.$('.pin').getAttribute('aria-pressed') !== 'true');
    this.$<HTMLButtonElement>('.burger').onclick = () =>
      this.drawer(!this.classList.contains('open'));
    this.$('.scrim').onclick = () => this.drawer(false);
    this.pin(pref(), false);
    window.addEventListener(ROUTE_EVENT, this.onRoute);
    window.addEventListener('app:chat-state', this.onChat);
    window.addEventListener('keydown', this.onKey);
  }

  override destroy(): void {
    window.removeEventListener(ROUTE_EVENT, this.onRoute);
    window.removeEventListener('app:chat-state', this.onChat);
    window.removeEventListener('keydown', this.onKey);
  }

  /** Pinned: a wide menu with names. Unpinned: a rail of icons. */
  private pin(on: boolean, save = true): void {
    const b = this.$('.pin');
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? 'Shrink the menu to icons' : 'Keep the menu open, with names';
    document.body.dataset.nav = on ? 'wide' : 'rail';
    if (save)
      try {
        localStorage.setItem(PIN_KEY, String(on));
      } catch {
        // A remembered layout is a convenience; private browsing may refuse it.
      }
  }

  /** Phones: the menu as a drawer over the page. */
  private drawer(open: boolean): void {
    if (!matchMedia(NARROW).matches && open) return;
    this.classList.toggle('open', open);
    this.$('.burger').setAttribute('aria-expanded', String(open));
    this.$('.scrim').hidden = !open;
    if (open) this.querySelector<HTMLAnchorElement>('.links a')?.focus();
  }

  private highlight(path: string): void {
    for (const a of this.querySelectorAll<HTMLAnchorElement>('.links a')) {
      if (a.dataset.route === path) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }
}

define('app-nav', AppNav);
