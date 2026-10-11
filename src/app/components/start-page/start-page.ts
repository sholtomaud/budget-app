import { BaseComponent, define } from '../../core/base-component.ts';
import { navigate } from '../../core/router.ts';
import { data, ensureLoaded, loadSynthetic } from '../../data.ts';
import { count } from '../../format.ts';
import { guideStore, nextStep, restartGuide } from '../../guide.ts';
import { publicPath } from '../../core/routes.ts';
import { sim, synth } from '../../workers.ts';
import type { PersonaSummary } from '../../../workers/synth.worker.ts';
import template from './start-page.html?raw';
import style from './start-page.css?raw';

/** Friendly names for the synthetic households (the persona file names stay as ids). */
const PERSONA_LABEL: Record<string, string> = {
  default: 'Renting, one salary',
  'frugal-renter': 'Frugal renter',
  'high-capex-crypto': 'High earner, big purchases, crypto',
};

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
    this.$<HTMLButtonElement>('.restart').onclick = () => restartGuide();
    this.$<HTMLAnchorElement>('.next-link').onclick = (e) => {
      e.preventDefault();
      navigate(this.$<HTMLAnchorElement>('.next-link').dataset.path ?? '/ledger');
    };
    const offGuide = guideStore.subscribe(() => this.renderLoaded());
    const offData = data.subscribe(() => this.renderLoaded());
    this.unsubscribe = () => {
      offGuide();
      offData();
    };
    void ensureLoaded().then(() => this.renderLoaded());
  }

  override destroy(): void {
    this.unsubscribe?.();
  }

  private renderLoaded(): void {
    const v = data.getState().view;
    const has = !!v && (v.txns.length > 0 || v.budget.lines.length > 0);
    this.$('.continue').hidden = !has;
    if (!v || !has) return;
    this.$('.loaded').textContent =
      `You have ${count(v.txns.length)} transactions in ${count(v.accounts.length)} account${v.accounts.length === 1 ? '' : 's'}.`;
    const next = nextStep(true, guideStore.getState().visited) ?? {
      title: 'See your transactions',
      path: '/ledger',
    };
    this.$('.next-step').textContent = `Next: ${next.title}.`;
    const link = this.$<HTMLAnchorElement>('.next-link');
    link.href = publicPath(next.path, import.meta.env.BASE_URL);
    link.dataset.path = next.path;
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
      ...personas.map(
        (p) =>
          new Option(
            PERSONA_LABEL[p.name] ?? p.name,
            p.name,
            p.name === 'default',
            p.name === 'default'
          )
      )
    );
    const describe = () => {
      const p = personas.find((x) => x.name === select.value);
      // Persona files cite the spec; that's for developers, not the landing page.
      desc.textContent = p
        ? `${p.description.replace(/\s*\(SPEC[^)]*\)/g, '')} ${Math.round(p.months / 12)} years of bank data.`
        : '';
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
