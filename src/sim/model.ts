/**
 * The freedom model's inputs (SPEC §5 Holding/Goal/Scenario, §11). All money
 * is real (today's dollars) in minor units unless a field says otherwise.
 */
import type { Asset, Provenance } from '../domain/types.ts';
import type { QuantileKey } from '../forecast/ref/stats.ts';

export type AssetClass =
  'cash' | 'term_deposit' | 'equity' | 'property' | 'btc' | 'super' | 'other';

export interface Holding {
  id: string;
  name: string;
  assetClass: AssetClass;
  /** Current value, minor units. */
  value: bigint;
  /** Purchase cost, for capital gains tax; defaults to the value (no embedded gain). */
  costBase?: bigint;
  acquiredAt?: string;
  returnModelId: string;
  /** Not available to spend before this date (super preservation age). */
  accessibleFrom?: string;
  /** Owner for tax: one person, or shared equally. */
  owner?: 'p1' | 'p2' | 'joint';
  provenance: Provenance;
}

/** Return models (FR-FC-020). Rates are annual and real. */
export type ReturnModel =
  | { id: string; kind: 'fixed'; rate: number; incomeYield: number; label: string }
  | { id: string; kind: 'lognormal'; mu: number; sigma: number; incomeYield: number; label: string }
  | {
      id: string;
      kind: 'student-t';
      mu: number;
      sigma: number;
      nu: number;
      incomeYield: number;
      label: string;
    }
  | {
      id: string;
      kind: 'block-bootstrap';
      seriesId: string;
      block: number;
      incomeYield: number;
      label: string;
    };

/**
 * Default return assumptions (labelled `assumed` wherever shown). Real,
 * after inflation. incomeYield is the taxable income share of the return
 * (interest, dividends); the rest is capital growth.
 */
export const DEFAULT_RETURN_MODELS: ReturnModel[] = [
  {
    id: 'cash',
    kind: 'fixed',
    rate: 0.005,
    incomeYield: 0.005,
    label: 'Cash: 0.5 % real, all interest',
  },
  {
    id: 'term-deposit',
    kind: 'fixed',
    rate: 0.01,
    incomeYield: 0.01,
    label: 'Term deposit: 1 % real',
  },
  {
    id: 'equity',
    kind: 'lognormal',
    mu: 0.045,
    sigma: 0.16,
    incomeYield: 0.035,
    label: 'Shares: lognormal, 4.5 % real mean, 16 % volatility',
  },
  {
    id: 'equity-bootstrap',
    kind: 'block-bootstrap',
    seriesId: 'synthetic-equity',
    block: 12,
    incomeYield: 0.035,
    label: 'Shares: block bootstrap of an illustrative history',
  },
  {
    id: 'property',
    kind: 'lognormal',
    mu: 0.02,
    sigma: 0.08,
    incomeYield: 0,
    label: 'Property: 2 % real growth, 8 % volatility',
  },
  {
    id: 'btc',
    kind: 'student-t',
    mu: 0.08,
    sigma: 0.65,
    nu: 3.5,
    incomeYield: 0,
    label: 'Bitcoin: fat-tailed, 8 % real mean, 65 % volatility',
  },
  {
    id: 'btc-bootstrap',
    kind: 'block-bootstrap',
    seriesId: 'synthetic-btc',
    block: 12,
    incomeYield: 0,
    label: 'Bitcoin: block bootstrap of an illustrative history',
  },
  {
    id: 'super',
    kind: 'lognormal',
    mu: 0.04,
    sigma: 0.11,
    incomeYield: 0,
    label: 'Super (balanced, after 15 % earnings tax): 4 % real, 11 % volatility',
  },
];

export const DEFAULT_MODEL_FOR: Record<AssetClass, string> = {
  cash: 'cash',
  term_deposit: 'term-deposit',
  equity: 'equity',
  property: 'property',
  btc: 'btc',
  super: 'super',
  other: 'equity',
};

export interface Goal {
  id: string;
  name: string;
  tier: string;
  /** When passive living begins (paid work stops). */
  start: string;
  horizonYears: number;
  /** Real capital never below this, minor units. */
  floor: bigint;
  targetProbability: number;
  /** Real income from chosen work after start, minor units per year. */
  projectIncome?: bigint;
}

export type WithdrawalStrategy =
  | { kind: 'fixed-real' }
  | { kind: 'percent'; rate: number }
  | {
      kind: 'guardrails';
      initialRate?: number;
      band: number;
      adjust: number;
      minSpendFraction: number;
    }
  | { kind: 'skim'; threshold: number }
  | { kind: 'hold'; holdingIds: string[] };

export interface TaxPerson {
  id: 'p1' | 'p2';
  name: string;
  /** Gross salary before freedom starts, minor units per year (for the marginal rate). */
  grossSalary: bigint;
}

export interface Decisions {
  withdrawal: WithdrawalStrategy;
  /** Order in which holdings are sold to fund spending. */
  sellOrder: string[];
  /** Where surplus cash is invested, holding id → weight. */
  allocation: Record<string, number>;
  /** Cash kept in the bank before surplus is invested, minor units. */
  bankBuffer: bigint;
  /** Paid work continues until this date (default: the goal's start). */
  workUntil?: string;
  /** Net take-home pay per month while working, minor units (default: from the ledger). */
  netPayMonthly?: bigint;
}

export interface Assumption {
  key: string;
  value: number | string;
  unit?: string;
  source: string;
  provenance: Provenance;
}

export interface Scenario {
  id: string;
  name: string;
  seed: string;
  /** First simulated month (YYYY-MM); t = 0. */
  asOf: string;
  goal: Goal;
  holdings: Holding[];
  decisions: Decisions;
  people: TaxPerson[];
  returnModels: ReturnModel[];
  cpi: number;
  /** Tax table id (`au-2025-26`), or null to simulate before tax (the spreadsheet bridge). */
  taxTable: string | null;
  /** Imported monthly real log-return histories for bootstrap models, by series id. */
  histories?: Record<string, number[]>;
  /** Each run draws its return models' mean and volatility first (FR-BAY-004). */
  parameterUncertainty?: boolean;
}

/**
 * A household's spending need, in real dollars per month (floats: these are
 * model rates, not stored money). Built from the budget and the forecast.
 */
export interface SpendingInput {
  /** Before freedom: current spending per group. */
  current: Record<string, number>;
  /** After freedom: the goal tier's budget per group. */
  tier: Record<string, number>;
  /** Where `tier` came from: budget lines, or current spending when there are none. */
  tierSource?: 'budgeted' | 'actual';
  /**
   * Uncertainty of total OPEX as quantile paths of a multiplier around 1, per
   * month (from the forecast); held at the last month beyond its end. Null: none.
   */
  ratio: Record<QuantileKey, number[]> | null;
  /** Capital items in the goal tier, sampled per run (FR-FC-010). */
  assets: Asset[];
  /** Annualised CAPEX of the goal tier per month, for the deterministic freedom number. */
  capexMonthly: number;
}
