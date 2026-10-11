import { BaseComponent, define } from '../../core/base-component.ts';
import { navigate } from '../../core/router.ts';
import { data, ensureLoaded } from '../../data.ts';
import { day, el } from '../../format.ts';
import { evaluator, runIdOf, simulateSetup } from '../../freedom-inputs.ts';
import type { PoolResult } from '../../sim-pool.ts';
import { addScenario, loadScenarios, openInFreedom, saveScenarios } from '../../scenarios.ts';
import { forecast, sim } from '../../workers.ts';
import type { DataView } from '../../../data/service.ts';
import { deterministicFreedom } from '../../../sim/metrics.ts';
import {
  applySpendingLevers,
  defaultSetup,
  spendingFrom,
  type FreedomSetup,
} from '../../../sim/inputs.ts';
import {
  LEVERS,
  baseValues,
  type LeverId,
  type LeverSpec,
  type LeverValues,
} from '../../../optimise/levers.ts';
import {
  optimise,
  type AsyncCma,
  type Candidate,
  type OptimiseResult,
} from '../../../optimise/optimiser.ts';
import {
  decisionRows,
  differingRows,
  MAX_COMPARE,
  type SavedScenario,
} from '../../../optimise/scenarios.ts';
import { scenarioFrom, asOfFor } from '../../../sim/inputs.ts';
import template from './scenarios-page.html?raw';
import style from './scenarios-page.css?raw';

const pct = (p: number) => `${Math.round(p * 100)} %`;
const aud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});
const LEVER_ORDER: LeverId[] = ['start', 'tierSpend', 'currentSpend', 'projectIncome'];
/** Spending multipliers are shown and entered as percentages. */
const isPct = (id: LeverId) => id === 'tierSpend' || id === 'currentSpend';
const show = (id: LeverId, v: number) =>
  id === 'start'
    ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} years`
    : isPct(id)
      ? pct(v)
      : `${aud.format(v)} a year`;

const workerCma: AsyncCma = {
  init: (x0, s, l) => forecast().cmaInit(x0, s, l),
  ask: (st, z) => forecast().cmaAsk(st, z),
  tell: (st, x, f) => forecast().cmaTell(st, x, f),
};

export class ScenariosPage extends BaseComponent {
  private unsubscribe: (() => void) | null = null;
  private view: DataView | null = null;
  private setup: FreedomSetup | null = null;
  private saved: SavedScenario[] = [];
  private result: OptimiseResult | null = null;
  private cancel = false;
  private busy = false;

  constructor() {
    super(template, style);
  }

  override init(): void {
    for (const a of this.querySelectorAll<HTMLAnchorElement>('a[data-route]')) {
      a.href = import.meta.env.BASE_URL + (a.dataset.route ?? '/').replace(/^\//, '');
    }
    this.$<HTMLFormElement>('.opt-form').onsubmit = (e) => {
      e.preventDefault();
      void this.optimise();
    };
    this.$<HTMLButtonElement>('.cancel').onclick = () => (this.cancel = true);
    this.$<HTMLButtonElement>('.keep-best').onclick = () => {
      const b = this.result?.best;
      if (b) void this.keep(b);
    };
    this.$<HTMLFormElement>('.compare-form').onsubmit = (e) => {
      e.preventDefault();
      void this.compare();
    };
    this.unsubscribe = data.subscribe(() => void this.load());
    void ensureLoaded().then(() => this.load());
  }

  override destroy(): void {
    this.unsubscribe?.();
    this.cancel = true;
  }

  private async load(): Promise<void> {
    const v = data.getState().view;
    if (!v || v === this.view) return;
    this.view = v;
    const has = v.txns.length > 0 || v.budget.lines.length > 0;
    this.$('.empty').hidden = has;
    this.$('.body').hidden = !has;
    if (!has) return;
    this.setup = (await sim().loadSetup()) ?? defaultSetup(v);
    this.saved = await loadScenarios();
    this.renderLevers();
    this.renderSaved();
  }

  // ---- Optimiser ----

  private renderLevers(): void {
    const s = this.setup!;
    const base = baseValues(s);
    const unlockedByDefault = new Set<LeverId>(['start', 'tierSpend']);
    this.$('.levers tbody').replaceChildren(
      ...LEVER_ORDER.map((id) => {
        const def = LEVERS[id];
        const k = isPct(id) ? 100 : 1;
        const lo = Math.min(def.lo, base[id]);
        const hi = Math.max(def.hi, base[id]);
        const unlock = el('input', {
          type: 'checkbox',
          name: `on-${id}`,
          'aria-label': `Unlock ${def.label}`,
        });
        unlock.checked = unlockedByDefault.has(id);
        const num = (name: string, v: number, label: string) =>
          el('input', {
            type: 'number',
            name,
            step: String(def.step * k),
            value: String(+(v * k).toFixed(2)),
            'aria-label': label,
          });
        const row = el(
          'tr',
          {},
          el('td', {}, unlock),
          el('th', { scope: 'row' }, def.label),
          el('td', {}, show(id, base[id])),
          el('td', {}, num(`lo-${id}`, lo, `${def.label} from`)),
          el('td', {}, num(`hi-${id}`, hi, `${def.label} to`))
        );
        const sync = () => row.classList.toggle('locked', !unlock.checked);
        unlock.onchange = sync;
        sync();
        return row;
      })
    );
  }

  private readLevers(): LeverSpec[] {
    const f = this.$<HTMLFormElement>('.opt-form');
    const val = (n: string) => Number((f.elements.namedItem(n) as HTMLInputElement).value);
    return LEVER_ORDER.flatMap((id) => {
      if (!(f.elements.namedItem(`on-${id}`) as HTMLInputElement).checked) return [];
      const k = isPct(id) ? 100 : 1;
      const lo = val(`lo-${id}`) / k;
      const hi = val(`hi-${id}`) / k;
      return Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? [{ id, lo, hi }] : [];
    });
  }

  private async optimise(): Promise<void> {
    const v = this.view;
    const setup = this.setup;
    if (!v || !setup || this.busy) return;
    const f = this.$<HTMLFormElement>('.opt-form');
    const num = (n: string) => Number((f.elements.namedItem(n) as HTMLInputElement).value);
    const levers = this.readLevers();
    const status = this.$('.opt-status');
    if (!levers.length) {
      status.textContent = 'Unlock at least one lever, with "To" above "From".';
      return;
    }
    const target = Math.min(0.99, Math.max(0.5, num('target') / 100));
    const runs = num('runs');
    const budget = num('budget');
    this.busy = true;
    this.cancel = false;
    const button = this.$<HTMLButtonElement>('.optimise');
    button.disabled = true;
    this.$('.cancel').hidden = false;
    this.$('.opt-result').hidden = true;
    try {
      this.result = await optimise(
        { setup, levers, target, budget },
        {
          evaluate: evaluator(v, runs),
          cma: workerCma,
          cancelled: () => this.cancel,
          onProgress: (done, total, best) => {
            status.textContent = `Simulated ${done} of up to ${total} plans × ${runs} runs${best ? `; best so far ${pct(best.pSuccess)} at distance ${best.distance.toFixed(2)}` : ''}…`;
          },
        }
      );
      const r = this.result;
      status.textContent = `${r.candidates.length} plans simulated by ${r.method === 'grid' ? 'grid search' : 'CMA-ES'}, ${runs} runs each, the same futures for every plan.${this.cancel ? ' Stopped early.' : ''}`;
      this.showResult();
    } catch (err) {
      status.textContent = `Optimiser failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.busy = false;
      button.disabled = false;
      this.$('.cancel').hidden = true;
    }
  }

  private describe(values: LeverValues): string[] {
    const base = baseValues(this.setup!);
    const out: string[] = [];
    if (Math.abs(values.start - base.start) >= 1 / 24) {
      const y = Math.round(values.start * 12) / 12;
      out.push(`freedom ${Math.abs(y).toFixed(1)} years ${y > 0 ? 'later' : 'sooner'}`);
    }
    if (Math.abs(values.tierSpend - base.tierSpend) >= 0.005)
      out.push(`spend ${pct(values.tierSpend)} of the tier after freedom`);
    if (Math.abs(values.currentSpend - base.currentSpend) >= 0.005)
      out.push(`spend ${pct(values.currentSpend)} of today's spending until then`);
    if (Math.abs(values.projectIncome - base.projectIncome) >= 50)
      out.push(`earn ${aud.format(values.projectIncome)} a year from projects`);
    return out;
  }

  private showResult(): void {
    const r = this.result;
    if (!r) return;
    this.$('.opt-result').hidden = false;
    const answer = this.$('.answer');
    const keep = this.$<HTMLButtonElement>('.keep-best');
    const cite = (c: Candidate) => el('span', { class: 'runid' }, ` (runs ${c.runId})`);
    if (r.best === r.base) {
      answer.replaceChildren(
        `Your plan already reaches ${pct(r.target)}: `,
        el('strong', {}, pct(r.base.pSuccess)),
        cite(r.base)
      );
      keep.hidden = true;
    } else if (!r.best) {
      const closest = [...r.candidates].sort((a, b) => b.pSuccess - a.pSuccess)[0]!;
      answer.replaceChildren(
        `No plan within these bounds reaches ${pct(r.target)}. The most likely: ${this.describe(closest.values).join(', ') || 'your plan as it is'}, at `,
        el('strong', {}, pct(closest.pSuccess)),
        cite(closest),
        '. Try wider bounds or more levers.'
      );
      keep.hidden = true;
    } else {
      answer.replaceChildren(
        'Smallest change: ',
        el('strong', {}, this.describe(r.best.values).join(', ')),
        `. Chance of success ${pct(r.base.pSuccess)} → `,
        el('strong', {}, pct(r.best.pSuccess)),
        cite(r.best),
        '.'
      );
      keep.hidden = false;
    }
    this.$('.pareto tbody').replaceChildren(
      ...r.pareto.map((c) => {
        const b = el('button', { type: 'button', class: 'secondary small' }, 'Keep');
        b.onclick = () => void this.keep(c);
        return el(
          'tr',
          { class: c === r.best ? 'best' : '' },
          el('td', {}, `${c.setup.goal.start.slice(0, 7)} (${show('start', c.values.start)})`),
          el('td', { class: 'num' }, pct(c.values.tierSpend)),
          el('td', { class: 'num' }, pct(c.values.currentSpend)),
          el('td', { class: 'num' }, aud.format(c.values.projectIncome)),
          el('td', { class: `num ${c.feasible ? 'ok' : ''}` }, pct(c.pSuccess)),
          el('td', { class: 'runid' }, c.runId),
          el('td', {}, b)
        );
      })
    );
  }

  private async keep(c: Candidate): Promise<void> {
    const name = this.describe(c.values).join(', ') || 'Current plan';
    await addScenario(name.charAt(0).toUpperCase() + name.slice(1), c.setup, 'optimiser', c.runId);
    this.saved = await loadScenarios();
    this.renderSaved();
    this.$('.opt-status').textContent = `Kept "${name}" in saved scenarios.`;
  }

  // ---- Saved scenarios and comparison ----

  private renderSaved(): void {
    this.$('.saved .none').hidden = this.saved.length > 0;
    this.$('.saved table').hidden = this.saved.length === 0;
    this.$('.compare-form').hidden = this.saved.length === 0;
    const boxes: HTMLInputElement[] = [];
    const limit = () => {
      const n = boxes.filter((b) => b.checked).length;
      for (const b of boxes) b.disabled = !b.checked && n >= MAX_COMPARE;
    };
    this.$('.list tbody').replaceChildren(
      ...this.saved.map((s, i) => {
        const pick = el('input', {
          type: 'checkbox',
          value: s.id,
          'aria-label': `Compare ${s.name}`,
        });
        pick.checked = i < 2;
        pick.onchange = limit;
        boxes.push(pick);
        const name = el('input', { type: 'text', value: s.name, 'aria-label': 'Scenario name' });
        name.onchange = () => {
          s.name = name.value.trim() || s.name;
          void saveScenarios(this.saved);
        };
        const open = el('button', { type: 'button', class: 'secondary small' }, 'Open in Freedom');
        open.onclick = async () => {
          await openInFreedom(s);
          navigate('/freedom');
        };
        const del = el('button', { type: 'button', class: 'secondary small' }, 'Delete');
        del.onclick = async () => {
          this.saved = this.saved.filter((x) => x !== s);
          await saveScenarios(this.saved);
          this.renderSaved();
        };
        return el(
          'tr',
          {},
          el('td', {}, pick),
          el('td', {}, name),
          el('td', {}, s.source === 'optimiser' ? 'Optimiser' : 'Freedom screen'),
          el('td', {}, day(s.createdAt.slice(0, 10))),
          el('td', {}, open, ' ', del)
        );
      })
    );
    limit();
  }

  private async compare(): Promise<void> {
    const v = this.view;
    if (!v || this.busy) return;
    const ids = [
      ...this.querySelectorAll<HTMLInputElement>('.list tbody input[type="checkbox"]:checked'),
    ].map((b) => b.value);
    const picked = this.saved.filter((s) => ids.includes(s.id)).slice(0, MAX_COMPARE);
    const status = this.$('.cmp-status');
    if (!picked.length) {
      status.textContent = 'Tick up to four scenarios to compare.';
      return;
    }
    const runs = Number(
      (this.$<HTMLFormElement>('.compare-form').elements.namedItem('runs') as HTMLSelectElement)
        .value
    );
    this.busy = true;
    const button = this.$<HTMLButtonElement>('.compare');
    button.disabled = true;
    try {
      const results: PoolResult[] = [];
      for (const [i, s] of picked.entries()) {
        status.textContent = `Simulating ${i + 1} of ${picked.length}…`;
        results.push(await simulateSetup(v, s.setup, runs, true));
      }
      const setups = picked.map((s) => s.setup);
      const rows = decisionRows(setups);
      const diff = differingRows(rows);
      const asOf = asOfFor(v.txns);
      const det = setups.map((s) =>
        deterministicFreedom(
          scenarioFrom(s, asOf, v.budget.settings.cpi),
          applySpendingLevers(spendingFrom(v, s.goal.tier), s.levers)
        )
      );
      const end = (k: 'p10' | 'p50' | 'p90') =>
        results.map((r) => aud.format(r.capital[k].at(-1) ?? 0));
      const resultRows: [string, (Node | string)[]][] = [
        [
          'Chance of success',
          results.map((r, i) => {
            const ok = r.pSuccess >= setups[i]!.goal.targetProbability;
            return el('strong', { class: ok ? 'ok' : 'bad' }, pct(r.pSuccess));
          }),
        ],
        ['Capital at the end, P10', end('p10')],
        ['Capital at the end, P50', end('p50')],
        ['Capital at the end, P90', end('p90')],
        ['Freedom number (assumed)', det.map((d) => aud.format(d.freedomNumber))],
        ['Runs', results.map((r) => el('span', { class: 'runid' }, runIdOf(r)))],
      ];
      this.$('.compare-table thead').replaceChildren(
        el(
          'tr',
          {},
          el('th', { scope: 'col' }, ''),
          ...picked.map((s) => el('th', { scope: 'col' }, s.name))
        )
      );
      this.$('.compare-table tbody').replaceChildren(
        ...rows.map(([label, vals], i) =>
          el(
            'tr',
            { class: diff.has(i) ? 'differs' : '' },
            el('th', { scope: 'row' }, label),
            ...vals.map((x) => el('td', {}, x))
          )
        ),
        ...resultRows.map(([label, vals], i) =>
          el(
            'tr',
            { class: i === 0 ? 'result' : '' },
            el('th', { scope: 'row' }, label),
            ...vals.map((x) => el('td', {}, x))
          )
        )
      );
      this.$('.comparison').hidden = false;
      status.textContent = `${picked.length} scenarios, ${runs} runs each, the same futures for all.`;
    } catch (err) {
      status.textContent = `Comparison failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.busy = false;
      button.disabled = false;
    }
  }
}

define('scenarios-page', ScenariosPage);
