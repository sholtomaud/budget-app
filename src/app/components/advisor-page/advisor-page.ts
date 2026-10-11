import { BaseComponent, define } from '../../core/base-component.ts';
import { data, ensureLoaded } from '../../data.ts';
import { el } from '../../format.ts';
import { AdvisorSession, type AdvisorMessage } from '../../advisor.ts';
import { activeProvider } from '../../egress.ts';
import template from './advisor-page.html?raw';
import style from './advisor-page.css?raw';

const TOOL_LABEL: Record<string, string> = {
  get_plan: 'read your plan',
  get_spending_summary: 'read your spending summary',
  list_scenarios: 'listed your scenarios',
  run_plan: 'ran a simulation',
  propose_plan: 'saved a proposed plan to Scenarios',
  explain_assumption: 'looked up an assumption',
};

/** The optional advisor (SPEC §13.3). The conversation is not stored. */
export class AdvisorPage extends BaseComponent {
  private session: AdvisorSession | null = null;

  constructor() {
    super(template, style);
  }

  override init(): void {
    for (const a of this.querySelectorAll<HTMLAnchorElement>('a[data-route]'))
      a.href = import.meta.env.BASE_URL + (a.dataset.route ?? '/').replace(/^\//, '');
    const form = this.$<HTMLFormElement>('.ask');
    const q = this.$<HTMLTextAreaElement>('textarea');
    for (const b of this.querySelectorAll<HTMLButtonElement>('.ex'))
      b.onclick = () => {
        q.value = b.textContent ?? '';
        q.focus();
      };
    form.onsubmit = (e) => {
      e.preventDefault();
      void this.ask(q.value.trim());
    };
    void this.checkProvider();
  }

  private async checkProvider(): Promise<void> {
    const ap = await activeProvider();
    const note = this.$('.setup-note');
    note.hidden = ap.ok;
    if (!ap.ok) this.$('.reason').textContent = ap.reason;
  }

  private add(m: AdvisorMessage | { role: 'user'; text: string }): void {
    const li = el('li', { class: `msg ${m.role}` }, m.text || '(no answer)');
    if (m.role === 'advisor') {
      const a = m as AdvisorMessage;
      const meta = el('div', { class: 'meta' });
      if (a.tools.length)
        meta.append(`It ${[...new Set(a.tools.map((t) => TOOL_LABEL[t] ?? t))].join(', ')}. `);
      if (a.runIds.length) meta.append(`Runs: ${[...new Set(a.runIds)].join('; ')}. `);
      if (a.unverified.length)
        meta.append(
          el(
            'span',
            { class: 'unverified' },
            `Unverified figure${a.unverified.length > 1 ? 's' : ''}: ${a.unverified.join(', ')}. No tool returned ${a.unverified.length > 1 ? 'these' : 'this'}; don't rely on ${a.unverified.length > 1 ? 'them' : 'it'}.`
          )
        );
      li.append(meta);
    }
    this.$('.log').append(li);
  }

  private async ask(question: string): Promise<void> {
    if (!question) return;
    const status = this.$('.status');
    const send = this.$<HTMLButtonElement>('.send');
    await ensureLoaded();
    const view = () => data.getState().view!;
    this.session ??= new AdvisorSession(view);
    this.add({ role: 'user', text: question });
    this.$<HTMLTextAreaElement>('textarea').value = '';
    send.disabled = true;
    status.textContent = 'Thinking…';
    try {
      const reply = await this.session.ask(question, (tool) => {
        status.textContent = `Working: ${TOOL_LABEL[tool] ?? tool}…`;
      });
      this.add(reply);
      status.textContent = '';
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      send.disabled = false;
      void this.checkProvider();
    }
  }
}

define('advisor-page', AdvisorPage);
