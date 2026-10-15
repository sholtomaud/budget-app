/**
 * The chat panel (ADR 0023): docked on the right and open by default on wide
 * screens, a full-screen sheet on narrow ones. It stays open, with its
 * conversation, as you move between screens. Conversations live in memory for
 * the session only; the open/closed state and width are kept as preferences.
 */
import { CHAT_ASK } from '../../chat-ask.ts';
import { BaseComponent, define } from '../../core/base-component.ts';
import { ROUTE_EVENT } from '../../core/router.ts';
import type { PageContext } from '../../assistant.ts';
import { Conversation } from '../../conversation.ts';
import { activeProvider } from '../../egress.ts';
import { pageDetails } from '../../page-context.ts';
import { screens } from '../../screens.ts';
import { STARTERS } from '../../../assistant/intents.ts';
import template from './chat-panel.html?raw';
import thread from '../../chat-thread.css?raw';
import style from './chat-panel.css?raw';

const OPEN_KEY = 'budget-app:chat-open';
const WIDTH_KEY = 'budget-app:chat-width';
export const CHAT_TOGGLE = 'app:chat-toggle';
const NARROW = '(max-width: 56rem)';

const pref = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const setPref = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // Private mode: the preference is not kept.
  }
};

export class ChatPanel extends BaseComponent {
  private conversation: Conversation | null = null;
  private path = '/';
  private includeContext = true;
  private readonly onRoute = (e: Event) => {
    this.path = (e as CustomEvent<string>).detail;
    this.includeContext = true;
    this.showContext();
  };
  private readonly onToggle = (e: Event) => {
    const want = (e as CustomEvent<boolean | undefined>).detail;
    this.setOpen(want ?? this.dataset.open !== 'true');
  };
  private readonly onAsk = (e: Event) => {
    const q = (e as CustomEvent<string>).detail;
    this.setOpen(true);
    void this.ask(q);
  };
  private readonly onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      this.setOpen(this.dataset.open !== 'true');
    }
  };
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super(template, thread + style);
  }

  override init(): void {
    // Open by default on wide screens (the chat is a way into the app); on a
    // phone it would cover everything, so it starts closed there.
    const saved = pref(OPEN_KEY);
    this.setOpen(saved ? saved === 'true' : !matchMedia(NARROW).matches, false);
    const w = Number(pref(WIDTH_KEY));
    if (w >= 280) {
      this.style.setProperty('--chat-w', `${w}px`);
      document.body.style.setProperty('--chat-w', `${w}px`);
    }
    this.path = location.pathname.slice(import.meta.env.BASE_URL.length - 1) || '/';

    const form = this.$<HTMLFormElement>('.ask');
    const q = this.$<HTMLTextAreaElement>('textarea');
    this.conversation ??= new Conversation(
      {
        log: this.$('.log'),
        suggestions: this.$('.suggestions'),
        status: this.$('.status'),
        input: q,
        send: this.$<HTMLButtonElement>('.send'),
        stop: this.$<HTMLButtonElement>('.stop'),
      },
      { context: () => this.context(), onDone: () => void this.showProvider() }
    );
    form.onsubmit = (e) => {
      e.preventDefault();
      void this.ask(q.value.trim());
    };
    q.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    };
    this.$<HTMLButtonElement>('.close').onclick = () => this.setOpen(false);
    this.$<HTMLButtonElement>('.fab').onclick = () => this.setOpen(true);
    this.$<HTMLButtonElement>('.new').onclick = () => this.conversation!.reset();
    this.$<HTMLButtonElement>('.ctx-remove').onclick = () => {
      this.includeContext = false;
      this.showContext();
    };
    this.resizable();
    window.addEventListener(ROUTE_EVENT, this.onRoute);
    window.addEventListener(CHAT_TOGGLE, this.onToggle);
    window.addEventListener(CHAT_ASK, this.onAsk);
    window.addEventListener('keydown', this.onKey);
    this.unsubscribe = pageDetails.subscribe(() => this.showContext());
    this.showContext();
    if (!this.$('.log').childElementCount) this.conversation.showSuggestions(STARTERS);
    void this.showProvider();
  }

  override destroy(): void {
    window.removeEventListener(ROUTE_EVENT, this.onRoute);
    window.removeEventListener(CHAT_TOGGLE, this.onToggle);
    window.removeEventListener(CHAT_ASK, this.onAsk);
    window.removeEventListener('keydown', this.onKey);
    this.unsubscribe?.();
  }

  setOpen(open: boolean, remember = true): void {
    this.dataset.open = String(open);
    document.body.classList.toggle('chat-open', open && !matchMedia(NARROW).matches);
    if (remember) setPref(OPEN_KEY, String(open));
    window.dispatchEvent(new CustomEvent('app:chat-state', { detail: open }));
    if (open) queueMicrotask(() => this.querySelector<HTMLTextAreaElement>('textarea')?.focus());
  }

  private resizable(): void {
    const handle = this.$('.resize');
    handle.onpointerdown = (e) => {
      handle.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const w = Math.max(280, Math.min(window.innerWidth * 0.6, window.innerWidth - ev.clientX));
        this.style.setProperty('--chat-w', `${w}px`);
        document.body.style.setProperty('--chat-w', `${w}px`);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        setPref(WIDTH_KEY, String(parseInt(this.style.getPropertyValue('--chat-w'), 10)));
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    };
  }

  private context(): PageContext | null {
    if (!this.includeContext) return null;
    const s = screens.find((x) => x.path === this.path);
    if (!s) return null;
    const detail = pageDetails.getState()[this.path];
    return { path: s.path, title: s.title, ...(detail ? { detail } : {}) };
  }

  private showContext(): void {
    const c = this.context();
    const p = this.$('.context');
    p.hidden = !c;
    if (c)
      this.$('.ctx-text').textContent = `Looking at: ${c.title}${c.detail ? ` · ${c.detail}` : ''}`;
  }

  private async showProvider(): Promise<void> {
    const ap = await activeProvider();
    this.$('.provider').textContent = ap.ok ? `+ ${ap.provider.label}` : 'on this device';
  }

  ask(question: string): Promise<void> {
    return this.conversation!.ask(question);
  }
}

define('chat-panel', ChatPanel);
