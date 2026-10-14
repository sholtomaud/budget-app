/**
 * Chart specs (FR-VIZ-001, ADR 0028). A spec says what to show, never the
 * values: each series is a query over a named dataset, from a fixed
 * vocabulary. Built-in charts and charts the AI designs are both specs; the
 * app validates them, runs the queries on the device (src/viz/query.ts) and
 * draws the result with its own SVG.
 */
import { validate, formatError, type Schema } from '../lib/jsonschema.ts';

export const CHART_KINDS = ['line', 'bar', 'stacked-bar', 'table', 'fan'] as const;
export const DATASETS = ['spending', 'income', 'budget', 'big-purchases', 'capital'] as const;
export const GROUP_BY = [
  'month',
  'quarter',
  'year',
  'category',
  'group',
  'merchant',
  'item',
] as const;
export const MEASURES = ['sum', 'count'] as const;

export type ChartKind = (typeof CHART_KINDS)[number];
export type Dataset = (typeof DATASETS)[number];
export type GroupBy = (typeof GROUP_BY)[number];
export type Measure = (typeof MEASURES)[number];

export interface SeriesFilter {
  /** Category groups ('food') or categories ('food.groceries'). */
  categories?: string[];
  /** Words in the merchant or description, case-insensitive. */
  text?: string;
  /** Months, 'YYYY-MM', inclusive. */
  from?: string;
  to?: string;
  /** The last N complete months of data (ignored when from/to are given). */
  lastMonths?: number;
  /** The next N months from this one, for planned data (ignored when from/to are given). */
  nextMonths?: number;
}

export interface SeriesSpec {
  label: string;
  dataset: Dataset;
  filter?: SeriesFilter;
  measure?: Measure;
}

export interface ChartSpec {
  kind: ChartKind;
  title: string;
  caption?: string;
  /** Every series is grouped the same way, so they share the x axis. */
  groupBy: GroupBy;
  series: SeriesSpec[];
}

/** What a dataset holds, in words: all the AI sees to design a chart (FR-VIZ-003). */
export const CATALOGUE_NOTE =
  'Grouped by month, quarter or year, values are totals for each period. Grouped by category, group, merchant or item, they are monthly averages over the months chosen (big purchases: totals), biggest first, the rest folded into "Everything else". Without a range, a series covers every complete month of data; big purchases cover this month to the end of the planning horizon. Datasets can share a time axis: past spending next to future big purchases draws one timeline.';

export const CATALOGUE: Record<Dataset, string> = {
  spending:
    'Money going out on day-to-day spending (operating costs, fees, tax), net of refunds; transfers between accounts and big purchases are left out. Dollars. Provenance: actual.',
  income:
    'Money coming in classified as income (pay, interest, refunds of capital excluded). Dollars. Provenance: actual.',
  budget:
    "The budget lines at the plan's tier, as a monthly rate. Grouped by month it is the same each month; grouped by category or group it is the monthly budget for each. 'text' matches the line's item; group by item for one bar per line. Dollars. Provenance: budgeted.",
  'big-purchases':
    "Big purchases from the Big purchases screen (the CAPEX register), in the future: when each falls due and what it costs, in today's dollars. Owned items that are replaced fall due at their median replacement date and again every average life after it; wish-list and planned items at their buy-by date (this month without one). Deferred, dropped, retired items and those above the plan's tier are left out. Group by month, quarter or year for when; by item, category or group for what. 'text' matches the item's name; use from/to or nextMonths, not lastMonths. Dollars. Provenance: forecast.",
  capital:
    "Savings and investments in the future, in today's dollars, from the latest Run my plan: the typical future and the range across the simulated futures, one point a year from now to the end of freedom, with the plan's floor. Only grouped by year, on its own (no other series), as a fan (the range), a line (typical, bad and good case) or a table. Provenance: forecast.",
};

const str = (maxLength: number): Schema => ({ type: 'string', maxLength });
const MONTH = '^\\d{4}-(0[1-9]|1[0-2])$';

/** The JSON Schema of a chart spec; also the AI's tool input (schemas/chart-spec.schema.json). */
export const CHART_SCHEMA: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'title', 'groupBy', 'series'],
  properties: {
    kind: { type: 'string', enum: [...CHART_KINDS] },
    title: str(80),
    caption: str(240),
    groupBy: { type: 'string', enum: [...GROUP_BY] },
    series: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'dataset'],
        properties: {
          label: str(40),
          dataset: { type: 'string', enum: [...DATASETS] },
          measure: { type: 'string', enum: [...MEASURES] },
          filter: {
            type: 'object',
            additionalProperties: false,
            properties: {
              categories: { type: 'array', maxItems: 20, items: str(60) },
              text: str(40),
              from: { type: 'string', pattern: MONTH },
              to: { type: 'string', pattern: MONTH },
              lastMonths: { type: 'integer', minimum: 1, maximum: 120 },
              nextMonths: { type: 'integer', minimum: 1, maximum: 600 },
            },
          },
        },
      },
    },
  },
};

const nullable = (x: Schema): Schema => ({ anyOf: [x, { type: 'null' }] });
const strictObj = (properties: Record<string, Schema>): Schema => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

/**
 * The same spec as a strict tool input (ADR 0021's convention): every
 * property required, optional ones nullable, no length limits. The answer is
 * then checked against CHART_SCHEMA on the device.
 */
export const CHART_TOOL_SCHEMA: Schema = strictObj({
  kind: { type: 'string', enum: [...CHART_KINDS] },
  title: { type: 'string' },
  caption: nullable({ type: 'string' }),
  groupBy: { type: 'string', enum: [...GROUP_BY] },
  series: {
    type: 'array',
    minItems: 1,
    items: strictObj({
      label: { type: 'string' },
      dataset: { type: 'string', enum: [...DATASETS] },
      measure: nullable({ type: 'string', enum: [...MEASURES] }),
      filter: nullable(
        strictObj({
          categories: nullable({ type: 'array', items: { type: 'string' } }),
          text: nullable({ type: 'string' }),
          from: nullable({ type: 'string' }),
          to: nullable({ type: 'string' }),
          lastMonths: nullable({ type: 'integer' }),
          nextMonths: nullable({ type: 'integer' }),
        })
      ),
    }),
  },
});

/** A tool input without its nulls: a candidate spec for checkSpec. */
export function withoutNulls(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(withoutNulls);
  if (x && typeof x === 'object')
    return Object.fromEntries(
      Object.entries(x)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, withoutNulls(v)])
    );
  return x;
}

const TIME: readonly GroupBy[] = ['month', 'quarter', 'year'];
export const isTime = (g: GroupBy) => TIME.includes(g);

/**
 * Problems with a spec, in words, or null when it can be drawn. The schema
 * first, then what the schema can't say.
 */
export function checkSpec(spec: unknown): string | null {
  const err = validate(CHART_SCHEMA, spec);
  if (err) return formatError(err);
  const s = spec as ChartSpec;
  const capital = s.series.some((x) => x.dataset === 'capital');
  if (capital) {
    if (s.series.length > 1)
      return 'Savings over time is a chart on its own: one series, nothing else with it.';
    if (s.groupBy !== 'year') return 'Savings over time is a point a year: group by year.';
    if (!['fan', 'line', 'table'].includes(s.kind))
      return 'Savings over time is drawn as a fan, a line or a table.';
    if (s.series[0]!.filter) return 'Savings over time takes no filter: it is the whole plan.';
    return null;
  }
  if (s.kind === 'fan') return 'A fan shows a range of futures: only savings over time has one.';
  if (s.kind === 'line' && !isTime(s.groupBy))
    return 'A line chart needs a time axis: group by month, quarter or year.';
  const planned = s.series.filter((x) => x.dataset === 'big-purchases').length;
  if (planned && planned < s.series.length && !isTime(s.groupBy))
    return 'Big purchases are totals and the other datasets monthly averages; chart them together only on a time axis.';
  for (const x of s.series) {
    const f = x.filter;
    if (x.dataset === 'big-purchases') {
      if (s.groupBy === 'merchant')
        return 'Big purchases have no merchant; group by item, category or group instead.';
      if (f?.lastMonths)
        return 'Big purchases are in the future: use nextMonths or from/to, not lastMonths.';
    } else if (f?.nextMonths)
      return `nextMonths is for big purchases; ${x.dataset} is past data, so use lastMonths or from/to.`;
    if ((x.dataset === 'spending' || x.dataset === 'income') && s.groupBy === 'item')
      return 'Transactions have no item; group by merchant instead.';
    if (x.dataset === 'budget' && x.measure === 'count')
      return 'The budget is a rate; it can only be summed.';
    if (x.dataset === 'budget' && s.groupBy === 'merchant')
      return 'Budget lines have no merchant; group by item, category or group instead.';
    if (f?.from && f.to && f.from > f.to) return `The range ${f.from} to ${f.to} is backwards.`;
  }
  return null;
}
