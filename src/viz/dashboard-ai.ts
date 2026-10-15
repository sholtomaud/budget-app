/**
 * Dashboards the AI designs (ADR 0037): its strict tool answer becomes a
 * dashboard, checked like one from anywhere else. Pure: categories, saved
 * charts and the dashboard being changed come in as arguments.
 */
import type { Category } from '../classify/categories.ts';
import {
  checkDashboard,
  cleanName,
  emptyDashboard,
  MAX_TILES,
  newId,
  type Dashboard,
  type Tile,
  type TileSource,
} from './dashboard.ts';
import { LIBRARY, libraryChart } from './library.ts';
import { topicCategories } from './requests.ts';
import { CHART_TOOL_SCHEMA, withoutNulls, type ChartSpec } from './spec.ts';
import type { Schema } from '../lib/jsonschema.ts';

export interface TileAnswer {
  builtin: string | null;
  saved: string | null;
  chart: Record<string, unknown> | null;
  wide: boolean;
}

export interface DashboardAnswer {
  dashboardId: string | null;
  name: string;
  tiles: TileAnswer[];
}

const obj = (properties: Record<string, Schema>): Schema => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const nullable = (s: Schema): Schema => ({ anyOf: [s, { type: 'null' }] });

/** The strict tool input: the whole layout, each tile exactly one of builtin, saved or chart. */
export const DASHBOARD_TOOL_SCHEMA: Schema = obj({
  dashboardId: nullable({ type: 'string' }),
  name: { type: 'string' },
  tiles: {
    type: 'array',
    items: obj({
      builtin: nullable({ type: 'string', enum: LIBRARY.map((c) => c.id) }),
      saved: nullable({ type: 'string' }),
      chart: nullable(CHART_TOOL_SCHEMA),
      wide: { type: 'boolean' },
    }),
  },
});

/** Plain names in a chart's category filters become category ids (the AI sees names). */
export function resolveCategories(spec: unknown, categories: readonly Category[]): unknown {
  const s = spec as { series?: { filter?: { categories?: string[] } }[] };
  for (const x of s.series ?? []) {
    const f = x.filter;
    if (!f?.categories) continue;
    f.categories = [
      ...new Set(
        f.categories.flatMap((c) =>
          categories.some((k) => k.id === c || k.id.startsWith(`${c}.`))
            ? [c]
            : topicCategories(c, categories)
        )
      ),
    ];
    if (!f.categories.length) delete f.categories;
  }
  return s;
}

/** The AI's answer as a dashboard, or what is wrong with it in words (for the AI to fix). */
export function dashboardFromAnswer(
  a: DashboardAnswer,
  ctx: {
    categories: readonly Category[];
    savedIds: readonly string[];
    existing: readonly Dashboard[];
  }
): { ok: true; dashboard: Dashboard; replaces: Dashboard | null } | { ok: false; error: string } {
  const replaces = a.dashboardId ? ctx.existing.find((d) => d.id === a.dashboardId) : null;
  if (a.dashboardId && !replaces)
    return {
      ok: false,
      error: `No dashboard has the id "${a.dashboardId}". Use null to make a new one.`,
    };
  if (!a.tiles.length) return { ok: false, error: 'A dashboard needs at least one chart.' };
  if (a.tiles.length > MAX_TILES)
    return {
      ok: false,
      error: `A dashboard holds up to ${MAX_TILES} charts; this has ${a.tiles.length}.`,
    };
  const tiles: Tile[] = [];
  for (const [i, t] of a.tiles.entries()) {
    const given = [t.builtin, t.saved, t.chart].filter((x) => x !== null).length;
    if (given !== 1)
      return { ok: false, error: `Chart ${i + 1}: give exactly one of builtin, saved or chart.` };
    let source: TileSource;
    if (t.builtin !== null) {
      if (!libraryChart(t.builtin))
        return { ok: false, error: `Chart ${i + 1}: no built-in chart "${t.builtin}".` };
      source = { kind: 'builtin', id: t.builtin };
    } else if (t.saved !== null) {
      if (!ctx.savedIds.includes(t.saved))
        return { ok: false, error: `Chart ${i + 1}: no saved chart has the id "${t.saved}".` };
      source = { kind: 'saved', id: t.saved };
    } else {
      const spec = resolveCategories(withoutNulls(t.chart), ctx.categories) as ChartSpec;
      source = { kind: 'spec', spec };
    }
    tiles.push({ id: newId('tile'), source, wide: t.wide });
  }
  const dashboard: Dashboard = {
    ...(replaces ? { ...replaces } : emptyDashboard(a.name)),
    name: cleanName(a.name || replaces?.name || ''),
    tiles,
    updatedAt: new Date().toISOString(),
  };
  const bad = checkDashboard(dashboard);
  if (bad) return { ok: false, error: bad.replace(/^Tile/, 'Chart') };
  return { ok: true, dashboard, replaces: replaces ?? null };
}

/** A tile's title in words, for the AI and the card. */
export function tileTitle(t: Tile, saved: readonly { id: string; spec: ChartSpec }[]): string {
  const s = t.source;
  if (s.kind === 'spec') return s.spec.title;
  if (s.kind === 'builtin') return libraryChart(s.id)?.spec.title ?? s.id;
  return saved.find((c) => c.id === s.id)?.spec.title ?? 'A deleted saved chart';
}
