import { BaseComponent, define } from '../../core/base-component.ts';
import { sim } from '../../sim-client.ts';
import template from './start-page.html?raw';
import style from './start-page.css?raw';

export class StartPage extends BaseComponent {
  constructor() {
    super(template, style);
  }

  override init(): void {
    const base = import.meta.env.BASE_URL;
    for (const a of this.querySelectorAll<HTMLAnchorElement>('a[data-route]')) {
      a.href = base + (a.dataset.route ?? '/').replace(/^\//, '');
    }
    const state = this.$('.kstate');
    sim()
      .kernelInfo()
      .then((k) => {
        state.textContent = `GSSK ${k.version}, SHA-256 verified`;
        state.dataset.ok = 'true';
      })
      .catch((err: unknown) => {
        state.textContent = `not available (${err instanceof Error ? err.message : String(err)})`;
        state.dataset.ok = 'false';
      });
  }
}

define('start-page', StartPage);
