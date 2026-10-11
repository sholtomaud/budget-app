import { BaseComponent, define } from '../../core/base-component.ts';
import { ROUTE_EVENT } from '../../core/router.ts';
import { publicPath } from '../../core/routes.ts';
import { screens } from '../../screens.ts';
import { currentTheme, setTheme } from '../../theme.ts';
import template from './app-nav.html?raw';
import style from './app-nav.css?raw';

export class AppNav extends BaseComponent {
  private readonly onRoute = (e: Event) => this.highlight((e as CustomEvent<string>).detail);

  constructor() {
    super(template, style);
  }

  override init(): void {
    const base = import.meta.env.BASE_URL;
    this.$<HTMLAnchorElement>('.brand').href = publicPath('/', base);
    const list = this.$('.links');
    list.replaceChildren(
      ...screens
        .filter((s) => s.path !== '/')
        .map((s) => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = publicPath(s.path, base);
          a.dataset.route = s.path;
          a.textContent = s.nav;
          li.append(a);
          return li;
        })
    );
    const btn = this.$<HTMLButtonElement>('.theme');
    const label = () => (btn.textContent = currentTheme() === 'dark' ? 'Light' : 'Dark');
    label();
    btn.onclick = () => {
      setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      label();
    };
    window.addEventListener(ROUTE_EVENT, this.onRoute);
  }

  override destroy(): void {
    window.removeEventListener(ROUTE_EVENT, this.onRoute);
  }

  private highlight(path: string): void {
    for (const a of this.querySelectorAll<HTMLAnchorElement>('.links a')) {
      if (a.dataset.route === path) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }
}

define('app-nav', AppNav);
