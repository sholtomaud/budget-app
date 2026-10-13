/**
 * From the household's data to the freedom model's inputs (SPEC §11): a
 * default setup from the ledger, budget and CAPEX register, and the spending
 * need for a tier. Every derived value carries a provenance label; anything
 * the data cannot tell us (market value of investments, gross salary) is
 * labelled `assumed` and is editable on the Freedom screen.
 */
import ESSENTIALS from '../../data-tables/essentials.json' with { type: 'json' };
import type { BudgetState } from '../budget/state.ts';
import { annualisedCapexPerWeek, inTier } from '../budget/capex.ts';
import { weeklyRate } from '../budget/model.ts';
import { perWeek } from '../budget/periods.ts';
import type { Account, Asset, BalanceCheckpoint, Provenance, Txn } from '../domain/types.ts';
import type { Quantiles } from '../forecast/opex.ts';
import { QUANTILE_KEYS } from '../forecast/ref/stats.ts';
import { coveredMonths, monthlySeries } from '../forecast/series.ts';
import { addMonths } from '../lib/dates.ts';
import {
  DEFAULT_MODEL_FOR,
  DEFAULT_RETURN_MODELS,
  type AssetClass,
  type Decisions,
  type Goal,
  type Holding,
  type ReturnModel,
  type Scenario,
  type SpendingInput,
  type TaxPerson,
} from './model.ts';
import { taxTable, totalTax } from './tax.ts';

export const DEFAULT_TAX_TABLE = 'au-2025-26';

/** What the user edits on the Freedom screen; persisted. Money in minor units. */
export interface FreedomSetup {
  version: 1;
  seed: string;
  goal: Goal;
  holdings: Holding[];
  decisions: Decisions;
  people: TaxPerson[];
  returnModels: ReturnModel[];
  taxTable: string | null;
  /** Labels for the derived defaults, keyed by field. */
  provenance: Record<string, Provenance>;
  /** Spending levers (SPEC §11.3): multipliers on the tier's and today's spending. Default 1. */
  levers?: SpendingLevers;
  /** Uncertainty about average returns (FR-BAY-004). Default on. */
  returnUncertainty?: boolean;
}

export interface SpendingLevers {
  /** Multiplier on the tier's spending after freedom. */
  tierSpend: number;
  /** Multiplier on today's spending before freedom (below 1 saves more). */
  currentSpend: number;
}

export const NO_LEVERS: SpendingLevers = { tierSpend: 1, currentSpend: 1 };

/** The spending need with the setup's levers applied. CAPEX is not scaled. */
export function applySpendingLevers(
  sp: SpendingInput,
  levers: SpendingLevers = NO_LEVERS
): SpendingInput {
  const scale = (r: Record<string, number>, k: number) =>
    Object.fromEntries(Object.entries(r).map(([g, v]) => [g, v * k]));
  return {
    ...sp,
    current: scale(sp.current, levers.currentSpend),
    tier: scale(sp.tier, levers.tierSpend),
  };
}

export interface HouseholdData {
  accounts: Account[];
  balances: BalanceCheckpoint[];
  txns: Txn[];
  assets: Asset[];
  budget: BudgetState;
}

/** The first month to simulate: the month after the last complete month of data, or this month. */
export function asOfFor(
  txns: readonly Txn[],
  today = new Date().toISOString().slice(0, 10)
): string {
  const months = coveredMonths(txns);
  return months.length ? addMonths(`${months.at(-1)}-01`, 1).slice(0, 7) : today.slice(0, 7);
}

/** Latest balance per account. */
export function latestBalances(balances: readonly BalanceCheckpoint[]): Map<string, bigint> {
  const latest = new Map<string, BalanceCheckpoint>();
  for (const b of balances) {
    const cur = latest.get(b.accountId);
    if (!cur || b.asAt > cur.asAt) latest.set(b.accountId, b);
  }
  return new Map([...latest].map(([id, b]) => [id, b.current]));
}

const classOfInvestment = (categoryId: string): AssetClass =>
  /btc|crypto|bitcoin/i.test(categoryId)
    ? 'btc'
    : /super/i.test(categoryId)
      ? 'super'
      : /property/i.test(categoryId)
        ? 'property'
        : 'equity';

const NAMES: Record<AssetClass, string> = {
  cash: 'Savings',
  term_deposit: 'Term deposit',
  equity: 'Shares',
  property: 'Property',
  btc: 'Bitcoin',
  super: 'Super',
  other: 'Other',
};

/** Sell the most liquid first; super and property last. */
const SELL_RANK: AssetClass[] = [
  'cash',
  'term_deposit',
  'equity',
  'btc',
  'other',
  'super',
  'property',
];

const lastN = <T>(xs: readonly T[], n: number) => xs.slice(Math.max(0, xs.length - n));

/** Average monthly net income from the last 12 complete months (salary and other income, not interest). */
export function netIncomeMonthly(txns: readonly Txn[]): number {
  const months = new Set(lastN(coveredMonths(txns), 12));
  if (!months.size) return 0;
  let total = 0;
  for (const t of txns) {
    const c = t.classification;
    if (!c || t.supersededBy || t.transferPairId || c.kind !== 'income') continue;
    if (!months.has(t.date.slice(0, 7))) continue;
    total += Number(t.amount);
  }
  return total / months.size;
}

/** Gross salary whose after-tax pay is `netAnnual` (dollars), by bisection. Labelled assumed. */
export function grossFromNet(netAnnual: number, table = taxTable(DEFAULT_TAX_TABLE)): number {
  if (netAnnual <= 0) return 0;
  let lo = netAnnual;
  let hi = netAnnual * 3;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (mid - totalTax(table, mid) < netAnnual) lo = mid;
    else hi = mid;
  }
  return hi;
}

export function defaultSetup(d: HouseholdData, today?: string): FreedomSetup {
  const asOf = asOfFor(d.txns, today);
  const bal = latestBalances(d.balances);
  const holdings: Holding[] = [];
  let bank = 0n;
  for (const a of d.accounts) {
    const v = bal.get(a.id) ?? 0n;
    if (a.role === 'transaction' || a.role === 'offset') bank += v > 0n ? v : 0n;
    else if (a.role === 'savings' && v > 0n)
      holdings.push({
        id: `acct-${a.id}`,
        name: a.displayName,
        assetClass: 'cash',
        value: v,
        returnModelId: DEFAULT_MODEL_FOR.cash,
        owner: 'p1',
        provenance: 'actual',
      });
  }

  // Investments the ledger saw money go into. Their market value is unknown:
  // start from what was paid in, labelled assumed.
  const months = new Set(lastN(coveredMonths(d.txns), 12));
  const paidIn = new Map<string, { total: bigint; first: string; recent: number }>();
  for (const t of d.txns) {
    const c = t.classification;
    if (!c || t.supersededBy || c.kind !== 'investment' || t.amount >= 0n) continue;
    const cur = paidIn.get(c.categoryId) ?? { total: 0n, first: t.date, recent: 0 };
    cur.total += -t.amount;
    if (t.date < cur.first) cur.first = t.date;
    if (months.has(t.date.slice(0, 7))) cur.recent += Number(-t.amount);
    paidIn.set(c.categoryId, cur);
  }
  const allocation: Record<string, number> = {};
  for (const [cat, p] of [...paidIn].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const cls = classOfInvestment(cat);
    const id = `inv-${cat}`;
    holdings.push({
      id,
      name: NAMES[cls],
      assetClass: cls,
      value: p.total,
      costBase: p.total,
      acquiredAt: p.first,
      returnModelId: DEFAULT_MODEL_FOR[cls],
      owner: 'p1',
      provenance: 'assumed',
    });
    if (p.recent > 0) allocation[id] = p.recent;
  }
  if (!Object.keys(allocation).length) {
    const cash = holdings.find((h) => h.assetClass === 'cash');
    if (cash) allocation[cash.id] = 1;
  }

  const net = netIncomeMonthly(d.txns) / 100;
  const gross = grossFromNet(net * 12);
  const tier =
    d.budget.tiers.find((t) => t.id === 'independent')?.id ??
    d.budget.tiers[0]?.id ??
    'independent';
  const start = addMonths(`${asOf}-01`, 60);
  const sellOrder = [...holdings]
    .sort((a, b) => SELL_RANK.indexOf(a.assetClass) - SELL_RANK.indexOf(b.assetClass))
    .map((h) => h.id);
  return {
    version: 1,
    seed: '42',
    goal: {
      id: 'goal-1',
      name: 'Freedom',
      tier,
      start,
      horizonYears: 35,
      floor: 0n,
      targetProbability: 0.9,
    },
    holdings,
    decisions: {
      withdrawal: { kind: 'fixed-real' },
      sellOrder,
      allocation,
      bankBuffer: bank,
      netPayMonthly: BigInt(Math.round(net * 100)),
    },
    people: [{ id: 'p1', name: 'You', grossSalary: BigInt(Math.round(gross * 100)) }],
    returnModels: DEFAULT_RETURN_MODELS,
    taxTable: DEFAULT_TAX_TABLE,
    provenance: {
      bankBuffer: 'actual',
      netPayMonthly: 'actual',
      grossSalary: 'assumed',
      goal: 'assumed',
      returns: 'assumed',
    },
  };
}

export function scenarioFrom(setup: FreedomSetup, asOf: string, cpi: number): Scenario {
  return {
    id: setup.goal.id,
    name: setup.goal.name,
    seed: setup.seed,
    asOf,
    goal: setup.goal,
    holdings: setup.holdings,
    decisions: setup.decisions,
    people: setup.people,
    returnModels: setup.returnModels,
    cpi,
    taxTable: setup.taxTable,
    parameterUncertainty: setup.returnUncertainty ?? true,
  };
}

const groupOf = (categoryId: string) => categoryId.split('.')[0] ?? categoryId;

/**
 * The spending need (dollars per month, real): current spending per group
 * from the last 12 complete months, the tier's budget per group (current
 * spending where there is no budget), the forecast's spread as a multiplier,
 * and the tier's capital items.
 */
export function spendingFrom(
  d: HouseholdData,
  tier: string,
  opexTotal: Quantiles | null = null
): SpendingInput {
  const current: Record<string, number> = {};
  for (const s of monthlySeries(d.txns)) {
    const vals = lastN(s.values, 12);
    if (!vals.length) continue;
    const g = groupOf(s.categoryId);
    current[g] = (current[g] ?? 0) + vals.reduce((a, b) => a + b, 0) / vals.length / 100;
  }
  // A group that took in more than it spent (refunds aside, usually pay or a
  // transfer filed under a spending category) is no spending, never negative:
  // negative spending would make money appear from nowhere.
  const credits = Object.keys(current)
    .filter((g) => current[g]! < 0)
    .sort();
  for (const g of credits) current[g] = 0;
  const budget: Record<string, number> = {};
  for (const l of d.budget.lines) {
    const g = groupOf(l.categoryId);
    if (g === 'capex') continue; // capital lines are the register's job
    const monthly = (weeklyRate(l, tier, (c) => perWeek(c, d.budget.periods)) * 52) / 12 / 100;
    budget[g] = (budget[g] ?? 0) + monthly;
  }
  const hasBudget = Object.keys(budget).length > 0;
  let ratio: SpendingInput['ratio'] = null;
  if (opexTotal && opexTotal.p50.length) {
    ratio = Object.fromEntries(
      QUANTILE_KEYS.map((k) => [
        k,
        opexTotal[k].map((v, i) => (opexTotal.p50[i]! > 0 ? v / opexTotal.p50[i]! : 1)),
      ])
    ) as Quantiles;
  }
  const assets = d.assets.filter((a) => inTier(a, tier, d.budget.tiers));
  const essentials = essentialsFrom(d);
  return {
    current,
    tier: hasBudget ? budget : { ...current },
    tierSource: hasBudget ? 'budgeted' : 'actual',
    ratio,
    assets,
    capexMonthly: (annualisedCapexPerWeek(d.assets, tier, d.budget.tiers) * 52) / 12 / 100,
    ...(credits.length ? { credits } : {}),
    ...(essentials ? { essentials } : {}),
  };
}

/** Is a category one of the essentials (ADR 0033)? */
export const isEssential = (categoryId: string, list: readonly string[] = ESSENTIALS.categories) =>
  list.some((e) => categoryId === e || categoryId.startsWith(`${e}.`));

/**
 * What essentials cost a month: actual (last 12 months, per category, credits
 * as no spending) or the lowest tier's budget for them, whichever is more.
 */
export function essentialsFrom(d: HouseholdData): SpendingInput['essentials'] | undefined {
  const actual = new Map<string, number>();
  for (const s of monthlySeries(d.txns)) {
    if (!isEssential(s.categoryId)) continue;
    const vals = lastN(s.values, 12);
    if (!vals.length) continue;
    const m = Math.max(0, vals.reduce((a, b) => a + b, 0) / vals.length / 100);
    if (m > 0) actual.set(s.categoryId, m);
  }
  const lowest = d.budget.tiers[0]?.id;
  const budgeted = new Map<string, number>();
  if (lowest)
    for (const l of d.budget.lines) {
      if (!isEssential(l.categoryId)) continue;
      const m = (weeklyRate(l, lowest, (c) => perWeek(c, d.budget.periods)) * 52) / 12 / 100;
      if (m > 0) budgeted.set(l.categoryId, (budgeted.get(l.categoryId) ?? 0) + m);
    }
  const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const a = total(actual);
  const b = total(budgeted);
  if (a <= 0 && b <= 0) return undefined;
  const use = a >= b ? actual : budgeted;
  return {
    monthly: Math.max(a, b),
    source: a >= b ? 'actual' : 'budgeted',
    top: [...use.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 4)
      .map(([categoryId, monthly]) => ({ categoryId, monthly })),
  };
}

/**
 * The smallest spending-after-freedom lever that still pays for the
 * essentials: the floor every search and proposal respects (ADR 0033).
 * `spending` has the setup's levers applied; `lever` is the one applied.
 */
export function minTierSpend(spending: SpendingInput, lever: number): number {
  const e = spending.essentials?.monthly ?? 0;
  const tier = Object.values(spending.tier).reduce((a, b) => a + b, 0) / Math.max(1e-9, lever);
  if (e <= 0 || tier <= 0) return 0;
  return Math.ceil((e / tier) * 100) / 100;
}
