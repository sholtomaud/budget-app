import { BaseComponent, define } from '../../core/base-component.ts';
import { navigate } from '../../core/router.ts';
import { data, ensureLoaded, loadSynthetic } from '../../data.ts';
import { count } from '../../format.ts';
import { sim, synth } from '../../workers.ts';
import type { PersonaSummary } from '../../../workers/synth.worker.ts';
import template from './start-page.html?raw';
import style from './start-page.css?raw';

export class StartPage extends BaseComponent {
  private unsubscribe: (() => void) | null = null;

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
    void this.setupSynth();
    this.unsubscribe = data.subscribe(() => this.renderLoaded());
    void ensureLoaded().then(() => this.renderLoaded());
  }

  override destroy(): void {
    this.unsubscribe?.();
  }

  private renderLoaded(): void {
    const v = data.getState().view;
    const p = this.$('.loaded');
    p.hidden = !v || v.txns.length === 0;
    if (v)
      p.textContent = `Loaded: ${count(v.txns.length)} transactions in ${count(v.accounts.length)} accounts from ${count(v.imports.length)} import${v.imports.length === 1 ? '' : 's'}.`;
  }

  private async setupSynth(): Promise<void> {
    const form = this.$<HTMLFormElement>('.synth-form');
    const select = form.querySelector<HTMLSelectElement>('select')!;
    const desc = this.$('.persona-desc');
    const status = this.$('.synth-status');
    let personas: PersonaSummary[] = [];
    try {
      personas = await synth().personas();
    } catch (e) {
      status.textContent = `Synthetic data is unavailable: ${(e as Error).message}`;
      return;
    }
    select.replaceChildren(
      ...personas.map((p) => new Option(p.name, p.name, p.name === 'default', p.name === 'default'))
    );
    const describe = () => {
      const p = personas.find((x) => x.name === select.value);
      desc.textContent = p ? `${p.description} ${p.months} months from ${p.start}.` : '';
    };
    select.onchange = describe;
    describe();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const button = form.querySelector('button')!;
      const seed = (form.elements.namedItem('seed') as HTMLInputElement).value.trim();
      button.disabled = true;
      status.textContent = 'Generating…';
      try {
        const rec = await loadSynthetic(select.value, seed);
        status.textContent = `Loaded ${count(rec.counts.new)} records.`;
        navigate('/import');
      } catch (err) {
        status.textContent = `Failed: ${(err as Error).message}`;
      } finally {
        button.disabled = false;
      }
    };
  }
}

define('start-page', StartPage);
