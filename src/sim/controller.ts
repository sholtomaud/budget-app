/**
 * The policy controller (FR-SIM-002, SPEC §11.2). The kernel integrates; the
 * app decides. Each month the controller reads the state, sets this month's
 * return edges from the run's sampled path, applies the withdrawal strategy,
 * pays last month's tax, invests any surplus, records a mutation cause for
 * every rate change, and steps one month.
 *
 * All edges are constant and dt = 1, so a month's flow is exactly its k. The
 * controller never lets a storage go negative: spending it cannot fund is a
 * shortfall, and a shortfall after the goal's start fails the run.
 */
import type { Asset } from '../domain/types.ts';
import { daysBetween } from '../lib/dates.ts';
import { deriveSeed, Rng, weibullScale } from '../lib/prng.ts';
import type { QuantileKey } from '../forecast/ref/stats.ts';
import type { GsskInstance } from './gssk.ts';
import type { Holding, Scenario, SpendingInput } from './model.ts';
import { monthsBetween, POOLS, type ModelLayout } from './modelgen.ts';
import { sampleReturnPaths, syntheticHistories } from './returns.ts';
import { taxableGain, taxTable, totalTax, type TaxTable } from './tax.ts';

/** Which stochastic inputs a run freezes at their median (shortfall drivers, FR-GOAL). */
export interface Freeze {
  returns?: boolean;
  spending?: boolean;
  capex?: boolean;
}

export interface RunSummary {
  run: number;
  seed: string;
  success: boolean;
  /** First month (index from asOf) the goal failed, or −1. */
  ruinMonth: number;
  /** Months after start where required spending was not met. */
  shortfallMonths: number;
  minCapital: number;
  endCapital: number;
  totalTax: number;
  totalSpend: number;
  /** First month real capital reached `crossing` (years-to-freedom), or −1. */
  crossMonth: number;
  /** Largest per-step money-balance error relative to household money (FR-SIM-003). */
  maxDrift: number;
  valid: boolean;
}

export interface RunOutput {
  summary: RunSummary;
  /** Real capital (bank + holdings) at each month end; index 0 is the opening. */
  capital: Float64Array;
}

const Q_LEVELS: [number, QuantileKey][] = [
  [0.05, 'p5'],
  [0.1, 'p10'],
  [0.25, 'p25'],
  [0.5, 'p50'],
  [0.75, 'p75'],
  [0.9, 'p90'],
  [0.95, 'p95'],
];

/** The value at quantile level u of the per-month quantile paths (clamped, linear). */
export function ratioAt(ratio: SpendingInput['ratio'], month: number, u: number): number {
  if (!ratio) return 1;
  const at = (k: QuantileKey) => {
    const path = ratio[k];
    return path.length ? path[Math.min(month, path.length - 1)]! : 1;
  };
  if (u <= Q_LEVELS[0]![0]) return at(Q_LEVELS[0]![1]);
  for (let i = 1; i < Q_LEVELS.length; i++) {
    const [q1, k1] = Q_LEVELS[i]!;
    if (u <= q1) {
      const [q0, k0] = Q_LEVELS[i - 1]!;
      return at(k0) + ((u - q0) / (q1 - q0)) * (at(k1) - at(k0));
    }
  }
  return at(Q_LEVELS.at(-1)![1]);
}

/** One run's CAPEX spend per month (real dollars), mirroring forecastCapex. */
export function sampleCapexPath(
  assets: readonly Asset[],
  asOf: string,
  months: number,
  rng: Rng
): Float64Array {
  const out = new Float64Array(months);
  const start = `${asOf.slice(0, 7)}-01`;
  for (const a of assets) {
    if (a.status === 'retired' || a.decision?.action === 'drop' || a.decision?.action === 'defer')
      continue;
    const cost = Number((a.forecastCost ?? a.cost).minor) / 100;
    if (a.status === 'owned') {
      if (!a.replace || !a.purchasedAt) continue;
      const k = a.life.shape ?? 2.5;
      const scale = weibullScale(a.life.meanYears, k);
      const age = Math.max(0, daysBetween(a.purchasedAt, start) / 365.25);
      const growth = a.replacementCostGrowth ?? 0;
      let t = rng.weibullGiven(k, scale, age) - age;
      while (t * 12 < months) {
        out[Math.floor(t * 12)]! += cost * Math.pow(1 + growth, t);
        t += rng.weibull(k, scale);
      }
    } else if (a.decision?.action === 'buy') {
      const m = a.decision.by ? Math.floor(daysBetween(start, a.decision.by) / (365.25 / 12)) : 0;
      if (m >= 0 && m < months) out[m]! += cost;
    }
  }
  return out;
}

/** The built-in illustrative histories plus the user's imported ones. */
function withImported(h: Scenario['histories']): Record<string, Float64Array> {
  const base = syntheticHistories();
  if (!h) return base;
  return {
    ...base,
    ...Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Float64Array.from(v)])),
  };
}

/** Everything about a scenario the monthly loop needs, prepared once. */
export interface Plan {
  scenario: Scenario;
  spending: SpendingInput;
  layout: ModelLayout;
  months: number;
  startIdx: number;
  workEnd: number;
  tax: TaxTable | null;
  netPay: number;
  projectMonthly: number;
  floor: number;
  /** Per holding, aligned with scenario.holdings. */
  accessibleFrom: number[];
  heldBefore: number[];
  sellRank: number[];
  allocation: number[];
  shares: [number, number][];
  incomeYield: number[];
  taxed: boolean[];
  salary: [number, number];
  /** Real capital the years-to-freedom metric looks for, or Infinity. */
  crossing: number;
}

const dollars = (minor: bigint) => Number(minor) / 100;

export function makePlan(
  scenario: Scenario,
  spending: SpendingInput,
  layout: ModelLayout,
  opts: { crossing?: number } = {}
): Plan {
  const s = scenario;
  const startIdx = Math.max(0, monthsBetween(s.asOf, s.goal.start));
  const workEnd = s.decisions.workUntil
    ? Math.max(0, monthsBetween(s.asOf, s.decisions.workUntil))
    : startIdx;
  const models = new Map(s.returnModels.map((m) => [m.id, m]));
  const order = s.decisions.sellOrder;
  const twoPeople = s.people.length > 1;
  const shareOf = (h: Holding): [number, number] =>
    !twoPeople ? [1, 0] : h.owner === 'p2' ? [0, 1] : h.owner === 'joint' ? [0.5, 0.5] : [1, 0];
  const weights = s.holdings.map((h) => Math.max(0, s.decisions.allocation[h.id] ?? 0));
  const wSum = weights.reduce((a, b) => a + b, 0);
  return {
    scenario: s,
    spending,
    layout,
    months: layout.months,
    startIdx,
    workEnd,
    tax: s.taxTable ? taxTable(s.taxTable) : null,
    netPay: dollars(s.decisions.netPayMonthly ?? 0n),
    projectMonthly: dollars(s.goal.projectIncome ?? 0n) / 12,
    floor: dollars(s.goal.floor),
    accessibleFrom: s.holdings.map((h) =>
      h.accessibleFrom ? monthsBetween(s.asOf, h.accessibleFrom) : -Infinity
    ),
    heldBefore: s.holdings.map((h) =>
      h.acquiredAt ? Math.max(0, monthsBetween(h.acquiredAt, s.asOf)) : 1200
    ),
    sellRank: s.holdings.map((h) => {
      const i = order.indexOf(h.id);
      return i < 0 ? order.length : i;
    }),
    allocation: weights.map((w) => (wSum > 0 ? w / wSum : 0)),
    shares: s.holdings.map(shareOf),
    incomeYield: s.holdings.map((h) => models.get(h.returnModelId)?.incomeYield ?? 0),
    taxed: s.holdings.map((h) => h.assetClass !== 'super'),
    salary: [dollars(s.people[0]?.grossSalary ?? 0n), dollars(s.people[1]?.grossSalary ?? 0n)],
    crossing: opts.crossing ?? Infinity,
  };
}

/** Pre-resolved edge and node indices for one GSSK instance. */
export interface Wiring {
  inst: GsskInstance;
  bank: number;
  pools: number[];
  isPool: Uint8Array;
  holdings: number[];
  e: {
    pay: number;
    project: number;
    opex: number;
    capex: number;
    tax: number;
    gain: number[];
    loss: number[];
    contrib: number[];
    draw: number[];
  };
  cause: Record<
    | 'pay'
    | 'project'
    | 'spend'
    | 'shortfall'
    | 'capex'
    | 'tax'
    | 'returns'
    | 'draw'
    | 'invest'
    | 'none',
    number
  >;
  state: Float64Array;
  /** Last k set per edge; NaN forces a write (after Reset). */
  lastK: Float64Array;
}

export function wire(inst: GsskInstance, layout: ModelLayout): Wiring {
  const e = (id: string) => inst.edgeIndex(id);
  return {
    inst,
    bank: inst.nodeIndex('bank'),
    pools: POOLS.map((p) => inst.nodeIndex(p)),
    isPool: Uint8Array.from(inst.nodeIds, (id) =>
      (POOLS as readonly string[]).includes(id) ? 1 : 0
    ),
    holdings: layout.holdingNodes.map((n) => inst.nodeIndex(n)),
    e: {
      pay: e('pay'),
      project: e('project_pay'),
      opex: e('opex_spend'),
      capex: e('capex_spend'),
      tax: e('tax_paid'),
      gain: layout.gain.map(e),
      loss: layout.loss.map(e),
      contrib: layout.contrib.map(e),
      draw: layout.draw.map(e),
    },
    cause: {
      pay: inst.internCause('policy:pay'),
      project: inst.internCause('policy:project-income'),
      spend: inst.internCause('policy:spend'),
      shortfall: inst.internCause('policy:spend-shortfall'),
      capex: inst.internCause('policy:capex'),
      tax: inst.internCause('policy:tax'),
      returns: inst.internCause('policy:returns'),
      draw: inst.internCause('policy:withdraw'),
      invest: inst.internCause('policy:invest-surplus'),
      none: inst.internCause('policy:idle'),
    },
    state: new Float64Array(inst.nodeIds.length),
    lastK: new Float64Array(inst.edgeIds.length).fill(NaN),
  };
}

function setK(w: Wiring, edge: number, k: number, cause: number): void {
  if (w.lastK[edge] === k) return;
  w.lastK[edge] = k;
  w.inst.setEdgeKFast(edge, k, cause);
}

/** Per-person running totals for the financial year (AU: July to June). */
interface TaxYear {
  salary: [number, number];
  income: [number, number];
  /** Capital gains eligible for the discount, and not, and losses (positive). */
  gainDisc: [number, number];
  gainNon: [number, number];
  loss: [number, number];
  carryLoss: [number, number];
  accrued: number;
}

const newYear = (carry: [number, number] = [0, 0]): TaxYear => ({
  salary: [0, 0],
  income: [0, 0],
  gainDisc: [0, 0],
  gainNon: [0, 0],
  loss: [0, 0],
  carryLoss: carry,
  accrued: 0,
});

function personTax(t: TaxTable, y: TaxYear, p: 0 | 1): { tax: number; netLoss: number } {
  let losses = y.loss[p] + y.carryLoss[p];
  const non = Math.max(0, y.gainNon[p] - losses);
  losses = Math.max(0, losses - y.gainNon[p]);
  const disc = Math.max(0, y.gainDisc[p] - losses);
  losses = Math.max(0, losses - y.gainDisc[p]);
  const taxable = y.income[p] + non + taxableGain(t, disc, Infinity);
  const tax = totalTax(t, y.salary[p] + taxable) - totalTax(t, y.salary[p]);
  return { tax: Math.max(0, tax), netLoss: losses };
}

/**
 * Run one Monte-Carlo path on an instance that is freshly initialised or
 * reset. `runSeed` drives every sampled input (NFR-DET-001).
 */
export function runOnce(
  plan: Plan,
  w: Wiring,
  run: number,
  runSeed: bigint,
  freeze: Freeze = {}
): RunOutput {
  const s = plan.scenario;
  const n = plan.months;
  const H = s.holdings.length;
  const inst = w.inst;
  w.lastK.fill(NaN);
  inst.clearMutationLog();

  const paths = sampleReturnPaths(s.returnModels, n, runSeed, {
    frozen: freeze.returns,
    histories: withImported(s.histories),
  });
  const pathOf = s.holdings.map((h) => {
    const p = paths[h.returnModelId];
    if (!p) throw new Error(`Holding ${h.id} names unknown return model ${h.returnModelId}`);
    return p;
  });
  const capexPath = freeze.capex
    ? new Float64Array(n).fill(plan.spending.capexMonthly)
    : sampleCapexPath(plan.spending.assets, s.asOf, n, new Rng(deriveSeed(runSeed, 'capex')));
  const u = freeze.spending ? 0.5 : new Rng(deriveSeed(runSeed, 'opex')).float();
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  const currentOpex = sum(plan.spending.current);
  const tierOpex = sum(plan.spending.tier);

  const costBase = s.holdings.map((h) => dollars(h.costBase ?? h.value));
  const startMonthOfYear = Number(s.asOf.slice(5, 7)); // 1..12
  const capital = new Float64Array(n + 1);
  const st = w.state;
  inst.stateInto(st);
  const household = (x: Float64Array) => {
    let v = x[w.bank]!;
    for (const i of w.holdings) v += x[i]!;
    return v;
  };
  capital[0] = household(st);

  let year = newYear();
  let taxDue = 0;
  let taxTotal = 0;
  let totalSpend = 0;
  let shortfallMonths = 0;
  let ruinMonth = -1;
  let minCapital = Infinity;
  let crossMonth = capital[0]! >= plan.crossing ? 0 : -1;
  let maxDrift = 0;
  let valid = true;

  // Strategy state.
  const strat = s.decisions.withdrawal;
  let annualAllowance = 0;
  let guardW = 0;
  let guardWR0 = 0;

  const gain = new Float64Array(H);
  const loss = new Float64Array(H);
  const avail = new Float64Array(H);
  const draw = new Float64Array(H);
  const contrib = new Float64Array(H);
  const prev = new Float64Array(st.length);
  // Holdings missing from the sell order are sold last; `hold` never sells its holdings.
  const sellIdx = [...s.holdings.keys()]
    .filter((j) => !(strat.kind === 'hold' && strat.holdingIds.includes(s.holdings[j]!.id)))
    .sort((a, b) => plan.sellRank[a]! - plan.sellRank[b]! || a - b);

  for (let m = 0; m < n; m++) {
    const free = m >= plan.startIdx;
    const working = m < plan.workEnd;
    const bank = st[w.bank]!;
    let cap = 0;
    for (let j = 0; j < H; j++) {
      const h = st[w.holdings[j]!]!;
      const r = pathOf[j]![m]!;
      gain[j] = r > 0 ? h * r : 0;
      loss[j] = r < 0 ? -h * r : 0;
      avail[j] = h + gain[j]! - loss[j]!;
      draw[j] = 0;
      contrib[j] = 0;
      cap += h;
    }
    cap += bank;

    const pay = working ? plan.netPay : 0;
    const project = free ? plan.projectMonthly : 0;
    const ratio = ratioAt(plan.spending.ratio, m, u);
    const opex = (free ? tierOpex : currentOpex) * ratio;
    const capex = capexPath[m]!;
    const need = opex + capex;

    // Withdrawal strategy: a cap on this month's draws, and the spending required.
    const yearStart = free && (m - plan.startIdx) % 12 === 0;
    let drawCap = Infinity;
    let required = need;
    let target = need;
    if (free) {
      switch (strat.kind) {
        case 'percent':
          if (yearStart) annualAllowance = strat.rate * cap;
          drawCap = annualAllowance / 12;
          break;
        case 'guardrails':
          if (m === plan.startIdx) {
            guardW =
              strat.initialRate !== undefined
                ? strat.initialRate * cap
                : Math.max(0, need - project) * 12;
            guardWR0 = cap > 0 ? guardW / cap : 0;
          } else if (yearStart && cap > 0) {
            const wr = guardW / cap;
            if (wr > guardWR0 * (1 + strat.band)) guardW *= 1 - strat.adjust;
            else if (wr < guardWR0 * (1 - strat.band)) guardW *= 1 + strat.adjust;
          }
          required = strat.minSpendFraction * need;
          target = Math.min(need, Math.max(required, pay + project + guardW / 12));
          drawCap = guardW / 12;
          break;
        case 'skim': {
          let skim = 0;
          for (const j of sellIdx) {
            const h = st[w.holdings[j]!]!;
            skim += Math.max(0, gain[j]! - (strat.threshold / 12) * h);
          }
          drawCap = skim;
          break;
        }
        default:
          break;
      }
    }

    // Fund tax first, then spending, from bank and income, then by selling.
    const outWanted = taxDue + target;
    const cashIn = bank + pay + project;
    let deficit = Math.max(0, outWanted - cashIn);
    let drawn = 0;
    if (deficit > 0) {
      for (const j of sellIdx) {
        if (m < plan.accessibleFrom[j]!) continue;
        const take = Math.min(deficit, avail[j]!, drawCap - drawn);
        if (!(take > 0)) continue;
        draw[j] = take;
        drawn += take;
        deficit -= take;
        if (deficit <= 0 || drawn >= drawCap) break;
      }
    }
    const funds = cashIn + drawn;
    const taxPaid = Math.min(taxDue, funds);
    const spendable = Math.max(0, funds - taxPaid);
    const spend = Math.min(target, spendable);
    const f = target > 0 ? spend / target : 1;
    taxDue -= taxPaid;
    taxTotal += taxPaid;
    totalSpend += spend;
    const short = free && spend + 1e-6 < required;
    if (short) shortfallMonths++;

    // Invest surplus above the bank buffer (never in a month that sold).
    let bankEnd = funds - taxPaid - spend;
    const buffer = dollars(s.decisions.bankBuffer);
    if (drawn === 0 && bankEnd > buffer) {
      const surplus = bankEnd - buffer;
      let put = 0;
      for (let j = 0; j < H; j++) {
        const c = surplus * plan.allocation[j]!;
        if (c > 0) {
          contrib[j] = c;
          put += c;
        }
      }
      bankEnd -= put;
    }

    // Set this month's rates. Each change carries its cause (SPEC §11.2 step 5).
    setK(w, w.e.pay, pay, w.cause.pay);
    setK(w, w.e.project, project, w.cause.project);
    const spendCause = short ? w.cause.shortfall : w.cause.spend;
    setK(w, w.e.opex, opex * f, spendCause);
    setK(w, w.e.capex, capex * f, spendCause);
    setK(w, w.e.tax, taxPaid, w.cause.tax);
    for (let j = 0; j < H; j++) {
      setK(w, w.e.gain[j]!, gain[j]!, w.cause.returns);
      setK(w, w.e.loss[j]!, loss[j]!, w.cause.returns);
      setK(w, w.e.draw[j]!, draw[j]!, w.cause.draw);
      setK(w, w.e.contrib[j]!, contrib[j]!, w.cause.invest);
    }

    prev.set(st);
    inst.step(1);
    inst.stateInto(st);

    // FR-SIM-003: the change in money held by the household and the sinks
    // equals the inflow from the pools (each pool edge moved exactly its k).
    // The pools themselves must have paid out exactly that, to the precision
    // their size allows.
    let inflow = pay + project;
    for (let j = 0; j < H; j++) inflow += gain[j]!;
    let poolDelta = 0;
    let delta = 0;
    for (let i = 0; i < st.length; i++) {
      const d = st[i]! - prev[i]!;
      if (w.isPool[i]) poolDelta += d;
      else delta += d;
    }
    const hh = household(st);
    const drift = Math.abs(delta - inflow) / Math.max(1, hh);
    if (drift > maxDrift) maxDrift = drift;
    if (Math.abs(poolDelta + inflow) > 1e-3) valid = false;
    for (const p of w.pools) if (st[p]! < 0) valid = false;
    if (st[w.bank]! < -1e-6) valid = false;
    capital[m + 1] = hh;
    if (crossMonth < 0 && hh >= plan.crossing) crossMonth = m + 1;

    // Tax accrual for this month; it is paid next month (PAYG-style).
    if (plan.tax) {
      if (working) {
        year.salary[0] += plan.salary[0] / 12;
        year.salary[1] += plan.salary[1] / 12;
      }
      if (free) year.income[0] += project;
      for (let j = 0; j < H; j++) {
        const [a, b] = plan.shares[j]!;
        const h0 = prev[w.holdings[j]!]!;
        if (plan.taxed[j]) {
          const inc = (h0 * plan.incomeYield[j]!) / 12;
          year.income[0] += inc * a;
          year.income[1] += inc * b;
          costBase[j]! += inc; // reinvested income is taxed, so it adds to the cost base
          if (draw[j]! > 0 && avail[j]! > 0) {
            const costShare = (costBase[j]! * draw[j]!) / avail[j]!;
            const g = draw[j]! - costShare;
            costBase[j]! -= costShare;
            const disc = plan.heldBefore[j]! + m >= plan.tax.cgtDiscount.minHoldingMonths;
            for (const [p, sh] of [
              [0, a],
              [1, b],
            ] as [0 | 1, number][]) {
              if (sh === 0) continue;
              if (g < 0) year.loss[p] += -g * sh;
              else if (disc) year.gainDisc[p] += g * sh;
              else year.gainNon[p] += g * sh;
            }
          }
        }
        costBase[j]! += contrib[j]!;
      }
      const liability = personTax(plan.tax, year, 0).tax + personTax(plan.tax, year, 1).tax;
      const inc = Math.max(0, liability - year.accrued);
      year.accrued += inc;
      taxDue += inc;
      // Financial year ends in June: carry net capital losses forward.
      const calMonth = ((startMonthOfYear - 1 + m) % 12) + 1;
      if (calMonth === 6) {
        year = newYear([
          personTax(plan.tax, year, 0).netLoss,
          personTax(plan.tax, year, 1).netLoss,
        ]);
      }
    }

    if (free) {
      if (hh < minCapital) minCapital = hh;
      if (ruinMonth < 0 && (short || hh < plan.floor)) ruinMonth = m;
    }
  }

  if (maxDrift > 1e-9) valid = false;
  return {
    summary: {
      run,
      seed: runSeed.toString(),
      success: ruinMonth < 0,
      ruinMonth,
      shortfallMonths,
      minCapital: minCapital === Infinity ? capital[n]! : minCapital,
      endCapital: capital[n]!,
      totalTax: taxTotal,
      totalSpend,
      crossMonth,
      maxDrift,
      valid,
    },
    capital,
  };
}
