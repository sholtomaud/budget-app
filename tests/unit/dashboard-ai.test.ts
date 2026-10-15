/** Dashboards the AI designs: a strict answer, checked like any dashboard (ADR 0037). */
import { describe, expect, test } from 'vitest';
import { ADVISOR_SYSTEM, ADVISOR_TOOLS } from '../../src/advisor/tools.ts';
import type { Category } from '../../src/classify/categories.ts';
import { validate } from '../../src/lib/jsonschema.ts';
import { addTile, emptyDashboard } from '../../src/viz/dashboard.ts';
import {
  DASHBOARD_TOOL_SCHEMA,
  dashboardFromAnswer,
  tileTitle,
  type DashboardAnswer,
  type TileAnswer,
} from '../../src/viz/dashboard-ai.ts';

const categories: Category[] = [
  { id: 'food', name: 'Food', kind: 'opex' },
  { id: 'food.groceries', name: 'Groceries', kind: 'opex' },
];
const tile = (t: Partial<TileAnswer>): TileAnswer => ({
  builtin: null,
  saved: null,
  chart: null,
  wide: false,
  ...t,
});
const groceries = {
  kind: 'line',
  title: 'Groceries by month',
  caption: null,
  groupBy: 'month',
  series: [
    {
      label: 'Groceries',
      dataset: 'spending',
      measure: null,
      splitBy: null,
      hue: null,
      look: null,
      filter: {
        categories: ['groceries'],
        text: null,
        from: null,
        to: null,
        lastMonths: 12,
        nextMonths: null,
      },
    },
  ],
};
const ctx = { categories, savedIds: ['chart-1'], existing: [] };

describe('the AI proposes a dashboard', () => {
  test('a strict answer: built-in, saved and designed charts, names resolved to categories', () => {
    const a: DashboardAnswer = {
      dashboardId: null,
      name: '  Food   watch ',
      tiles: [
        tile({ builtin: 'spending-vs-budget', wide: true }),
        tile({ saved: 'chart-1' }),
        tile({ chart: groceries }),
      ],
    };
    expect(validate(DASHBOARD_TOOL_SCHEMA, a)).toBeNull();
    const r = dashboardFromAnswer(a, ctx);
    if (!r.ok) throw new Error(r.error);
    expect(r.replaces).toBeNull();
    expect(r.dashboard.name).toBe('Food watch');
    expect(r.dashboard.tiles.map((t) => t.source.kind)).toEqual(['builtin', 'saved', 'spec']);
    expect(r.dashboard.tiles[0]!.wide).toBe(true);
    const spec = r.dashboard.tiles[2]!.source;
    if (spec.kind !== 'spec') throw new Error('expected a spec');
    // Nulls dropped; "groceries" became its category id.
    expect(spec.spec.series[0]!.filter).toEqual({
      categories: ['food.groceries'],
      lastMonths: 12,
    });
    expect(spec.spec.caption).toBeUndefined();
    expect(tileTitle(r.dashboard.tiles[2]!, [])).toBe('Groceries by month');
    expect(tileTitle(r.dashboard.tiles[1]!, [])).toBe('A deleted saved chart');
  });

  test('changing a dashboard keeps its id; the layout given replaces the old one', () => {
    const old = addTile(emptyDashboard('Overview'), { kind: 'builtin', id: 'spending-by-group' });
    const r = dashboardFromAnswer(
      { dashboardId: old.id, name: 'Overview', tiles: [tile({ builtin: 'top-merchants' })] },
      { ...ctx, existing: [old] }
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.replaces).toBe(old);
    expect(r.dashboard.id).toBe(old.id);
    expect(r.dashboard.tiles.map((t) => t.source)).toEqual([
      { kind: 'builtin', id: 'top-merchants' },
    ]);
  });

  test('mistakes come back in words, for the AI to fix', () => {
    const bad = (tiles: TileAnswer[], dashboardId: string | null = null) => {
      const r = dashboardFromAnswer({ dashboardId, name: 'X', tiles }, ctx);
      return r.ok ? null : r.error;
    };
    expect(bad([])).toContain('at least one chart');
    expect(bad([tile({ builtin: 'top-merchants', saved: 'chart-1' })])).toContain('exactly one');
    expect(bad([tile({})])).toContain('exactly one');
    expect(bad([tile({ builtin: 'made-up' })])).toContain('no built-in chart');
    expect(bad([tile({ saved: 'chart-9' })])).toContain('no saved chart');
    expect(bad([tile({ builtin: 'top-merchants' })], 'dash-x')).toContain('No dashboard');
    expect(bad(Array.from({ length: 13 }, () => tile({ builtin: 'top-merchants' })))).toContain(
      'up to 12'
    );
    expect(bad([tile({ chart: { ...groceries, kind: 'fan' } })])).toMatch(/^Chart 1: /);
  });

  test('the AI is told about dashboards: the tools, the built-ins, and when to use them', () => {
    const names = ADVISOR_TOOLS.map((t) => t.name);
    expect(names).toContain('list_dashboards');
    expect(names).toContain('propose_dashboard');
    const d = ADVISOR_TOOLS.find((t) => t.name === 'propose_dashboard')!.description;
    expect(d).toContain('spending-vs-budget');
    expect(ADVISOR_SYSTEM).toContain('propose_dashboard');
    const go = ADVISOR_TOOLS.find((t) => t.name === 'go_to_screen')!;
    expect(JSON.stringify(go.input_schema)).toContain('Dashboards');
  });
});
