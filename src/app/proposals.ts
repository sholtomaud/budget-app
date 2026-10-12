/**
 * Changes the chat panel proposes (ADR 0023). Nothing is written until the
 * person clicks Apply on the card; every Apply returns an Undo. Built-in
 * answers and the AI's tools build proposals the same way.
 */
import type { BudgetLine } from '../budget/model.ts';
import { categoryName } from '../classify/categories.ts';
import { defaultLife } from '../classify/service.ts';
import type { Asset } from '../domain/types.ts';
import type { DataView } from '../data/service.ts';
import { txnKey } from '../ingest/ids.ts';
import { addMonths } from '../lib/dates.ts';
import type { FreedomSetup } from '../sim/inputs.ts';
import { addAsset, clearLabel, correct, deleteAsset, deleteLine, upsertLine } from './data.ts';
import { addScenario, loadScenarios, saveScenarios } from './scenarios.ts';
import { sim } from './workers.ts';

export type Proposal =
  | { kind: 'budget-line'; line: BudgetLine }
  | { kind: 'asset'; asset: Asset; ageYears?: number }
  | { kind: 'categorise'; keys: string[]; categoryId: string; match: string; examples: string[] }
  | { kind: 'scenario'; name: string; setup: FreedomSetup; summary: string }
  /** A change to the current plan on the Freedom screen (a plan check's fix, ADR 0026). */
  | { kind: 'setup'; label: string; setup: FreedomSetup; from: FreedomSetup; summary: string };

/** Fired when the current plan is changed from outside the Freedom screen. */
export const SETUP_CHANGED = 'app:setup-changed';

export const PERIOD_WORDS: Record<string, string> = {
  d: 'a day',
  w: 'a week',
  f: 'a fortnight',
  m: 'a month',
  q: 'a quarter',
  y: 'a year',
};

/** Words that point at a category, beyond its own name. */
const SYNONYMS: Record<string, string[]> = {
  'capex.transport': ['car', 'bike', 'bicycle', 'vehicle', 'scooter', 'motorbike', 'ute'],
  'capex.computing': ['laptop', 'computer', 'phone', 'iphone', 'tablet', 'ipad', 'pc', 'monitor'],
  'capex.furniture': ['couch', 'sofa', 'bed', 'desk', 'table', 'chair', 'mattress'],
  'capex.appliances': [
    'fridge',
    'washing machine',
    'dryer',
    'dishwasher',
    'oven',
    'tv',
    'television',
  ],
  'capex.photography': ['camera', 'lens'],
  'capex.personal': ['watch', 'pen', 'jewellery'],
  'capex.travel': ['holiday', 'trip', 'flight', 'flights'],
};

/** Everyday spending categories (not income, capital, investments, tax or transfers). */
const isSpending = (id: string) => !/^(capex|income|investment|tax|transfer)\./.test(id);

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);

/** The category whose name, id or synonyms best match the text; undefined if none do. */
export function guessCategory(
  text: string,
  v: DataView,
  filter: (id: string) => boolean
): string | undefined {
  const t = ` ${text.toLowerCase()} `;
  const tw = new Set(words(text));
  let best: { id: string; score: number } | undefined;
  for (const c of v.categories) {
    if (!filter(c.id)) continue;
    let score = 0;
    for (const w of new Set([...words(c.name), ...words(c.id.replace(/^[^.]*\./, ''))]))
      if (tw.has(w) || tw.has(`${w}s`) || tw.has(w.replace(/s$/, ''))) score += 2;
    for (const syn of SYNONYMS[c.id] ?? [])
      if (t.includes(` ${syn} `) || t.includes(` ${syn}s `)) score += 3;
    if (score > (best?.score ?? 0)) best = { id: c.id, score };
  }
  return best?.id;
}

export function budgetLineProposal(
  v: DataView,
  item: string,
  amountDollars: number,
  period: string,
  categoryHint?: string
): Proposal {
  const categoryId =
    guessCategory(`${categoryHint ?? ''} ${item}`, v, isSpending) ?? 'shopping.general';
  return {
    kind: 'budget-line',
    line: {
      id: `chat-${Date.now().toString(36)}`,
      categoryId,
      item: item.charAt(0).toUpperCase() + item.slice(1),
      cost: BigInt(Math.round(amountDollars * 100)),
      ccy: 'AUD',
      period: PERIOD_WORDS[period] ? period : 'm',
      tierMultiplier: Object.fromEntries(v.budget.tiers.map((t) => [t.id, 1])),
      notes: 'Added from the chat panel',
    },
  };
}

export function assetProposal(
  v: DataView,
  name: string,
  opts: { costDollars?: number; ageYears?: number; today?: string } = {}
): Proposal {
  const categoryId = guessCategory(name, v, (id) => id.startsWith('capex.')) ?? 'capex.personal';
  const def = defaultLife(categoryId);
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const asset: Asset = {
    id: `asset-chat-${Date.now().toString(36)}`,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    categoryId,
    cost: { minor: BigInt(Math.round((opts.costDollars ?? 0) * 100)), ccy: 'AUD' },
    life: { meanYears: def.meanYears, shape: def.shape },
    lifeAssumed: true,
    replace: true,
    status: 'owned',
    linkedTxnIds: [],
    provenance: 'budgeted',
  };
  if (opts.ageYears !== undefined)
    asset.purchasedAt = addMonths(`${today.slice(0, 7)}-01`, -Math.round(opts.ageYears * 12));
  return {
    kind: 'asset',
    asset,
    ...(opts.ageYears !== undefined ? { ageYears: opts.ageYears } : {}),
  };
}

/** Transactions whose merchant or description contains `match`, for a category named like `category`. */
export function categoriseProposal(
  v: DataView,
  match: string,
  category: string
): Proposal | { error: string } {
  const categoryId =
    v.categories.find((c) => c.name.toLowerCase() === category.toLowerCase())?.id ??
    guessCategory(category, v, () => true);
  if (!categoryId) return { error: `There is no category like "${category}".` };
  const m = match.toLowerCase().replace(/s$/, '');
  const hits = v.txns.filter(
    (t) =>
      !t.supersededBy &&
      t.amount < 0n &&
      `${t.merchantName ?? ''} ${t.description}`.toLowerCase().includes(m) &&
      t.classification?.categoryId !== categoryId
  );
  if (!hits.length)
    return {
      error: `No transactions mention "${match}" outside ${categoryName(categoryId, v.categories)}.`,
    };
  return {
    kind: 'categorise',
    keys: hits.map((t) => txnKey(t.accountId, t.id)),
    categoryId,
    match,
    examples: [...new Set(hits.map((t) => t.merchantName ?? t.description))].slice(0, 3),
  };
}

/** One sentence saying what the card would change. */
export function describe(p: Proposal, v: DataView): string {
  switch (p.kind) {
    case 'budget-line':
      return `Add a budget line: ${p.line.item}, $${(Number(p.line.cost) / 100).toFixed(2)} ${PERIOD_WORDS[p.line.period] ?? p.line.period}, in ${categoryName(p.line.categoryId, v.categories)}.`;
    case 'asset':
      return `Add to Big purchases: ${p.asset.name} (${categoryName(p.asset.categoryId, v.categories)}), expected to last about ${p.asset.life.meanYears} years${p.ageYears !== undefined ? `, now ${p.ageYears} years old` : ''}${p.asset.cost.minor > 0n ? `, $${(Number(p.asset.cost.minor) / 100).toLocaleString('en-AU')} to replace` : ''}.`;
    case 'categorise':
      return `Put ${p.keys.length} transaction${p.keys.length === 1 ? '' : 's'} mentioning "${p.match}" (${p.examples.join(', ')}) in ${categoryName(p.categoryId, v.categories)}, and remember it for similar ones.`;
    case 'scenario':
      return `Save as a scenario to compare, without changing your plan: ${p.summary}`;
    case 'setup':
      return `${p.label}: ${p.summary}.`;
  }
}

/** Apply a proposal; returns how to undo it. */
export async function applyProposal(p: Proposal): Promise<() => Promise<void>> {
  switch (p.kind) {
    case 'budget-line':
      await upsertLine(p.line);
      return () => deleteLine(p.line.id);
    case 'asset':
      await addAsset(p.asset);
      return () => deleteAsset(p.asset.id);
    case 'categorise':
      await correct(p.keys, p.categoryId, true);
      return async () => {
        for (const k of p.keys) await clearLabel(k);
      };
    case 'scenario': {
      const saved = await addScenario(p.name, p.setup, 'advisor');
      return async () => saveScenarios((await loadScenarios()).filter((s) => s.id !== saved.id));
    }
    case 'setup': {
      const put = async (s: FreedomSetup) => {
        await sim().saveSetup(s);
        window.dispatchEvent(new CustomEvent(SETUP_CHANGED));
      };
      await put(p.setup);
      return () => put(p.from);
    }
  }
}
