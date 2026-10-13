/**
 * The chat screen (route /chat, ADR 0027): a full-width conversation with the
 * menu on the left (behind a Menu button on phones). It walks through setup
 * (your data, your budget, your plan) with buttons, reads typed answers, and
 * answers questions like the chat panel. Start stays the landing page until
 * this has proved itself.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { ROUTE_EVENT } from '../../core/router.ts';
import { publicPath } from '../../core/routes.ts';
import { Conversation } from '../../conversation.ts';
import { activeProvider } from '../../egress.ts';
import { screens } from '../../screens.ts';
import { SetupRunner } from '../../setup-runner.ts';
import { currentTheme, setTheme } from '../../theme.ts';
import type { Section } from '../../../assistant/flows/engine.ts';
import { SETUP } from '../../../assistant/flows/setup.ts';
import template from './chat-page.html?raw';
import thread from '../../chat-thread.css?raw';
import style from './chat-page.css?raw';

const SECTIONS: Section[] = ['data', 'budget', 'plan'];

export class ChatPage extends BaseComponent {
  private runner: SetupRunner | null = null;
  private readonly closeMenu = () => this.menu(false);

  constructor() {
    super(template, thread + style);
  }

  override init(): void {
    document.body.classList.add('chat-home');
    const base = import.meta.env.BASE_URL;
    this.$<HTMLAnchorElement>('.brand').href = publicPath('/', base);
    this.$('.side .links').replaceChildren(
      ...screens
        .filter((s) => !s.hidden && s.path !== '/chat')
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
    const theme = this.$<HTMLButtonElement>('.theme');
    const label = () =>
      (theme.textContent = currentTheme() === 'dark' ? 'Light theme' : 'Dark theme');
    label();
    theme.onclick = () => {
      setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      label();
    };
    this.$<HTMLButtonElement>('.menu').onclick = () =>
      this.menu(!this.$('.side').classList.contains('open'));
    window.addEventListener(ROUTE_EVENT, this.closeMenu);

    const q = this.$<HTMLTextAreaElement>('textarea');
    const chat = new Conversation(
      {
        log: this.$('.log'),
        suggestions: this.$('.suggestions'),
        status: this.$('.status'),
        input: q,
        send: this.$<HTMLButtonElement>('.send'),
        stop: this.$<HTMLButtonElement>('.stop'),
      },
      { context: () => null, onDone: () => void this.showProvider() }
    );
    const runner = new SetupRunner(SETUP, chat, (id) =>
      this.progress(SETUP.states[id]!.section, id)
    );
    this.runner = runner;
    const form = this.$<HTMLFormElement>('.ask');
    form.onsubmit = (e) => {
      e.preventDefault();
      void runner.typed(q.value.trim());
    };
    q.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    };
    this.$<HTMLButtonElement>('.restart').onclick = () => {
      if (chat.busy) return;
      this.menu(false);
      void runner.restart();
    };
    void this.showProvider();
    if (!this.$('.log').childElementCount) void runner.begin();
  }

  override destroy(): void {
    document.body.classList.remove('chat-home');
    window.removeEventListener(ROUTE_EVENT, this.closeMenu);
  }

  private menu(open: boolean): void {
    this.$('.side').classList.toggle('open', open);
    this.$('.menu').setAttribute('aria-expanded', String(open));
  }

  /** The setup steps in the menu: done, current, or still to come. */
  private progress(section: Section, id: string): void {
    const at = SECTIONS.indexOf(section);
    const finished = id === 'plan.done';
    for (const li of this.querySelectorAll<HTMLElement>('.steps li')) {
      const i = SECTIONS.indexOf(li.dataset.section as Section);
      li.dataset.state = finished || i < at ? 'done' : i === at ? 'current' : 'todo';
      if (i === at && !finished) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    }
  }

  private async showProvider(): Promise<void> {
    const ap = await activeProvider();
    this.$('.provider').textContent = ap.ok ? `+ ${ap.provider.label}` : 'on this device';
  }

  /** For tests and the console: the setup state the chat is in. */
  get setupState(): string | undefined {
    return this.runner?.stateId;
  }
}

define('chat-page', ChatPage);
