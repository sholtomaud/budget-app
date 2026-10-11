import personaSchema from '../../schemas/persona.schema.json' with { type: 'json' };
import { isValidTimeZone } from '../lib/dates.ts';
import { formatError, validate, type Schema } from '../lib/jsonschema.ts';

export type Every = 'day' | 'week' | 'fortnight' | 'month' | 'quarter' | 'year';

export interface PersonaAccount {
  id: string;
  name?: string;
  role: 'transaction' | 'savings' | 'offset' | 'credit' | 'loan' | 'investment' | 'super';
  productCategory: string;
  opening?: string;
  interestPa?: number;
  limit?: string;
  buffer?: string;
}

export interface Persona {
  name: string;
  description?: string;
  timezone: string;
  start: string;
  months: number;
  accounts: PersonaAccount[];
  income: {
    name: string;
    payer?: string;
    category?: string;
    amount: string;
    every: Every;
    jitter?: number;
    rises?: { on: string; pct: number }[];
  }[];
  recurring?: {
    category: string;
    payee?: string;
    amount?: string;
    mean?: string;
    every: Every;
    seasonality?: 'none' | 'winter_peak' | 'summer_peak';
    cv?: number;
    via?: 'DIRECT_DEBIT' | 'PAYMENT' | 'TRANSFER_OUTGOING';
    account?: string;
    mcc?: string;
  }[];
  variable?: {
    category: string;
    weeklyMean?: string;
    cv?: number;
    visitsPerWeek?: number;
    dailyProb?: number;
    amount?: { lognormal: number[] };
    merchants?: string[];
    mcc?: string;
    account?: string;
  }[];
  capex?: {
    asset: string;
    category?: string;
    merchant?: string;
    mcc?: string;
    cost: string | { normal: number[] };
    lifeYears?: number;
    shape?: number;
    lastBought?: string;
    wish?: boolean;
    buyProbPerYear?: number;
    every?: 'year';
    month?: number[];
    account?: string;
  }[];
  investing?: {
    to: string;
    amount: string;
    every: Every;
    kind?: 'investment';
    category?: string;
  }[];
  noise?: {
    pendingThenPosted?: number;
    duplicatePages?: number;
    merchantNameVariants?: boolean;
    refunds?: number;
    fees?: boolean;
    missingTransactionId?: number;
    /** Share of card purchases exported without a merchantCategoryCode. */
    missingMcc?: number;
    /** Share of card purchases with a plausible but wrong code. */
    wrongMcc?: number;
  };
  pageSize?: number;
}

/** Validate a persona against schemas/persona.schema.json plus cross-field rules. */
export function parsePersona(value: unknown): Persona {
  const err = validate(personaSchema as Schema, value);
  if (err) throw new Error(`Invalid persona: ${formatError(err)}`);
  const p = value as Persona;
  if (!isValidTimeZone(p.timezone))
    throw new Error(`Invalid persona: unknown timezone ${p.timezone}`);
  const ids = new Set(p.accounts.map((a) => a.id));
  if (!p.accounts.some((a) => a.role === 'transaction')) {
    throw new Error('Invalid persona: needs a transaction account');
  }
  const refs = [...(p.recurring ?? []), ...(p.variable ?? []), ...(p.capex ?? [])]
    .map((x) => x.account)
    .filter((a): a is string => a !== undefined);
  for (const a of refs) if (!ids.has(a)) throw new Error(`Invalid persona: unknown account ${a}`);
  for (const r of p.recurring ?? []) {
    if (!r.amount && !r.mean)
      throw new Error(`Invalid persona: recurring ${r.category} needs amount or mean`);
  }
  for (const v of p.variable ?? []) {
    if (!v.weeklyMean && v.dailyProb === undefined) {
      throw new Error(`Invalid persona: variable ${v.category} needs weeklyMean or dailyProb`);
    }
  }
  return p;
}
