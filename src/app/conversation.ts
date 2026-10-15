/**
 * A conversation with Crux, as DOM: the messages, the activity log, cards
 * and buttons (ADR 0023, ADR 0024). The chat panel and the chat screen
 * (ADR 0027) each own one, on their own elements.
 */
import { navigate } from './core/router.ts';
import { data, ensureLoaded } from './data.ts';
import { el } from './format.ts';
import type { Activity, ActivitySink } from './activity.ts';
import { Assistant, type ChatReply, type PageContext } from './assistant.ts';
import { categoryName } from '../classify/categories.ts';
import { STARTERS } from '../assistant/intents.ts';
import { parseMarkdown, type Block, type Inline } from '../assistant/markdown.ts';
import { chanceWords, percent } from '../assistant/phrases.ts';
import { applyProposal, describe, PERIOD_WORDS, type Proposal } from './proposals.ts';
import './components/chat-chart/chat-chart.ts';
import type { ChatChart } from './components/chat-chart/chat-chart.ts';

export interface ConversationElements {
  log: HTMLElement;
  suggestions: HTMLElement;
  status: HTMLElement;
  input: HTMLTextAreaElement;
  send: HTMLButtonElement;
  stop: HTMLButtonElement;
}

export interface ConversationOptions {
  /** The screen the person is looking at, if they let it be included. */
  context: () => PageContext | null;
  /** Called when an answer finishes (to refresh the provider label). */
  onDone?: () => void;
}

/** A reply from Crux itself, with no AI. */
export const cruxReply = (r: Partial<ChatReply> & { text: string }): ChatReply => ({
  source: 'crux',
  runIds: [],
  unverified: [],
  proposals: [],
  links: [],
  suggestions: [],
  ...r,
});

export class Conversation {
  readonly els: ConversationElements;
  private readonly opts: ConversationOptions;
  private assistant: Assistant | null = null;
  busy = false;
  private stopped = false;
  private controller: AbortController | null = null;

  constructor(els: ConversationElements, opts: ConversationOptions) {
    this.els = els;
    this.opts = opts;
    els.stop.onclick = () => {
      this.stopped = true;
      this.controller?.abort();
    };
  }

  /** Forget the conversation ("New chat"). */
  reset(): void {
    this.assistant?.reset();
    this.els.log.replaceChildren();
    this.showSuggestions(STARTERS);
  }

  showSuggestions(list: readonly string[]): void {
    this.els.suggestions.replaceChildren(
      ...list.map((s) => {
        const b = el('button', { type: 'button', class: 'secondary small' }, s);
        b.onclick = () => void this.ask(s);
        return b;
      })
    );
  }

  /** The person's own message. */
  user(text: string): void {
    this.els.log.append(el('li', { class: 'msg user' }, text));
    this.scrollDown(true);
  }

  /** A reply from Crux that needs no thinking: a setup step, a result. */
  async say(r: ChatReply): Promise<HTMLElement> {
    this.stopped = false;
    const li = await this.render(r, null);
    this.scrollDown(true);
    return li;
  }

  /**
   * Do one piece of work with the busy state and the activity log: setup
   * steps (imports, a simulation) show as Crux's steps, like an answer's.
   */
  async work<T>(fn: (say: ActivitySink) => Promise<T>): Promise<T> {
    this.busy = true;
    this.els.send.disabled = true;
    const live = new LiveLog(this);
    try {
      return await fn((a) => live.on(a));
    } catch (err) {
      live.stop();
      throw err;
    } finally {
      this.busy = false;
      this.els.send.disabled = false;
    }
  }

  async ask(question: string): Promise<void> {
    if (!question || this.busy) return;
    this.busy = true;
    this.stopped = false;
    this.controller = new AbortController();
    const { status, stop, send } = this.els;
    this.els.input.value = '';
    this.els.log.append(el('li', { class: 'msg user' }, question));
    this.showSuggestions([]);
    this.scrollDown(true);
    send.disabled = true;
    stop.hidden = false;
    status.textContent = 'Thinking…';
    const live = new LiveLog(this);
    try {
      await ensureLoaded();
      this.assistant ??= new Assistant(() => data.getState().view!);
      const reply = await this.assistant.answer(question, this.opts.context(), {
        signal: this.controller.signal,
        onActivity: (a) => {
          status.textContent = '';
          live.on(a);
        },
      });
      if (this.stopped) {
        live.stop();
        status.textContent = 'Stopped.';
        return;
      }
      status.textContent = '';
      await this.render(reply, live.finalBubble(reply));
    } catch (err) {
      live.stop();
      status.textContent = this.stopped
        ? 'Stopped.'
        : err instanceof Error
          ? err.message
          : String(err);
      this.showSuggestions(STARTERS);
    } finally {
      this.busy = false;
      this.controller = null;
      send.disabled = false;
      stop.hidden = true;
      this.opts.onDone?.();
    }
  }

  /** Scroll to the newest message; when streaming, only if the person hasn't scrolled up. */
  scrollDown(force = false): void {
    const log = this.els.log;
    if (force || log.scrollHeight - log.scrollTop - log.clientHeight < 120)
      log.scrollTop = log.scrollHeight;
  }

  /** The reply's markdown, as DOM (never HTML). */
  body(text: string, runIds: readonly string[]) {
    const parsed = parseMarkdown(text, [...runIds]);
    return { parsed, nodes: parsed.blocks.map((b) => this.block(b)) };
  }

  /**
   * A reply: who answered, then the text, then cards, buttons and footnotes.
   * An AI reply was already streamed into `streamed`: it is re-rendered with
   * its footnotes. Crux's own replies are typed out.
   */
  private async render(r: ChatReply, streamed: HTMLElement | null): Promise<HTMLElement> {
    const li = streamed ?? el('li', { class: 'msg reply', 'data-source': r.source });
    li.dataset.source = r.source;
    li.classList.remove('live');
    li.replaceChildren(
      el(
        'div',
        { class: 'who' },
        r.source === 'ai'
          ? el('span', { class: 'ai' }, `Crux + ${r.provider ?? 'AI'}`)
          : 'Crux · on this device',
        r.cached ? ' · same answer as earlier' : ''
      )
    );
    const { parsed, nodes } = this.body(r.text, r.runIds);
    const body = el('div', { class: 'body' }, ...nodes);
    li.append(body);
    if (!li.isConnected) this.els.log.append(li);
    if (!streamed) await this.typeOut(body);
    if (this.stopped) {
      li.dataset.done = 'true';
      return li;
    }
    if (r.chart) li.append(this.meter(r.chart.p, r.chart.target));
    for (const c of r.charts ?? []) {
      const chart = document.createElement('chat-chart') as ChatChart;
      chart.item = c;
      li.append(chart);
    }
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
    return li;
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
        const name = input('Scenario name', p0.name);
        read = () => ({ ...p0, name: name.value.trim() || p0.name });
        break;
      }
      case 'dashboard': {
        const name = input('Dashboard name', p0.dashboard.name);
        read = () => ({
          ...p0,
          dashboard: { ...p0.dashboard, name: name.value.trim() || p0.dashboard.name },
        });
        break;
      }
    }
    // Say what the button does: saving a scenario doesn't change the plan.
    const verb =
      p0.kind === 'scenario'
        ? 'Save scenario'
        : p0.kind === 'setup'
          ? 'Change my plan'
          : p0.kind === 'dashboard'
            ? 'Save dashboard'
            : 'Apply';
    const doneText =
      p0.kind === 'scenario'
        ? 'Saved to Scenarios. Your plan is unchanged.'
        : p0.kind === 'setup'
          ? 'Your plan is changed. Run it on Freedom to see the difference.'
          : p0.kind === 'dashboard'
            ? 'Saved. It opens on the Dashboards screen.'
            : 'Applied.';
    const apply = el('button', { type: 'button', class: 'small apply' }, verb);
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
        note.textContent = doneText;
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

/**
 * One answer's activity, as it happens (ADR 0024): Crux's steps as small log
 * bubbles that tick from running to done, and the AI's words streaming into
 * their own bubbles. AI text before a tool call stays as an aside; the last
 * piece becomes the reply.
 */
class LiveLog {
  private readonly steps = new Map<string, HTMLElement>();
  private readonly ai = new Map<string, { li: HTMLElement; text: string; note: boolean }>();
  private readonly order: { li: HTMLElement; text: string; note: boolean }[] = [];
  private readonly runIds: string[] = [];
  private pending = new Set<string>();
  private frame = 0;
  private readonly panel: Conversation;

  constructor(panel: Conversation) {
    this.panel = panel;
  }

  private get log(): HTMLElement {
    return this.panel.els.log;
  }

  on(a: Activity): void {
    switch (a.kind) {
      case 'crux': {
        let li = this.steps.get(a.id);
        if (!li) {
          li = el(
            'li',
            { class: 'msg activity' },
            el('span', { class: 'src' }, 'Crux'),
            el('span', { class: 'text' })
          );
          this.steps.set(a.id, li);
          this.log.append(li);
        }
        li.dataset.state = a.state;
        li.querySelector('.text')!.textContent = a.text;
        break;
      }
      case 'ai': {
        const key = a.note ? `${a.id}-note` : a.id;
        let seg = this.ai.get(key);
        if (!seg) {
          const li = a.note
            ? el(
                'li',
                { class: 'msg ai-note' },
                el('span', { class: 'src' }, a.provider),
                el('span', { class: 'text' })
              )
            : el(
                'li',
                { class: 'msg reply live', 'data-source': 'ai' },
                el('div', { class: 'who' }, el('span', { class: 'ai' }, `Crux + ${a.provider}`)),
                el('div', { class: 'body' })
              );
          seg = { li, text: '', note: !!a.note };
          this.ai.set(key, seg);
          this.order.push(seg);
          this.log.append(li);
        }
        seg.text += a.text;
        this.pending.add(key);
        this.frame ||= requestAnimationFrame(() => this.flush());
        break;
      }
      case 'ai-end':
        this.flush();
        break;
      case 'run':
        this.runIds.push(a.runId);
        break;
    }
    this.panel.scrollDown();
  }

  /** Re-render the streaming bubbles at most once a frame. */
  private flush(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const key of this.pending) {
      const seg = this.ai.get(key)!;
      if (seg.note) seg.li.querySelector('.text')!.textContent = seg.text.trim();
      else
        seg.li
          .querySelector('.body')!
          .replaceChildren(...this.panel.body(seg.text, this.runIds).nodes);
    }
    this.pending.clear();
    this.panel.scrollDown();
  }

  /**
   * The bubble the reply goes into: the last streamed AI text, if it is the
   * reply. Earlier AI text (said before a tool call) becomes an aside.
   */
  finalBubble(r: ChatReply): HTMLElement | null {
    this.flush();
    const texts = this.order.filter((s) => !s.note);
    const last = r.source === 'ai' && !r.cached ? texts.at(-1) : undefined;
    const reuse = last && last.text.trim() === r.text.trim() ? last : undefined;
    for (const s of texts) {
      if (s === reuse) continue;
      if (!s.text.trim()) s.li.remove();
      else {
        s.li.classList.remove('reply', 'live');
        s.li.classList.add('aside');
      }
    }
    return reuse?.li ?? null;
  }

  /** Stopped or failed: keep what arrived, marked as unfinished. */
  stop(): void {
    this.flush();
    for (const s of this.order) {
      s.li.classList.remove('reply', 'live');
      s.li.classList.add('aside');
      if (!s.note) s.li.append(el('p', { class: 'muted small' }, '(stopped before the end)'));
    }
    for (const li of this.steps.values())
      if (li.dataset.state === 'running') li.dataset.state = 'error';
  }
}
