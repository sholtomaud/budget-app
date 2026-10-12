/**
 * The chat panel (ADR 0023): docked on the right and open by default on wide
 * screens, a full-screen sheet on narrow ones. It stays open, with its
 * conversation, as you move between screens. Conversations live in memory for
 * the session only; the open/closed state and width are kept as preferences.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { navigate, ROUTE_EVENT } from '../../core/router.ts';
import { data, ensureLoaded } from '../../data.ts';
import { el } from '../../format.ts';
import { Assistant, type ChatReply, type PageContext } from '../../assistant.ts';
import { activeProvider } from '../../egress.ts';
import { pageDetails } from '../../page-context.ts';
import { screens } from '../../screens.ts';
import { categoryName } from '../../../classify/categories.ts';
import { STARTERS } from '../../../assistant/intents.ts';
import { parseMarkdown, type Block, type Inline } from '../../../assistant/markdown.ts';
import { chanceWords, percent } from '../../../assistant/phrases.ts';
import { applyProposal, describe, PERIOD_WORDS, type Proposal } from '../../proposals.ts';
import template from './chat-panel.html?raw';
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
  private assistant: Assistant | null = null;
  private path = '/';
  private includeContext = true;
  private busy = false;
  private stopped = false;
  private readonly onRoute = (e: Event) => {
    this.path = (e as CustomEvent<string>).detail;
    this.includeContext = true;
    this.showContext();
  };
  private readonly onToggle = (e: Event) => {
    const want = (e as CustomEvent<boolean | undefined>).detail;
    this.setOpen(want ?? this.dataset.open !== 'true');
  };
  private readonly onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      this.setOpen(this.dataset.open !== 'true');
    }
  };
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super(template, style);
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
    this.$<HTMLButtonElement>('.new').onclick = () => {
      this.assistant?.reset();
      this.$('.log').replaceChildren();
      this.showSuggestions(STARTERS);
    };
    this.$<HTMLButtonElement>('.stop').onclick = () => (this.stopped = true);
    this.$<HTMLButtonElement>('.ctx-remove').onclick = () => {
      this.includeContext = false;
      this.showContext();
    };
    this.resizable();
    window.addEventListener(ROUTE_EVENT, this.onRoute);
    window.addEventListener(CHAT_TOGGLE, this.onToggle);
    window.addEventListener('keydown', this.onKey);
    this.unsubscribe = pageDetails.subscribe(() => this.showContext());
    this.showContext();
    this.showSuggestions(STARTERS);
    void this.showProvider();
  }

  override destroy(): void {
    window.removeEventListener(ROUTE_EVENT, this.onRoute);
    window.removeEventListener(CHAT_TOGGLE, this.onToggle);
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

  private showSuggestions(list: readonly string[]): void {
    this.$('.suggestions').replaceChildren(
      ...list.map((s) => {
        const b = el('button', { type: 'button', class: 'secondary small' }, s);
        b.onclick = () => void this.ask(s);
        return b;
      })
    );
  }

  async ask(question: string): Promise<void> {
    if (!question || this.busy) return;
    this.busy = true;
    this.stopped = false;
    const status = this.$('.status');
    const stop = this.$<HTMLButtonElement>('.stop');
    const send = this.$<HTMLButtonElement>('.send');
    this.$<HTMLTextAreaElement>('textarea').value = '';
    this.$('.log').append(el('li', { class: 'msg user' }, question));
    this.showSuggestions([]);
    this.scrollDown();
    send.disabled = true;
    stop.hidden = false;
    status.textContent = 'Thinking…';
    try {
      await ensureLoaded();
      this.assistant ??= new Assistant(() => data.getState().view!);
      const reply = await this.assistant.answer(question, this.context(), (s) => {
        status.textContent = s;
      });
      if (this.stopped) {
        status.textContent = 'Stopped.';
        return;
      }
      status.textContent = '';
      await this.render(reply);
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
      this.showSuggestions(STARTERS);
    } finally {
      this.busy = false;
      send.disabled = false;
      stop.hidden = true;
      void this.showProvider();
    }
  }

  private scrollDown(): void {
    const log = this.$('.log');
    log.scrollTop = log.scrollHeight;
  }

  /** A reply: who answered, what was done, the text (typed out), then cards, buttons and footnotes. */
  private async render(r: ChatReply): Promise<void> {
    const li = el('li', { class: 'msg reply', 'data-source': r.source });
    const who = el(
      'div',
      { class: 'who' },
      r.source === 'ai'
        ? el('span', { class: 'ai' }, `Crux + ${r.provider ?? 'AI'}`)
        : 'Crux · on this device',
      r.cached ? ' · same answer as earlier' : ''
    );
    li.append(who);
    if (r.steps.length)
      li.append(
        el(
          'details',
          { class: 'steps' },
          el('summary', {}, 'What I did'),
          el('ul', {}, ...r.steps.map((s) => el('li', {}, s)))
        )
      );
    const parsed = parseMarkdown(r.text, r.runIds);
    const body = el('div', { class: 'body' }, ...parsed.blocks.map((b) => this.block(b)));
    li.append(body);
    this.$('.log').append(li);
    await this.typeOut(body);
    if (this.stopped) {
      li.dataset.done = 'true';
      return;
    }
    if (r.chart) li.append(this.meter(r.chart.p, r.chart.target));
    for (const p of r.proposals) li.append(this.card(p));
    if (r.links.length)
      li.append(
        el(
          'div',
          { class: 'links' },
          ...r.links.map((l) => {
            const b = el('button', { type: 'button', class: 'secondary small' }, l.label);
            b.onclick = () => navigate(l.path);
            return b;
          })
        )
      );
    if (parsed.runs.length)
      li.append(
        el(
          'ol',
          { class: 'footnotes', 'aria-label': 'Simulation runs' },
          ...parsed.runs.map((id) => el('li', {}, `Run ${id}`))
        )
      );
    if (r.unverified.length)
      li.append(
        el(
          'p',
          { class: 'unverified' },
          `Unverified figure${r.unverified.length > 1 ? 's' : ''}: ${r.unverified.join(', ')}. The app didn't compute ${r.unverified.length > 1 ? 'these' : 'this'}; don't rely on ${r.unverified.length > 1 ? 'them' : 'it'}.`
        )
      );
    li.dataset.done = 'true';
    this.showSuggestions(r.suggestions);
    this.scrollDown();
  }

  private inline(xs: Inline[]): (Node | string)[] {
    return xs.map((x) => {
      switch (x.t) {
        case 'text':
          return x.s;
        case 'code':
          return el('code', {}, x.s);
        case 'b':
          return el('strong', {}, ...this.inline(x.c));
        case 'i':
          return el('em', {}, ...this.inline(x.c));
        case 'ref':
          return el('sup', {}, `[${x.n}]`);
      }
    });
  }

  private block(b: Block): HTMLElement {
    if ('items' in b) return el(b.type, {}, ...b.items.map((i) => el('li', {}, ...this.inline(i))));
    return el(b.type === 'h' ? 'h3' : 'p', {}, ...this.inline(b.inline));
  }

  /** Reveal the text progressively, like a typed reply; instant with reduced motion. */
  private async typeOut(root: HTMLElement): Promise<void> {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text; text: string }[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push({ node: n as Text, text: n.textContent ?? '' });
      n.textContent = '';
    }
    const total = nodes.reduce((a, n) => a + n.text.length, 0);
    const perFrame = Math.max(3, Math.ceil(total / 60));
    let i = 0;
    for (const n of nodes) {
      for (let k = 0; k < n.text.length; k += perFrame) {
        if (this.stopped) break;
        n.node.textContent = n.text.slice(0, k + perFrame);
        if (++i % 1 === 0) await new Promise((res) => requestAnimationFrame(res));
        this.scrollDown();
      }
      n.node.textContent = n.text;
    }
  }

  /** A chance meter: how many futures work, against the target. */
  private meter(p: number, target: number): HTMLElement {
    return el(
      'div',
      {
        class: 'meter',
        role: 'img',
        'aria-label': `Works ${chanceWords(p)}; target ${percent(target)}`,
      },
      el(
        'div',
        { class: 'bar' },
        el('div', { class: 'fill', style: `width:${Math.max(1, p * 100)}%` }),
        el('div', {
          class: 'target',
          style: `left:${target * 100}%`,
          title: `Target ${percent(target)}`,
        })
      ),
      el(
        'div',
        { class: 'legend' },
        el('span', {}, `Works: ${percent(p)}`),
        el('span', {}, `Target: ${percent(target)}`)
      )
    );
  }

  /** A proposal card: editable details, then Apply or Discard; Undo after applying. */
  private card(p0: Proposal): HTMLElement {
    const v = data.getState().view!;
    const card = el('div', { class: 'proposal', 'data-kind': p0.kind });
    const summary = el('p', { class: 'summary' }, describe(p0, v));
    const fields = el('div', { class: 'fields' });
    const input = (label: string, value: string, type = 'text', step?: string) => {
      const i = el('input', {
        type,
        value,
        ...(step ? { step } : {}),
        'aria-label': label,
      }) as HTMLInputElement;
      fields.append(el('span', {}, label), i);
      return i;
    };
    const select = (label: string, options: [string, string][], value: string) => {
      const s = el('select', { 'aria-label': label }) as HTMLSelectElement;
      for (const [id, name] of options) s.append(new Option(name, id, false, id === value));
      fields.append(el('span', {}, label), s);
      return s;
    };
    const cats = (f: (id: string) => boolean) =>
      v.categories
        .filter((c) => f(c.id))
        .map((c) => [c.id, categoryName(c.id, v.categories)] as [string, string]);
    let read: () => Proposal = () => p0;
    switch (p0.kind) {
      case 'budget-line': {
        const item = input('Item', p0.line.item);
        const amount = input(
          'Amount ($)',
          (Number(p0.line.cost) / 100).toFixed(2),
          'number',
          '0.01'
        );
        const period = select('How often', Object.entries(PERIOD_WORDS), p0.line.period);
        const cat = select(
          'Category',
          cats((id) => !/^(capex|income|investment|tax|transfer)\./.test(id)),
          p0.line.categoryId
        );
        read = () => ({
          kind: 'budget-line',
          line: {
            ...p0.line,
            item: item.value.trim() || p0.line.item,
            cost: BigInt(Math.round(Number(amount.value) * 100)),
            period: period.value,
            categoryId: cat.value,
          },
        });
        break;
      }
      case 'asset': {
        const name = input('Item', p0.asset.name);
        const cost = input(
          'Replacement cost ($)',
          String(Number(p0.asset.cost.minor) / 100),
          'number',
          '1'
        );
        const cat = select(
          'Kind',
          cats((id) => id.startsWith('capex.')),
          p0.asset.categoryId
        );
        read = () => ({
          ...p0,
          asset: {
            ...p0.asset,
            name: name.value.trim() || p0.asset.name,
            cost: { minor: BigInt(Math.round(Number(cost.value) * 100)), ccy: 'AUD' },
            categoryId: cat.value,
          },
        });
        break;
      }
      case 'categorise': {
        const cat = select(
          'Category',
          cats(() => true),
          p0.categoryId
        );
        read = () => ({ ...p0, categoryId: cat.value });
        break;
      }
      case 'scenario': {
        const name = input('Name', p0.name);
        read = () => ({ ...p0, name: name.value.trim() || p0.name });
        break;
      }
    }
    const apply = el('button', { type: 'button', class: 'small apply' }, 'Apply');
    const discard = el('button', { type: 'button', class: 'secondary small discard' }, 'Discard');
    const note = el('span', { class: 'muted small result', role: 'status' });
    const buttons = el('div', { class: 'buttons' }, apply, discard, note);
    apply.onclick = async () => {
      apply.disabled = discard.disabled = true;
      fields
        .querySelectorAll('input,select')
        .forEach((x) => ((x as HTMLInputElement).disabled = true));
      try {
        const undo = await applyProposal(read());
        note.textContent = 'Applied.';
        const u = el('button', { type: 'button', class: 'secondary small undo' }, 'Undo');
        u.onclick = async () => {
          u.disabled = true;
          await undo();
          note.textContent = 'Undone.';
          u.remove();
        };
        buttons.append(u);
      } catch (err) {
        note.textContent = err instanceof Error ? err.message : String(err);
        apply.disabled = discard.disabled = false;
      }
    };
    discard.onclick = () => {
      apply.disabled = discard.disabled = true;
      note.textContent = 'Discarded.';
    };
    card.append(summary, fields, buttons);
    return card;
  }
}

define('chat-panel', ChatPanel);
