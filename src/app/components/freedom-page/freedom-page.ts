import { BaseComponent, define } from '../../core/base-component.ts';
import { data, ensureLoaded } from '../../data.ts';
import { dateTime, el, prov } from '../../format.ts';
import { poolSize, type PoolResult, type RunRecord } from '../../sim-pool.ts';
import {
  currentInputsHash,
  loadRuns,
  PLAN_STEPS,
  previousRun,
  runFullPlan,
  saveRun,
  STEP_WORDS,
  type PlanRun,
  type PlanStep,
} from '../../plan-run.ts';
import { sim } from '../../workers.ts';
import { inputsFor, loadHistories } from '../../freedom-inputs.ts';
import { SETUP_CHANGED } from '../../proposals.ts';
import { loadProfile, PROFILE_CHANGED, profileHorizon, today } from '../../profile.ts';
import { planAge, type Profile } from '../../../profile/lifespan.ts';
import { checkPlan } from '../../../sim/checks.ts';
import { historyModel } from '../../../sim/history.ts';
import { addScenario } from '../../scenarios.ts';
import '../fan-chart/fan-chart.ts';
import type { FanChart } from '../fan-chart/fan-chart.ts';
import type { DataView } from '../../../data/service.ts';
import { addMonths } from '../../../lib/dates.ts';
import { defaultSetup, type FreedomSetup } from '../../../sim/inputs.ts';
import {
  DEFAULT_MODEL_FOR,
  type AssetClass,
  type Holding,
  type ReturnModel,
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
  /** The profile, which may set the years of freedom (ADR 0043). */
  private profile: Profile | null = null;
  /** The run on screen: a fresh one, or one from the history. */
  private shown: PlanRun | null = null;
  private history: PlanRun[] = [];
  private running = false;
  private stopping = false;
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
      void this.runAll();
    };
    this.$<HTMLButtonElement>('.stop').onclick = () => {
      this.stopping = true;
      this.$('.status').textContent = 'Stopping after this step…';
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
    this.$<HTMLButtonElement>('.save-scenario').onclick = () => void this.saveScenario();
    this.unsubscribe = data.subscribe(() => void this.load());
    window.addEventListener(SETUP_CHANGED, this.onSetupChanged);
    window.addEventListener(PROFILE_CHANGED, this.onProfileChanged);
    void ensureLoaded().then(() => this.load());
  }

  /** The plan was changed elsewhere (a chat card): show it. */
  private readonly onSetupChanged = async () => {
    const s = await sim().loadSetup();
    if (!s || !this.view) return;
    this.setup = s;
    this.fill();
    if (this.shown) this.lastRunLine(this.shown, true);
  };

  private readonly onProfileChanged = async () => {
    this.profile = await loadProfile();
    this.horizonFromProfile();
  };

  override destroy(): void {
    window.removeEventListener(SETUP_CHANGED, this.onSetupChanged);
    window.removeEventListener(PROFILE_CHANGED, this.onProfileChanged);
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
    this.profile = await loadProfile();
    this.historyModels = (await loadHistories()).map(historyModel);
    this.fill();
    await this.showLatest();
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
    this.horizonFromProfile();
    this.renderHoldings();
    void this.showChecks();
  }

  /**
   * With an age in the profile, the years of freedom run from the person's age
   * when freedom starts to the age the profile plans for; the field follows.
   */
  private horizonFromProfile(): void {
    const s = this.setup;
    if (!s) return;
    const field = this.field<HTMLInputElement>('.goal', 'horizon');
    const note = this.$('.horizon-note');
    const p = this.profile;
    const years = p ? profileHorizon(p, s) : undefined;
    const plan = p && planAge(p, today());
    const link = el(
      'a',
      { href: `${import.meta.env.BASE_URL}profile`, 'data-route': '/profile' },
      'Profile'
    );
    field.readOnly = years !== undefined;
    if (years === undefined || !plan) {
      note.replaceChildren(
        plan ? 'Years of freedom are set by hand; your ' : 'Add your age on your ',
        link,
        plan
          ? ' can set them from your age instead.'
          : ' and Crux works out how many years your money has to last.'
      );
      return;
    }
    field.value = String(years);
    note.replaceChildren(
      `To age ${plan.planTo}: you're about ${plan.planTo - years} when freedom starts. From your `,
      link,
      ' ',
      prov('assumed'),
      '.'
    );
    if (s.goal.horizonYears !== years) {
      s.goal = { ...s.goal, horizonYears: years };
      this.changed();
    }
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
    this.horizonFromProfile();
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
          step: 'any',
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
    if (s)
      this.saveTimer = setTimeout(() => {
        void sim().saveSetup(s);
        void this.showChecks();
      }, 300);
    if (this.shown) this.lastRunLine(this.shown, true);
  }

  /**
   * Plan checks (ADR 0026): settings that make the plan fail in a way the
   * person likely didn't mean, each with its fix where there is an obvious one.
   */
  private async showChecks(): Promise<void> {
    const s = this.setup;
    const v = this.view;
    if (!s || !v) return;
    const { scenario, spending } = await inputsFor(v, s);
    if (s !== this.setup) return;
    const checks = checkPlan(s, spending, scenario.asOf).sort((a, b) =>
      a.level === b.level ? 0 : a.level === 'problem' ? -1 : 1
    );
    this.$('.checks').hidden = !checks.length && this.$('.check-done').hidden;
    this.$('.check-list').replaceChildren(
      ...checks.map((c) => {
        const li = el(
          'li',
          { class: c.level, 'data-check': c.id },
          el('span', { class: 'tag' }, c.level === 'problem' ? 'Check this' : 'Worth knowing'),
          ' ',
          c.text
        );
        if (c.fix) {
          const fix = c.fix;
          const apply = el('button', { type: 'button', class: 'small' }, fix.label);
          apply.onclick = () => {
            const before = this.setup!;
            this.setup = structuredClone(fix.setup);
            this.fill();
            this.changed();
            const done = this.$('.check-done');
            const undo = el('button', { type: 'button', class: 'secondary small' }, 'Undo');
            undo.onclick = () => {
              done.hidden = true;
              done.replaceChildren();
              this.setup = before;
              this.fill();
              this.changed();
            };
            done.hidden = false;
            done.replaceChildren(
              el('span', { class: 'tag' }, 'Changed:'),
              ` ${fix.summary}. Run your plan to see the difference. `,
              undo
            );
          };
          li.append(' ', apply);
        }
        return li;
      })
    );
  }

  /** "Run my plan": every step, shown as it finishes, then kept in the history (ADR 0032). */
  private async runAll(): Promise<void> {
    const s = this.setup;
    const v = this.view;
    if (!s || !v || this.running) return;
    this.readGoal();
    s.seed = this.field<HTMLInputElement>('.run', 'seed').value.trim() || '42';
    const id = ++this.runId;
    this.running = true;
    this.stopping = false;
    const runs = Number(this.field<HTMLSelectElement>('.run', 'runs').value);
    const status = this.$('.status');
    const button = this.$<HTMLButtonElement>('.simulate');
    const stop = this.$<HTMLButtonElement>('.stop');
    button.disabled = true;
    stop.hidden = false;
    const steps = this.$('.steps');
    steps.hidden = false;
    steps.replaceChildren(
      ...PLAN_STEPS.map((k) => el('li', { 'data-step': k, 'data-state': 'todo' }, STEP_WORDS[k][0]))
    );
    const mark = (k: PlanStep, state: 'running' | 'done') => {
      const li = steps.querySelector<HTMLElement>(`[data-step="${k}"]`);
      if (!li) return;
      li.dataset.state = state;
      li.textContent = STEP_WORDS[k][state === 'done' ? 1 : 0];
    };
    mark('chance', 'running');
    const t0 = performance.now();
    try {
      const full = await runFullPlan(v, s, {
        runs,
        stopped: () => this.stopping || id !== this.runId,
        onProgress: (text) => {
          if (id === this.runId) status.textContent = `${text}…`;
        },
        onStep: (k, state, run) => {
          if (id !== this.runId) return;
          mark(k, state);
          if (state === 'done') this.show(run);
        },
      });
      if (id !== this.runId) return;
      this.history = await saveRun(full.run);
      this.show(full.run, full.main);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      status.textContent =
        full.run.done.length === PLAN_STEPS.length
          ? `Done in ${secs} s on ${poolSize()} workers. Kept in History.`
          : `Stopped after ${full.run.done.length} of ${PLAN_STEPS.length} steps. What finished is kept in History.`;
    } catch (err) {
      status.textContent = `The run failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      if (id === this.runId) {
        this.running = false;
        button.disabled = false;
        stop.hidden = true;
      }
    }
  }

  /** The newest kept run on opening the screen, marked if the inputs have changed since. */
  private async showLatest(): Promise<void> {
    this.history = await loadRuns();
    const last = this.history.at(-1);
    if (!last || this.running || this.shown) return;
    this.show(last);
    await this.checkStale();
  }

  private async checkStale(): Promise<void> {
    const shown = this.shown;
    if (!shown || !this.setup || !this.view) return;
    const now = await currentInputsHash(this.view, this.setup);
    if (shown !== this.shown) return;
    this.lastRunLine(shown, now !== shown.inputsHash);
  }

  private lastRunLine(r: PlanRun, stale: boolean): void {
    const line = this.$('.last-run');
    line.dataset.stale = String(stale);
    const prev = previousRun(this.history, r);
    line.textContent = [
      `Run ${dateTime(r.at)}.`,
      prev
        ? `Chance of success ${pct(prev.pSuccess)} → ${pct(r.pSuccess)} since the run before (${dateTime(prev.at)}).`
        : '',
      stale ? 'Your data or settings have changed since: run your plan again to update.' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  /** A run → the results. `main` (the full simulation) adds example futures to the fan. */
  private show(r: PlanRun, main?: PoolResult): void {
    const v = this.view;
    if (!v) return;
    this.shown = r;
    this.$('.results').hidden = false;
    this.lastRunLine(r, false);
    const target = r.goal.target;
    const ps = this.$('.psuccess');
    ps.textContent = pct(r.pSuccess);
    setPageDetail(
      '/freedom',
      `last run: works in ${pct(r.pSuccess)} of futures, target ${pct(target)}`
    );
    ps.className = `v psuccess ${r.pSuccess >= target ? 'ok' : 'bad'}`;
    this.$('.psuccess-note').replaceChildren(
      `of ${r.validRuns.toLocaleString('en-AU')} futures keep capital above ${aud.format(r.goal.floor)} and always meet the ${this.tierName(r.goal.tier)} tier, for ${r.goal.horizonYears} years from ${r.goal.start}. Target ${pct(target)}. `,
      r.invalidRuns
        ? `${r.invalidRuns} runs failed the money-balance check and are excluded. `
        : '',
      prov('forecast')
    );

    // Tiers.
    this.$('.tiers tbody').replaceChildren(
      ...v.budget.tiers.map((t) => {
        const x = r.tiers?.find((y) => y.id === t.id);
        const text =
          t.id === r.goal.tier
            ? pct(r.pSuccess)
            : x
              ? `${pct(x.pSuccess)}${x.runs < r.record.runs ? ` (${x.runs} runs)` : ''}`
              : '…';
        return el('tr', {}, el('th', { scope: 'row' }, t.name), el('td', { class: 'num' }, text));
      })
    );

    // Freedom number and years to freedom.
    const f = r.freedomNumber;
    this.$('.fn-det').textContent = f ? aud.format(f.deterministic) : '…';
    this.$('.fn-det-note').replaceChildren(
      ...(f
        ? [
            `${aud.format(f.annualNeed)} a year of spending at a ${(f.withdrawalRate * 100).toFixed(1)} % withdrawal rate. `,
            prov('assumed'),
          ]
        : [])
    );
    this.$('.fn-p90').textContent = !f
      ? `At ${pct(target)}: …`
      : f.atTarget === null
        ? `At ${pct(target)}: not reachable below $1 billion.`
        : `At ${pct(target)}: ${aud.format(f.atTarget)}`;
    this.$('.fn-p90-note').replaceChildren(
      ...(f?.atTarget != null
        ? [
            `Smallest starting capital, in today's mix of holdings, that succeeds in ${pct(f.atTargetChance ?? 0)} of ${f.atTargetRuns} futures. `,
            prov('forecast'),
          ]
        : [])
    );
    const y = r.yearsToFreedom;
    this.$('.ytf').textContent = y ? years(y.p50) : f ? '–' : '…';
    this.$('.ytf-note').replaceChildren(
      ...(y && f?.atTarget != null
        ? [
            `Until capital first reaches ${aud.format(f.atTarget)} if you keep working and saving as now. 80 % range ${years(y.p10)} to ${years(y.p90)}; reached in ${pct(y.reached)} of futures. `,
            prov('forecast'),
          ]
        : [])
    );
    const runway = r.runwayMonths;
    this.$('.runway').textContent =
      runway === undefined
        ? '…'
        : Number.isFinite(runway)
          ? `${(runway / 12).toFixed(1)} years`
          : 'unlimited';
    this.$('.runway-note').replaceChildren(
      'Of fully funded chosen work at this tier, from money you can reach today (not super or property). ',
      prov('forecast')
    );

    // The capital fan: monthly with example futures from a fresh run, yearly from a kept one.
    const startMonth = r.goal.start;
    const at = (i: number) => addMonths(`${r.asOf}-01`, i).slice(0, 7);
    const toMinor = (xs: readonly number[]) => xs.map((x) => x * 100);
    const q = main ? main.capital : r.capital.q;
    const idx = main ? main.capital.p50.map((_, i) => i) : r.capital.months;
    const months = idx.map(at);
    this.$<FanChart>('fan-chart.capital').data = {
      label: "Capital in today's dollars",
      history: { months: [], values: [] },
      months,
      quantiles: {
        p5: toMinor(q.p5),
        p25: toMinor(q.p25),
        p50: toMinor(q.p50),
        p75: toMinor(q.p75),
        p95: toMinor(q.p95),
      },
      floor: r.goal.floor * 100,
      paths: main ? main.examples.map((e) => toMinor(e.capital)) : [],
      axis: 'years',
      unit: '',
      caption: `Median with 50 % and 90 % bands${main ? `, ${main.examples.length} example futures,` : ''} and the floor.`,
      provenance: 'forecast',
    };
    this.$('.capital-note').textContent =
      `Bank and holdings, after tax and spending, for the ${this.tierName(r.goal.tier)} tier from ${startMonth}.`;

    // Drivers.
    const table = this.$('.drivers');
    table.hidden = !r.drivers;
    this.$('.drivers-wait').hidden = !!r.drivers;
    this.$('.drivers tbody').replaceChildren(
      ...(r.drivers ?? []).map((x) =>
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

    this.showPriors(r);
    this.showPlans(r);
    this.showHistory();
    this.record(r.record, main?.maxDrift);
  }

  private showPriors(r: PlanRun): void {
    const p = r.priors;
    const box = this.$('.priors-text');
    if (!p) {
      box.textContent = 'Worked out when you run your plan.';
      return;
    }
    if ('unavailable' in p) {
      box.textContent = p.unavailable;
      return;
    }
    const lo = Math.min(p.weaker, p.stronger, p.baseline);
    const hi = Math.max(p.weaker, p.stronger, p.baseline);
    box.replaceChildren(
      `As built: ${pct(p.baseline)}. Weaker assumptions: ${pct(p.weaker)}. Stronger: ${pct(p.stronger)} (each on the same ${p.runs} futures). `,
      el(
        'strong',
        {},
        hi - lo <= 0.05
          ? "The model's assumptions don't change this number."
          : 'The model’s assumptions move this number: more months of data would narrow it.'
      ),
      ' ',
      prov('calibrated')
    );
  }

  private showPlans(r: PlanRun): void {
    const e = r.earliest;
    const note = this.$('.plans-note');
    const list = this.$('.plan-list');
    if (!e) {
      note.textContent =
        r.done.length === PLAN_STEPS.length ? '' : 'Worked out when you run your plan.';
      list.replaceChildren();
      return;
    }
    const what = (p: NonNullable<PlanRun['earliest']>['plans'][number]) =>
      p.id === 'target'
        ? `Earliest at your ${pct(p.target)} target`
        : p.id === 'safer'
          ? `A safer margin (${pct(p.target)})`
          : `Spend ${pct(1 - p.tierSpend)} less after freedom`;
    note.textContent = e.plans.length
      ? `Searched ${e.simulations} start dates on the same simulated futures. Your current start is ${e.current.start} (${pct(e.current.pSuccess)}).`
      : `Searched ${e.simulations} start dates: even starting in ${e.latest?.start ?? e.current.start}, the plan works in ${pct(e.latest?.pSuccess ?? e.current.pSuccess)} of futures, short of the target. Spending less after freedom, project income or a lower tier could close the gap.`;
    list.replaceChildren(
      ...e.plans.map((p) => {
        const use = el('button', { type: 'button', class: 'secondary small use' }, 'Use this plan');
        use.onclick = () => {
          this.setup = structuredClone(p.setup);
          this.fill();
          this.changed();
          use.disabled = true;
          use.textContent = 'In your plan: run it to update';
        };
        const save = el('button', { type: 'button', class: 'secondary small' }, 'Save as scenario');
        save.onclick = async () => {
          save.disabled = true;
          await addScenario(`${what(p)}: ${p.start}`, p.setup, 'optimiser', p.runId);
          save.textContent = 'Saved to Scenarios';
        };
        return el(
          'li',
          { 'data-plan': p.id },
          el('strong', {}, `${what(p)}:`),
          ` start ${p.start}, works in ${pct(p.pSuccess)} of futures.`,
          use,
          save
        );
      })
    );
  }

  private showHistory(): void {
    const list = this.$('.run-list');
    list.replaceChildren(
      ...this.history
        .slice()
        .reverse()
        .map((r) => {
          const b = el('button', { type: 'button', class: 'secondary small' }, 'Show');
          b.onclick = () => {
            this.show(r);
            void this.checkStale();
          };
          const li = el(
            'li',
            { 'data-run': r.id },
            `${dateTime(r.at)}: ${pct(r.pSuccess)} (target ${pct(r.goal.target)}), ${this.tierName(r.goal.tier)} tier from ${r.goal.start}${r.done.length < PLAN_STEPS.length ? ', stopped early' : ''}.`,
            b
          );
          if (r.id === this.shown?.id) li.setAttribute('aria-current', 'true');
          return li;
        })
    );
  }

  private record(r: RunRecord, maxDrift?: number): void {
    const rows: [string, string][] = [
      ['GSSK version', r.gsskVersion],
      ['gssk.wasm SHA-256', r.wasmSha256],
      ['Model hash', r.modelHash],
      ['Inputs hash', r.inputsHash],
      ['Seed', r.seed],
      ['Runs', String(r.runs)],
      ...(maxDrift !== undefined
        ? ([['Largest money-balance error', maxDrift.toExponential(2)]] as [string, string][])
        : []),
    ];
    this.$('.record dl').replaceChildren(
      ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])
    );
  }

  private tierName(id: string): string {
    return this.view?.budget.tiers.find((t) => t.id === id)?.name ?? id;
  }
}

define('freedom-page', FreedomPage);
