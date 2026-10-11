import { BaseComponent, define } from '../../core/base-component.ts';
import { data, ensureLoaded } from '../../data.ts';
import { el, money, prov } from '../../format.ts';
import { forecast } from '../../workers.ts';
import '../fan-chart/fan-chart.ts';
import type { FanChart, FanData } from '../fan-chart/fan-chart.ts';
import { weeklyRate } from '../../../budget/model.ts';
import { perWeek } from '../../../budget/periods.ts';
import { categoryName } from '../../../classify/categories.ts';
import type { CapexForecast } from '../../../forecast/capex.ts';
import { inflate, type OpexForecast, type Quantiles } from '../../../forecast/opex.ts';
import { monthlySeries } from '../../../forecast/series.ts';
import { addMonths } from '../../../lib/dates.ts';
import template from './forecast-page.html?raw';
import style from './forecast-page.css?raw';

const METHOD_LABEL: Record<string, string> = {
  'seasonal-naive': 'Seasonal naive',
  naive: 'Naive',
  mean: 'Historical mean',
  'ets-additive-damped': 'Holt-Winters (damped)',
  'holt-damped': 'Holt (damped trend)',
  croston: 'Croston',
  sba: 'Croston (SBA)',
  tsb: 'TSB',
  budget: 'Budget line',
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export class ForecastPage extends BaseComponent {
  private unsubscribe: (() => void) | null = null;
  private last: { opex: OpexForecast; capex: CapexForecast } | null = null;
  private runId = 0;
  private lastKey = '';

  constructor() {
    super(template, style);
  }

  override init(): void {
    for (const a of this.querySelectorAll<HTMLAnchorElement>('a[data-route]')) {
      a.href = import.meta.env.BASE_URL + (a.dataset.route ?? '/').replace(/^\//, '');
    }
    const f = this.$<HTMLFormElement>('.controls');
    f.onchange = (e) => {
      const name = (e.target as HTMLInputElement).name;
      if (name === 'dollars') this.draw();
      else void this.run(true);
    };
    this.unsubscribe = data.subscribe(() => void this.run(false));
    void ensureLoaded().then(() => this.run(false));
  }

  override destroy(): void {
    this.unsubscribe?.();
  }

  private async run(force: boolean): Promise<void> {
    const v = data.getState().view;
    if (!v) return;
    const f = this.$<HTMLFormElement>('.controls');
    const tierSel = f.elements.namedItem('tier') as HTMLSelectElement;
    if (!tierSel.options.length) {
      for (const t of v.budget.tiers)
        tierSel.append(new Option(t.name, t.id, t.id === 'independent', t.id === 'independent'));
    }
    this.$('.cpi').textContent = `${(v.budget.settings.cpi * 100).toFixed(1)} %`;
    const has = v.txns.length > 0 || v.budget.lines.length > 0;
    this.$('.empty').hidden = has;
    if (!has) return;
    const horizon = Number((f.elements.namedItem('horizon') as HTMLSelectElement).value);
    const tier = tierSel.value;
    const key = `${v.txns.length}|${v.imports.length}|${v.assets.length}|${v.budget.lines.length}|${horizon}|${tier}|${v.userLabelled.length}|${v.rules.length}|${v.memory.length}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    const id = ++this.runId;
    this.$('.status').textContent = 'Forecasting…';
    const history = monthlySeries(v.txns);
    const budgetMonthly: Record<string, number> = {};
    for (const l of v.budget.lines) {
      budgetMonthly[l.categoryId] =
        (budgetMonthly[l.categoryId] ?? 0) +
        (weeklyRate(l, tier, (c) => perWeek(c, v.budget.periods)) * 52) / 12;
    }
    const start = history[0]?.months.length
      ? addMonths(`${history[0].months.at(-1)}-01`, 1)
      : `${new Date().toISOString().slice(0, 7)}-01`;
    const [kernel, opex, capex] = await Promise.all([
      forecast().kernels(),
      forecast().opex(history, budgetMonthly, { horizon, seed: '42' }),
      forecast().capex(v.assets, { start, horizon, seed: '42' }),
    ]);
    if (id !== this.runId) return;
    this.last = { opex, capex };
    this.$('.status').textContent =
      `${opex.series.length} categories forecast from ${history[0]?.months.length ?? 0} months of history (kernels: ${kernel === 'ml-core' ? 'ml-core, WebAssembly' : 'TypeScript'}).`;
    this.draw();
  }

  private draw(): void {
    const v = data.getState().view;
    if (!this.last || !v) return;
    const { opex, capex } = this.last;
    const nominal =
      (this.$<HTMLFormElement>('.controls').elements.namedItem('dollars') as RadioNodeList)
        .value === 'nominal';
    const cpi = v.budget.settings.cpi;
    const adj = (q: Quantiles): Quantiles =>
      nominal
        ? (Object.fromEntries(
            Object.entries(q).map(([k, xs]) => [k, inflate(xs, cpi)])
          ) as Quantiles)
        : q;
    const fan = (
      label: string,
      history: { months: string[]; values: number[] },
      months: string[],
      q: Quantiles,
      provenance: string
    ): FanData => ({ label, history, months, quantiles: adj(q), provenance });
    const totalHistory = (() => {
      const months = opex.series.find((s) => s.history.months.length)?.history.months ?? [];
      return {
        months,
        values: months.map((_, i) => sum(opex.series.map((s) => s.history.values[i] ?? 0))),
      };
    })();
    this.$('.tops').hidden = false;
    this.$<FanChart>('fan-chart.total').data = fan(
      'Operating spend per month',
      totalHistory,
      opex.months,
      opex.total,
      'forecast'
    );
    const t12 = (q: number[]) =>
      sum(adj({ p5: q, p10: q, p25: q, p50: q, p75: q, p90: q, p95: q }).p50.slice(0, 12));
    this.$('.total-note').textContent =
      `Next 12 months: ${money(BigInt(Math.round(t12(opex.total.p50))))} at the median${nominal ? ', in dollars of the day' : ", in today's dollars"}. Categories are assumed independent.`;
    this.$<FanChart>('fan-chart.capex').data = fan(
      'Capital spend, cumulative',
      { months: [], values: [] },
      capex.months,
      capex.cumulative,
      'forecast'
    );
    this.$('.capex-note').textContent = v.assets.length
      ? `From ${v.assets.length} items in the CAPEX register, ${capex.runs.toLocaleString('en-AU')} simulated futures.`
      : 'The CAPEX register is empty, so no capital spend is forecast.';

    this.$('.table-card').hidden = opex.series.length === 0;
    const rows = [...opex.series].sort(
      (a, b) => sum(b.quantiles.p50.slice(0, 12)) - sum(a.quantiles.p50.slice(0, 12))
    );
    this.$('.methods tbody').replaceChildren(
      ...rows.map((s) => {
        const q = adj(s.quantiles);
        const next = (xs: number[]) => money(BigInt(Math.round(sum(xs.slice(0, 12)))));
        return el(
          'tr',
          { 'data-category': s.categoryId },
          el('th', { scope: 'row' }, categoryName(s.categoryId, v.categories)),
          el('td', {}, METHOD_LABEL[s.method] ?? s.method, ' ', prov(s.provenance)),
          el('td', { class: 'num' }, s.chosenMase === null ? '–' : s.chosenMase.toFixed(2)),
          el('td', { class: 'num' }, s.naiveMase === null ? '–' : s.naiveMase.toFixed(2)),
          el('td', { class: 'num' }, next(q.p50)),
          el('td', { class: 'num' }, `${next(q.p10)} – ${next(q.p90)}`)
        );
      })
    );
    this.$('.fans').replaceChildren(
      ...rows.map((s) => {
        const chart = document.createElement('fan-chart') as FanChart;
        const card = el(
          'article',
          { class: 'card', 'data-category': s.categoryId },
          el('h3', {}, categoryName(s.categoryId, v.categories)),
          el(
            'p',
            { class: 'meta' },
            `${METHOD_LABEL[s.method] ?? s.method}${s.chosenMase !== null ? ` · MASE ${s.chosenMase.toFixed(2)}` : ''}`
          ),
          chart
        );
        chart.data = fan(
          categoryName(s.categoryId, v.categories),
          s.history,
          s.months,
          s.quantiles,
          s.provenance
        );
        return card;
      })
    );
  }
}

define('forecast-page', ForecastPage);
