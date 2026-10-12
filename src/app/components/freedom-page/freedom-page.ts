import { BaseComponent, define } from '../../core/base-component.ts';
import { data, ensureLoaded } from '../../data.ts';
import { el, prov } from '../../format.ts';
import { poolRunner, poolSize, runPool, type PoolResult } from '../../sim-pool.ts';
import { sim } from '../../workers.ts';
import { creditsNote, inputsFor, loadHistories } from '../../freedom-inputs.ts';
import { historyModel } from '../../../sim/history.ts';
import { addScenario } from '../../scenarios.ts';
import '../fan-chart/fan-chart.ts';
import type { FanChart } from '../fan-chart/fan-chart.ts';
import type { DataView } from '../../../data/service.ts';
import { addMonths } from '../../../lib/dates.ts';
import { defaultSetup, type FreedomSetup } from '../../../sim/inputs.ts';
import {
  deterministicFreedom,
  p90Freedom,
  projectRunway,
  shortfallDrivers,
  yearsToFreedom,
} from '../../../sim/metrics.ts';
import {
  DEFAULT_MODEL_FOR,
  type AssetClass,
  type Holding,
  type ReturnModel,
  type Scenario,
  type SpendingInput,
  type WithdrawalStrategy,
} from '../../../sim/model.ts';
import { taxProvenance, taxTable } from '../../../sim/tax.ts';
import { setPageDetail } from '../../page-context.ts';
import template from './freedom-page.html?raw';
import style from './freedom-page.css?raw';

const CLASSES: [AssetClass, string][] = [
  ['cash', 'Cash'],
  ['term_deposit', 'Term deposit'],
  ['equity', 'Shares'],
  ['btc', 'Bitcoin'],
  ['super', 'Super'],
  ['property', 'Property'],
  ['other', 'Other'],
];

const aud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});
const pct = (p: number) => `${(p * 100).toFixed(p > 0.995 && p < 1 ? 1 : 0)} %`;
const dollars = (minor: bigint) => Number(minor) / 100;
const minor = (d: number) => BigInt(Math.round(d * 100));
const years = (y: number | null) => (y === null ? 'not reached' : `${y.toFixed(1)} years`);

export class FreedomPage extends BaseComponent {
  private unsubscribe: (() => void) | null = null;
  private setup: FreedomSetup | null = null;
  /** Bootstrap models over the user's imported price histories. */
  private historyModels: ReturnModel[] = [];
  private view: DataView | null = null;
  private main: { result: PoolResult; scenario: Scenario; spending: SpendingInput } | null = null;
  private runId = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super(template, style);
  }

  override init(): void {
    for (const a of this.querySelectorAll<HTMLAnchorElement>('a[data-route]')) {
      a.href = import.meta.env.BASE_URL + (a.dataset.route ?? '/').replace(/^\//, '');
    }
    const goal = this.$<HTMLFormElement>('.goal');
    goal.onsubmit = (e) => e.preventDefault();
    goal.onchange = () => this.readGoal();
    const run = this.$<HTMLFormElement>('.run');
    run.onsubmit = (e) => {
      e.preventDefault();
      void this.simulate();
    };
    this.$<HTMLButtonElement>('.add-holding').onclick = () => {
      if (!this.setup) return;
      const id = `h-${Date.now().toString(36)}`;
      this.setup.holdings.push({
        id,
        name: 'New holding',
        assetClass: 'equity',
        value: 0n,
        returnModelId: DEFAULT_MODEL_FOR.equity,
        owner: 'p1',
        provenance: 'actual',
      });
      this.setup.decisions.sellOrder.push(id);
      this.changed();
      this.renderHoldings();
    };
    this.$<HTMLButtonElement>('.reset').onclick = () => {
      if (!this.view) return;
      this.setup = defaultSetup(this.view);
      this.changed();
      this.fill();
    };
    this.$<HTMLButtonElement>('.find-p90').onclick = () => void this.findP90();
    this.$<HTMLButtonElement>('.save-scenario').onclick = () => void this.saveScenario();
    this.$<HTMLButtonElement>('.drivers-run').onclick = () => void this.drivers();
    this.unsubscribe = data.subscribe(() => void this.load());
    void ensureLoaded().then(() => this.load());
  }

  override destroy(): void {
    this.unsubscribe?.();
    this.runId++;
  }

  private async load(): Promise<void> {
    const v = data.getState().view;
    if (!v || v === this.view) return;
    this.view = v;
    const has = v.txns.length > 0 || v.budget.lines.length > 0;
    this.$('.empty').hidden = has;
    this.$('.setup').hidden = !has;
    if (!has) return;
    this.setup ??= (await sim().loadSetup()) ?? defaultSetup(v);
    this.historyModels = (await loadHistories()).map(historyModel);
    this.fill();
  }

  private field<T extends HTMLInputElement | HTMLSelectElement>(form: string, name: string): T {
    return this.$<HTMLFormElement>(form).elements.namedItem(name) as T;
  }

  /** Setup → form. */
  private fill(): void {
    const s = this.setup;
    const v = this.view;
    if (!s || !v) return;
    const tier = this.field<HTMLSelectElement>('.goal', 'tier');
    tier.replaceChildren(...v.budget.tiers.map((t) => new Option(t.name, t.id)));
    tier.value = s.goal.tier;
    const set = (name: string, value: string) => {
      this.field<HTMLInputElement>('.goal', name).value = value;
    };
    set('start', s.goal.start.slice(0, 7));
    set('horizon', String(s.goal.horizonYears));
    set('floor', String(dollars(s.goal.floor)));
    set('target', String(Math.round(s.goal.targetProbability * 100)));
    set('project', String(dollars(s.goal.projectIncome ?? 0n)));
    set('tierSpend', String(Math.round((s.levers?.tierSpend ?? 1) * 100)));
    set('currentSpend', String(Math.round((s.levers?.currentSpend ?? 1) * 100)));
    set('netPay', String(Math.round(dollars(s.decisions.netPayMonthly ?? 0n))));
    set('workUntil', s.decisions.workUntil?.slice(0, 7) ?? '');
    set('gross1', String(Math.round(dollars(s.people[0]?.grossSalary ?? 0n))));
    set('gross2', String(Math.round(dollars(s.people[1]?.grossSalary ?? 0n))));
    set('buffer', String(Math.round(dollars(s.decisions.bankBuffer))));
    const w = s.decisions.withdrawal;
    set('strategy', w.kind);
    set(
      'rate',
      String(
        w.kind === 'percent'
          ? w.rate * 100
          : w.kind === 'guardrails'
            ? (w.initialRate ?? 0.04) * 100
            : 4
      )
    );
    set('band', String(w.kind === 'guardrails' ? w.band * 100 : 20));
    set('adjust', String(w.kind === 'guardrails' ? w.adjust * 100 : 10));
    set('minSpend', String(w.kind === 'guardrails' ? w.minSpendFraction * 100 : 80));
    set('threshold', String(w.kind === 'skim' ? w.threshold * 100 : 2));
    set('tax', s.taxTable ?? '');
    this.field<HTMLInputElement>('.goal', 'returnUncertainty').checked =
      s.returnUncertainty ?? true;
    this.field<HTMLInputElement>('.run', 'seed').value = s.seed;
    this.showStrategyParams();
    this.taxNote();
    this.renderHoldings();
  }

  private async saveScenario(): Promise<void> {
    const s = this.setup;
    if (!s) return;
    this.readGoal();
    const nameField = this.field<HTMLInputElement>('.run', 'scenarioName');
    const name =
      nameField.value.trim() || `${this.tierName(s.goal.tier)} from ${s.goal.start.slice(0, 7)}`;
    await addScenario(name, s, 'freedom');
    nameField.value = '';
    this.$('.status').textContent = `Saved "${name}". Compare it on the Scenarios screen.`;
  }

  private showStrategyParams(): void {
    const k = this.field<HTMLSelectElement>('.goal', 'strategy').value;
    for (const e of this.querySelectorAll<HTMLElement>('.p-rate'))
      e.hidden = k !== 'percent' && k !== 'guardrails';
    for (const e of this.querySelectorAll<HTMLElement>('.p-band')) e.hidden = k !== 'guardrails';
    for (const e of this.querySelectorAll<HTMLElement>('.p-skim')) e.hidden = k !== 'skim';
  }

  private taxNote(): void {
    const s = this.setup;
    if (!s) return;
    const n = this.$('.tax-note');
    if (!s.taxTable) {
      n.replaceChildren('Tax is off: results are before tax, as a simple spreadsheet would show.');
      return;
    }
    const t = taxTable(s.taxTable);
    n.replaceChildren(
      `Tax: ${t.jurisdiction} ${t.financialYear} resident rates, Medicare levy and the CGT discount, held constant in today's dollars for later years. `,
      prov(taxProvenance(t)),
      t.verifiedBy ? '' : ' Not yet checked against the ATO by a maintainer.'
    );
  }

  /** Form → setup. */
  private readGoal(): void {
    const s = this.setup;
    if (!s) return;
    const num = (name: string) => Number(this.field<HTMLInputElement>('.goal', name).value);
    const str = (name: string) => this.field<HTMLInputElement>('.goal', name).value;
    s.goal = {
      ...s.goal,
      tier: str('tier'),
      start: str('start') ? `${str('start')}-01` : s.goal.start,
      horizonYears: Math.max(1, Math.round(num('horizon') || 1)),
      floor: minor(Math.max(0, num('floor'))),
      targetProbability: Math.min(0.99, Math.max(0.5, num('target') / 100 || 0.9)),
      projectIncome: minor(Math.max(0, num('project'))),
    };
    s.levers = {
      tierSpend: Math.max(0.3, num('tierSpend') / 100 || 1),
      currentSpend: Math.max(0.3, num('currentSpend') / 100 || 1),
    };
    const workUntil = str('workUntil');
    s.decisions = {
      ...s.decisions,
      netPayMonthly: minor(Math.max(0, num('netPay'))),
      workUntil: workUntil ? `${workUntil}-01` : undefined,
      bankBuffer: minor(Math.max(0, num('buffer'))),
      withdrawal: this.readStrategy(),
    };
    const g2 = num('gross2');
    s.people = [
      {
        id: 'p1',
        name: s.people[0]?.name ?? 'You',
        grossSalary: minor(Math.max(0, num('gross1'))),
      },
      ...(g2 > 0
        ? [{ id: 'p2' as const, name: s.people[1]?.name ?? 'Partner', grossSalary: minor(g2) }]
        : []),
    ];
    s.taxTable = str('tax') || null;
    s.returnUncertainty = this.field<HTMLInputElement>('.goal', 'returnUncertainty').checked;
    this.showStrategyParams();
    this.taxNote();
    this.changed();
  }

  private readStrategy(): WithdrawalStrategy {
    const num = (name: string) => Number(this.field<HTMLInputElement>('.goal', name).value);
    const kind = this.field<HTMLSelectElement>('.goal', 'strategy').value;
    switch (kind) {
      case 'percent':
        return { kind, rate: Math.max(0.01, num('rate') / 100) };
      case 'guardrails':
        return {
          kind,
          initialRate: Math.max(0.01, num('rate') / 100),
          band: num('band') / 100,
          adjust: num('adjust') / 100,
          minSpendFraction: num('minSpend') / 100,
        };
      case 'skim':
        return { kind, threshold: num('threshold') / 100 };
      case 'hold':
        return {
          kind,
          holdingIds:
            this.setup?.holdings.filter((h) => h.assetClass === 'btc').map((h) => h.id) ?? [],
        };
      default:
        return { kind: 'fixed-real' };
    }
  }

  private renderHoldings(): void {
    const s = this.setup;
    if (!s) return;
    const body = this.$('.holdings tbody');
    const held = s.decisions.withdrawal.kind === 'hold' ? s.decisions.withdrawal.holdingIds : [];
    body.replaceChildren(
      ...s.holdings.map((h) => {
        const update = (patch: Partial<Holding>) => {
          Object.assign(h, patch);
          this.changed();
        };
        const name = el('input', { type: 'text', value: h.name, 'aria-label': 'Holding name' });
        name.onchange = () => update({ name: name.value.trim() || h.name });
        const cls = el('select', { 'aria-label': `Kind of ${h.name}` });
        cls.append(
          ...CLASSES.map(([id, label]) => new Option(label, id, false, id === h.assetClass))
        );
        cls.onchange = () => {
          const c = cls.value as AssetClass;
          update({ assetClass: c, returnModelId: DEFAULT_MODEL_FOR[c] });
          this.renderHoldings();
        };
        const value = el('input', {
          type: 'number',
          min: '0',
          step: '100',
          value: String(Math.round(dollars(h.value))),
          'aria-label': `Value of ${h.name}`,
        });
        value.onchange = () => {
          update({ value: minor(Math.max(0, Number(value.value))), provenance: 'actual' });
          this.renderHoldings();
        };
        const model = el('select', { 'aria-label': `Return model for ${h.name}` });
        model.append(
          ...[...s.returnModels, ...this.historyModels].map(
            (m) => new Option(m.label, m.id, false, m.id === h.returnModelId)
          )
        );
        model.onchange = () => update({ returnModelId: model.value });
        const locked = el('input', {
          type: 'month',
          value: h.accessibleFrom?.slice(0, 7) ?? '',
          'aria-label': `${h.name} locked until`,
        });
        locked.onchange = () =>
          update({ accessibleFrom: locked.value ? `${locked.value}-01` : undefined });
        const hold = el('input', { type: 'checkbox', 'aria-label': `Never sell ${h.name}` });
        hold.checked = held.includes(h.id);
        hold.disabled = s.decisions.withdrawal.kind !== 'hold';
        hold.onchange = () => {
          const w = s.decisions.withdrawal;
          if (w.kind !== 'hold') return;
          w.holdingIds = hold.checked
            ? [...new Set([...w.holdingIds, h.id])]
            : w.holdingIds.filter((x) => x !== h.id);
          this.changed();
        };
        const remove = el('button', { type: 'button', class: 'secondary small' }, 'Remove');
        remove.onclick = () => {
          s.holdings = s.holdings.filter((x) => x !== h);
          s.decisions.sellOrder = s.decisions.sellOrder.filter((x) => x !== h.id);
          delete s.decisions.allocation[h.id];
          this.changed();
          this.renderHoldings();
        };
        return el(
          'tr',
          {},
          el('td', {}, name),
          el('td', {}, cls),
          el('td', { class: 'num' }, value),
          el('td', {}, model),
          el('td', {}, locked),
          el('td', {}, hold),
          el('td', {}, prov(h.provenance)),
          el('td', {}, remove)
        );
      })
    );
  }

  private changed(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const s = this.setup;
    if (s) this.saveTimer = setTimeout(() => void sim().saveSetup(s), 300);
    if (this.main) this.$('.status').textContent = 'Inputs changed: simulate again to update.';
  }

  private async inputs(tier: string): Promise<{ scenario: Scenario; spending: SpendingInput }> {
    const s = this.setup!;
    s.seed = this.field<HTMLInputElement>('.run', 'seed').value.trim() || '42';
    return inputsFor(this.view!, s, tier);
  }

  private async simulate(): Promise<void> {
    const s = this.setup;
    const v = this.view;
    if (!s || !v) return;
    this.readGoal();
    const id = ++this.runId;
    const runs = Number(this.field<HTMLSelectElement>('.run', 'runs').value);
    const status = this.$('.status');
    const button = this.$<HTMLButtonElement>('.simulate');
    button.disabled = true;
    try {
      const { scenario, spending } = await this.inputs(s.goal.tier);
      const t0 = performance.now();
      const result = await runPool(
        { scenario, spending, runs, keepCapital: true },
        (done, total) => {
          if (id === this.runId)
            status.textContent = `Simulating… ${done.toLocaleString('en-AU')} of ${total.toLocaleString('en-AU')} runs on ${poolSize()} workers`;
        }
      );
      if (id !== this.runId) return;
      this.main = { result, scenario, spending };
      status.textContent = `${runs.toLocaleString('en-AU')} runs of ${result.months} months in ${((performance.now() - t0) / 1000).toFixed(1)} s on ${poolSize()} workers.`;
      this.showMain();
      await this.showTiers(runs);
    } catch (err) {
      status.textContent = `Simulation failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      button.disabled = false;
    }
  }

  private showMain(): void {
    const m = this.main;
    const v = this.view;
    if (!m || !v) return;
    const { result: r, scenario, spending } = m;
    this.$('.results').hidden = false;
    const target = scenario.goal.targetProbability;
    const ps = this.$('.psuccess');
    ps.textContent = pct(r.pSuccess);
    setPageDetail(
      '/freedom',
      `last run: works in ${pct(r.pSuccess)} of futures, target ${pct(target)}`
    );
    ps.className = `v psuccess ${r.pSuccess >= target ? 'ok' : 'bad'}`;
    this.$('.psuccess-note').replaceChildren(
      `of ${(r.runs - r.invalidRuns).toLocaleString('en-AU')} futures keep capital above ${aud.format(dollars(scenario.goal.floor))} and always meet the ${this.tierName(scenario.goal.tier)} tier, for ${scenario.goal.horizonYears} years from ${scenario.goal.start.slice(0, 7)}. Target ${pct(target)}. `,
      r.invalidRuns
        ? `${r.invalidRuns} runs failed the money-balance check and are excluded. `
        : '',
      prov('forecast'),
      ...(creditsNote(spending) ? [el('p', { class: 'warn' }, creditsNote(spending)!)] : [])
    );

    const d = deterministicFreedom(scenario, spending);
    this.$('.fn-det').textContent = aud.format(d.freedomNumber);
    this.$('.fn-det-note').replaceChildren(
      `${aud.format(d.annualNeed)} a year of spending, ${aud.format(d.grossWithdrawal)} before tax, at a ${(d.withdrawalRate * 100).toFixed(1)} % withdrawal rate. `,
      prov(d.provenance)
    );
    this.$('.fn-p90').textContent = `At ${pct(target)}: not yet calculated.`;
    this.$('.fn-p90-note').textContent = '';
    this.$('.ytf').textContent = '–';
    this.$('.ytf-note').textContent = 'Find the freedom number at your target first.';

    const runway = projectRunway(scenario, spending);
    this.$('.runway').textContent = Number.isFinite(runway)
      ? `${(runway / 12).toFixed(1)} years`
      : 'unlimited';
    this.$('.runway-note').replaceChildren(
      'Of fully funded chosen work at this tier, from money you can reach today (not super or property). ',
      prov('forecast')
    );

    const months = Array.from({ length: r.months + 1 }, (_, i) =>
      addMonths(`${scenario.asOf}-01`, i).slice(0, 7)
    );
    const toMinor = (xs: number[]) => xs.map((x) => x * 100);
    this.$<FanChart>('fan-chart.capital').data = {
      label: "Capital in today's dollars",
      history: { months: [], values: [] },
      months,
      quantiles: {
        p5: toMinor(r.capital.p5),
        p25: toMinor(r.capital.p25),
        p50: toMinor(r.capital.p50),
        p75: toMinor(r.capital.p75),
        p95: toMinor(r.capital.p95),
      },
      floor: dollars(scenario.goal.floor) * 100,
      paths: r.examples.map((e) => toMinor(e.capital)),
      axis: 'years',
      unit: '',
      caption: `Median with 50 % and 90 % bands, ${r.examples.length} example futures, and the floor. Freedom starts at year ${(Math.max(0, months.indexOf(scenario.goal.start.slice(0, 7))) / 12).toFixed(0)}. `,
      provenance: 'forecast',
    };
    this.$('.capital-note').textContent =
      `Bank and holdings, after tax and spending. Spending before freedom is your current average; after, the ${this.tierName(scenario.goal.tier)} tier (${spending.tierSource === 'budgeted' ? 'from your budget' : 'your current spending: no budget lines yet'}), plus capital purchases from the CAPEX register.`;
    this.$('.drivers').hidden = true;
    this.record(r);
  }

  private record(r: PoolResult): void {
    const rows: [string, string][] = [
      ['GSSK version', r.record.gsskVersion],
      ['gssk.wasm SHA-256', r.record.wasmSha256],
      ['Model hash', r.record.modelHash],
      ['Inputs hash', r.record.inputsHash],
      ['Seed', r.record.seed],
      ['Runs', String(r.record.runs)],
      ['Largest money-balance error', r.maxDrift.toExponential(2)],
    ];
    this.$('.record dl').replaceChildren(
      ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])
    );
  }

  private tierName(id: string): string {
    return this.view?.budget.tiers.find((t) => t.id === id)?.name ?? id;
  }

  private async showTiers(runs: number): Promise<void> {
    const v = this.view!;
    const m = this.main!;
    const id = this.runId;
    const body = this.$('.tiers tbody');
    const rows = new Map<string, HTMLTableCellElement>();
    body.replaceChildren(
      ...v.budget.tiers.map((t) => {
        const cell = el(
          'td',
          { class: 'num' },
          t.id === m.scenario.goal.tier ? pct(m.result.pSuccess) : '…'
        );
        rows.set(t.id, cell);
        return el('tr', {}, el('th', { scope: 'row' }, t.name), cell);
      })
    );
    const n = Math.min(runs, 200);
    for (const t of v.budget.tiers) {
      if (t.id === m.scenario.goal.tier) continue;
      const { scenario, spending } = await this.inputs(t.id);
      const r = await poolRunner({ scenario, spending, runs: n, keepCapital: false });
      if (id !== this.runId) return;
      rows.get(t.id)!.textContent = `${pct(r.pSuccess)}${n < runs ? ` (${n} runs)` : ''}`;
    }
  }

  private async findP90(): Promise<void> {
    const m = this.main;
    if (!m) return;
    const id = this.runId;
    const button = this.$<HTMLButtonElement>('.find-p90');
    button.disabled = true;
    const target = m.scenario.goal.targetProbability;
    this.$('.fn-p90').textContent = 'Searching…';
    try {
      const f = await p90Freedom(m.scenario, m.spending, poolRunner, { runs: 200, target });
      if (id !== this.runId) return;
      if (f.capital === null) {
        this.$('.fn-p90').textContent = `At ${pct(target)}: not reachable below $1 billion.`;
        return;
      }
      this.$('.fn-p90').textContent = `At ${pct(target)}: ${aud.format(f.capital)}`;
      this.$('.fn-p90-note').replaceChildren(
        `Smallest starting capital, in today's mix of holdings, that succeeds in ${pct(f.pSuccess ?? 0)} of ${f.runs} futures (bisection, ${f.iterations} simulations). `,
        prov('forecast')
      );
      this.$('.ytf').textContent = 'Simulating…';
      const y = await yearsToFreedom(m.scenario, m.spending, f.capital, poolRunner, { runs: 200 });
      if (id !== this.runId) return;
      this.$('.ytf').textContent = years(y.p50);
      this.$('.ytf-note').replaceChildren(
        `Until capital first reaches ${aud.format(f.capital)} if you keep working and saving as now. 80 % range ${years(y.p10)} to ${years(y.p90)}; reached in ${pct(y.reached)} of futures. `,
        prov('forecast')
      );
    } finally {
      button.disabled = false;
    }
  }

  private async drivers(): Promise<void> {
    const m = this.main;
    if (!m) return;
    const id = this.runId;
    const button = this.$<HTMLButtonElement>('.drivers-run');
    button.disabled = true;
    try {
      const d = await shortfallDrivers(m.scenario, m.spending, m.result, poolRunner, { runs: 200 });
      if (id !== this.runId) return;
      const table = this.$('.drivers');
      table.hidden = false;
      this.$('.drivers tbody').replaceChildren(
        ...d.map((x) =>
          el(
            'tr',
            {},
            el('th', { scope: 'row' }, x.label),
            el('td', { class: 'num' }, pct(x.pSuccess)),
            el(
              'td',
              { class: 'num' },
              `${x.delta >= 0 ? '+' : '−'}${Math.abs(x.delta * 100).toFixed(1)} pts`
            )
          )
        )
      );
    } finally {
      button.disabled = false;
    }
  }
}

define('freedom-page', FreedomPage);
