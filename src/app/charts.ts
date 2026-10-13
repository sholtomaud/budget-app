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
import { currentInputsHash, loadRuns } from './plan-run.ts';
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
  let s = spec as ChartSpec;
  const setup = await currentSetup(v);
  // Savings over time comes from the latest full run (ADR 0032).
  const wantsCapital = s.series.some((x) => x.dataset === 'capital');
  const last = wantsCapital ? (await loadRuns()).at(-1) : undefined;
  const r = runChart(s, {
    txns: v.txns,
    categories: v.categories,
    lines: v.budget.lines,
    periods: v.budget.periods,
    tier: setup.goal.tier,
    ...(last
      ? {
          capital: {
            asOf: last.asOf,
            months: last.capital.months,
            q: last.capital.q,
            floor: last.goal.floor,
            start: last.goal.start,
          },
        }
      : {}),
  });
  if (!r.ok) return r;
  if (last) {
    const stale = (await currentInputsHash(v, setup)) !== last.inputsHash;
    const from = `From your run of ${last.at.slice(0, 10)}: ${Math.round(last.pSuccess * 100)} % of futures stay above the floor.${stale ? ' Your data or settings have changed since; run your plan again to update it.' : ''}`;
    s = { ...s, caption: [s.caption, from].filter(Boolean).join(' ').slice(0, 240) };
  }
  return { ok: true, chart: { spec: s, table: r.table, at: new Date().toISOString() } };
}

/**
 * What the AI gets back for a chart it designed (FR-VIZ-004): per series, the
 * total and the highest and lowest points, rounded (FR-API-003). Enough to
 * write about the chart; the chart itself shows the exact values.
 */
export function chartFacts(c: BuiltChart): Record<string, unknown> {
  const t = c.table;
  return {
    shown:
      'The chart is shown to the user with exact values. Describe it from these rounded facts only.',
    title: c.spec.title,
    points: t.labels.length,
    window: t.window,
    valuesAre:
      t.series[0]?.provenance === 'forecast'
        ? "savings in today's dollars at each year, across the simulated futures"
        : t.perMonth
          ? 'monthly averages'
          : 'totals per period',
    ...(t.floor !== undefined ? { floor: roughAmount(t.floor) } : {}),
    series: t.series.map((s) => {
      const fmt = (x: number) => (s.unit === 'count' ? Math.round(x) : roughAmount(x));
      let hi = 0;
      let lo = 0;
      s.values.forEach((x, i) => {
        if (x > s.values[hi]!) hi = i;
        if (x < s.values[lo]!) lo = i;
      });
      if (s.provenance === 'forecast')
        return {
          label: s.label,
          provenance: s.provenance,
          now: { at: t.labels[0], value: fmt(s.values[0] ?? 0) },
          atEnd: {
            at: t.labels[t.labels.length - 1],
            value: fmt(s.values[s.values.length - 1] ?? 0),
          },
          highest: { at: t.labels[hi], value: fmt(s.values[hi] ?? 0) },
          lowest: { at: t.labels[lo], value: fmt(s.values[lo] ?? 0) },
        };
      const total = s.values.reduce((a, b) => a + b, 0);
      return {
        label: s.label,
        provenance: s.provenance,
        unit: s.unit,
        total: fmt(total),
        average: fmt(total / Math.max(1, s.values.length)),
        highest: { at: t.labels[hi], value: fmt(s.values[hi] ?? 0) },
        lowest: { at: t.labels[lo], value: fmt(s.values[lo] ?? 0) },
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
