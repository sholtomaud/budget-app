import { BaseComponent, define } from '../../core/base-component.ts';
import { navigate, ROUTE_EVENT } from '../../core/router.ts';
import { publicPath } from '../../core/routes.ts';
import { data } from '../../data.ts';
import { GUIDE, guideStore, hideGuide, isDone, nextStep, visit } from '../../guide.ts';
import template from './guide-bar.html?raw';
import style from './guide-bar.css?raw';

/** The getting-started walkthrough, under the nav on every screen. */
export class GuideBar extends BaseComponent {
  private path = '/';
  private offs: (() => void)[] = [];
  private readonly onRoute = (e: Event) => {
    this.path = (e as CustomEvent<string>).detail;
    visit(this.path, this.hasData());
    this.render();
  };

  constructor() {
    super(template, style);
  }

  private hasData(): boolean {
    const v = data.getState().view;
    return !!v && (v.txns.length > 0 || v.budget.lines.length > 0);
  }

  override init(): void {
    window.addEventListener(ROUTE_EVENT, this.onRoute);
    this.offs.push(
      data.subscribe(() => {
        visit(this.path, this.hasData());
        this.render();
      }),
      guideStore.subscribe(() => this.render())
    );
    this.$<HTMLButtonElement>('.hide').onclick = () => hideGuide();
    this.$<HTMLAnchorElement>('.go').onclick = (e) => {
      e.preventDefault();
      const path = this.$<HTMLAnchorElement>('.go').dataset.path;
      if (path) navigate(path);
    };
    this.render();
  }

  override destroy(): void {
    window.removeEventListener(ROUTE_EVENT, this.onRoute);
    for (const off of this.offs) off();
  }

  private render(): void {
    const { hidden, visited } = guideStore.getState();
    const has = this.hasData();
    const next = nextStep(has, visited);
    // On a guide screen, explain this screen; elsewhere, point to the next step.
    const here = has ? GUIDE.find((g) => g.path === this.path && g.id !== 'data') : undefined;
    const shown = here ?? next;
    const bar = this.$('.bar');
    // Once every step is done the guide gets out of the way.
    bar.hidden = hidden || !shown || !next;
    if (!shown) return;
    const i = GUIDE.indexOf(shown);
    this.$('.progress').textContent = `Getting started: step ${i + 1} of ${GUIDE.length}`;
    this.$('.title').textContent = `${shown.title}.`;
    this.$('.desc').textContent = shown.text;
    const go = this.$<HTMLAnchorElement>('.go');
    const target = here ? (next && next !== here ? next : GUIDE[i + 1]) : shown;
    go.hidden = !target || target.path === this.path;
    if (target) {
      go.href = publicPath(target.path, import.meta.env.BASE_URL);
      go.textContent = here ? `Next: ${target.title}` : 'Show me';
      go.dataset.path = target.path;
    }
    this.$('.dots').replaceChildren(
      ...GUIDE.map((g) => {
        const li = document.createElement('li');
        if (isDone(g, has, visited)) li.className = 'done';
        if (g === shown) li.className = 'current';
        return li;
      })
    );
  }
}

define('guide-bar', GuideBar);
