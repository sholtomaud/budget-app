/**
 * Charts in the chat (ADR 0028): building one from a spec with the app's own
 * data, what the AI may see of it, and the saved charts (FR-VIZ-005), kept in
 * the vault with the household and removed by delete-all.
 */
import { roughAmount } from '../api/redact.ts';
import type { DataView } from '../data/service.ts';
import { runChart, type ChartTable } from '../viz/query.ts';
import { checkSpec, type ChartSpec } from '../viz/spec.ts';
import { currentSetup } from './insights.ts';
import { sim } from './workers.ts';

export interface BuiltChart {
  spec: ChartSpec;
  table: ChartTable;
  at: string;
}

export interface SavedChart extends BuiltChart {
  id: string;
  savedAt: string;
}

/** Validate a spec and run its queries; an error in words when it can't be drawn. */
export async function buildChart(
  v: DataView,
  spec: unknown
): Promise<{ ok: true; chart: BuiltChart } | { ok: false; error: string }> {
  const bad = checkSpec(spec);
  if (bad) return { ok: false, error: `That chart can't be drawn: ${bad}` };
  const s = spec as ChartSpec;
  const setup = await currentSetup(v);
  const r = runChart(s, {
    txns: v.txns,
    categories: v.categories,
    lines: v.budget.lines,
    periods: v.budget.periods,
    tier: setup.goal.tier,
    assets: v.assets,
    tiers: v.budget.tiers,
    horizonYears: v.budget.settings.horizonYears,
  });
  if (!r.ok) return r;
  return { ok: true, chart: { spec: s, table: r.table, at: new Date().toISOString() } };
}

/** Big purchases listed for the AI, soonest first; the chart shows them all. */
const MAX_PURCHASES = 20;

/**
 * What the AI gets back for a chart it designed (FR-VIZ-004): per series, the
 * total and the highest and lowest points, rounded (FR-API-003). Enough to
 * write about the chart; the chart itself shows the exact values. A big
 * purchases series also lists what falls due when, so the AI can say which
 * purchase lands in which month.
 */
export function chartFacts(c: BuiltChart): Record<string, unknown> {
  const t = c.table;
  return {
    shown:
      'The chart is shown to the user with exact values. Describe it from these rounded facts only.',
    title: c.spec.title,
    points: t.labels.length,
    window: t.window,
    valuesAre: t.perMonth ? 'monthly averages' : 'totals per period',
    series: t.series.map((s) => {
      const fmt = (x: number) => (s.unit === 'count' ? Math.round(x) : roughAmount(x));
      let hi = 0;
      let lo = 0;
      s.values.forEach((x, i) => {
        if (x > s.values[hi]!) hi = i;
        if (x < s.values[lo]!) lo = i;
      });
      const total = s.values.reduce((a, b) => a + b, 0);
      return {
        label: s.label,
        provenance: s.provenance,
        unit: s.unit,
        total: fmt(total),
        average: fmt(total / Math.max(1, s.values.length)),
        highest: { at: t.labels[hi], value: fmt(s.values[hi] ?? 0) },
        lowest: { at: t.labels[lo], value: fmt(s.values[lo] ?? 0) },
        ...(s.purchases
          ? {
              fallsDue: s.purchases.slice(0, MAX_PURCHASES).map((p) => ({
                when: p.month,
                item: p.item,
                cost: roughAmount(p.value),
              })),
              ...(s.purchases.length > MAX_PURCHASES
                ? { more: s.purchases.length - MAX_PURCHASES }
                : {}),
            }
          : {}),
      };
    }),
  };
}

export async function loadCharts(): Promise<SavedChart[]> {
  return ((await sim().loadKv('charts')) as SavedChart[] | null) ?? [];
}

export async function saveChart(c: BuiltChart): Promise<SavedChart> {
  const list = await loadCharts();
  const saved: SavedChart = {
    ...structuredClone(c),
    id: `chart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    savedAt: new Date().toISOString(),
  };
  await sim().saveKv('charts', [...list, saved]);
  return saved;
}

export async function deleteChart(id: string): Promise<void> {
  const list = await loadCharts();
  await sim().saveKv(
    'charts',
    list.filter((c) => c.id !== id)
  );
}
