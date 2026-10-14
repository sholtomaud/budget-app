/** Dashboards: named layouts of charts, never values (ADR 0036). */
import { describe, expect, test } from 'vitest';
import {
  addTile,
  checkDashboard,
  cleanName,
  duplicate,
  emptyDashboard,
  MAX_TILES,
  moveTile,
  removeTile,
  rename,
  setWide,
  starterDashboard,
  type Dashboard,
} from '../../src/viz/dashboard.ts';
import { LIBRARY } from '../../src/viz/library.ts';
import { checkSpec } from '../../src/viz/spec.ts';

const ids = (d: Dashboard) =>
  d.tiles.map((t) => (t.source.kind === 'spec' ? t.source.spec.title : t.source.id));

describe('the built-in charts', () => {
  test('every one is a valid spec, with a unique id', () => {
    for (const c of LIBRARY) expect(checkSpec(c.spec), c.id).toBeNull();
    expect(new Set(LIBRARY.map((c) => c.id)).size).toBe(LIBRARY.length);
  });
});

describe('a dashboard is changed one step at a time', () => {
  const three = () => {
    let d = emptyDashboard('Mine');
    for (const id of ['a', 'b', 'c']) d = addTile(d, { kind: 'saved', id });
    return d;
  };

  test('add at the end or at a position; a full dashboard takes no more', () => {
    let d = three();
    expect(ids(d)).toEqual(['a', 'b', 'c']);
    d = addTile(d, { kind: 'builtin', id: 'spending-by-group' }, 1);
    expect(ids(d)).toEqual(['a', 'spending-by-group', 'b', 'c']);
    while (d.tiles.length < MAX_TILES) d = addTile(d, { kind: 'saved', id: 'x' });
    expect(addTile(d, { kind: 'saved', id: 'y' })).toBe(d);
  });

  test('move, resize, remove; the original is left as it was', () => {
    const d = three();
    const [a, b, c] = d.tiles;
    expect(ids(moveTile(d, c!.id, 0))).toEqual(['c', 'a', 'b']);
    expect(ids(moveTile(d, a!.id, 2))).toEqual(['b', 'c', 'a']);
    expect(ids(moveTile(d, a!.id, 99))).toEqual(['b', 'c', 'a']);
    expect(moveTile(d, 'nope', 0)).toBe(d);
    expect(setWide(d, b!.id, true).tiles[1]!.wide).toBe(true);
    expect(ids(removeTile(d, b!.id))).toEqual(['a', 'c']);
    expect(ids(d)).toEqual(['a', 'b', 'c']);
  });

  test('names are tidied; a copy gets new ids', () => {
    expect(rename(three(), '  Monthly   check-in ').name).toBe('Monthly check-in');
    expect(cleanName('   ')).toBe('Untitled dashboard');
    expect(cleanName('x'.repeat(100))).toHaveLength(60);
    const d = three();
    const c = duplicate(d);
    expect(c.name).toBe('Mine (copy)');
    expect(c.id).not.toBe(d.id);
    expect(ids(c)).toEqual(ids(d));
    expect(c.tiles.map((t) => t.id).some((id) => d.tiles.some((t) => t.id === id))).toBe(false);
  });

  test('the starter dashboard: overview charts, the first one wide', () => {
    const d = starterDashboard();
    expect(d.name).toBe('Overview');
    expect(ids(d)).toEqual(['spending-vs-budget', 'spending-by-group', 'savings-over-time']);
    expect(d.tiles.map((t) => t.wide)).toEqual([true, false, false]);
    expect(checkDashboard(d)).toBeNull();
  });
});

describe('a dashboard from outside (a template, the AI) is checked', () => {
  test('specs inside are checked as charts; unknown built-ins and values are refused', () => {
    const d = addTile(emptyDashboard('T'), {
      kind: 'spec',
      spec: {
        kind: 'line',
        title: 'Groceries',
        groupBy: 'month',
        series: [{ label: 'S', dataset: 'spending' }],
      },
    });
    expect(checkDashboard(d)).toBeNull();
    expect(checkDashboard(addTile(d, { kind: 'builtin', id: 'made-up' }))).toContain(
      'no built-in chart'
    );
    const fan = addTile(d, {
      kind: 'spec',
      spec: {
        kind: 'fan',
        title: 'F',
        groupBy: 'month',
        series: [{ label: 'S', dataset: 'spending' }],
      },
    });
    expect(checkDashboard(fan)).toContain('Tile 2');
    const withValues = structuredClone(d) as unknown as {
      tiles: { source: Record<string, unknown> }[];
    };
    withValues.tiles[0]!.source.values = [1, 2, 3];
    expect(checkDashboard(withValues)).not.toBeNull();
  });
});
