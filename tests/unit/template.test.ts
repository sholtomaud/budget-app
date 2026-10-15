/** Dashboard templates: a dashboard as a file to share, never values (ADR 0039). */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { addTile, emptyDashboard, setWide, type Dashboard } from '../../src/viz/dashboard.ts';
import type { ChartSpec } from '../../src/viz/spec.ts';
import {
  fromTemplate,
  TEMPLATE_KIND,
  TEMPLATE_SCHEMA,
  templateFileName,
  templateWords,
  toTemplate,
} from '../../src/viz/template.ts';

const coffee: ChartSpec = {
  kind: 'line',
  title: 'Coffee by month',
  caption: 'Cafes only',
  groupBy: 'month',
  series: [{ label: 'Cafes', dataset: 'spending', filter: { text: 'bean there', lastMonths: 12 } }],
};
const saved = [{ id: 'chart-1', spec: coffee }];

function dashboard(): Dashboard {
  let d = emptyDashboard('Monthly check-in');
  d = addTile(d, { kind: 'builtin', id: 'spending-vs-budget' });
  d = addTile(d, { kind: 'saved', id: 'chart-1' });
  d = addTile(d, { kind: 'saved', id: 'chart-gone' });
  return setWide(d, d.tiles[0]!.id, true);
}

describe('a dashboard as a template', () => {
  test('the published schema is the one the code uses', () => {
    const file = JSON.parse(readFileSync('schemas/dashboard-template.schema.json', 'utf8'));
    delete file.$schema;
    delete file.title;
    expect(file).toEqual(JSON.parse(JSON.stringify(TEMPLATE_SCHEMA)));
  });

  test('built-ins by id, saved charts as their specs, deleted ones left out and counted; no ids', () => {
    const { template, left } = toTemplate(dashboard(), saved);
    expect(left).toBe(1);
    expect(template).toEqual({
      kind: TEMPLATE_KIND,
      version: 1,
      name: 'Monthly check-in',
      tiles: [
        { builtin: 'spending-vs-budget', wide: true },
        { chart: coffee, wide: false },
      ],
    });
    expect(JSON.stringify(template)).not.toMatch(/dash-|tile-|chart-1/);
    expect(templateFileName(template)).toBe('monthly-check-in.crux-dashboard.json');
  });

  test('every word someone wrote is listed for the person to read before sharing', () => {
    const w = templateWords(toTemplate(dashboard(), saved).template);
    expect(w.titles).toEqual([
      'Spending against the budget, by month',
      'Coffee by month (Cafes only)',
    ]);
    expect(w.labels).toEqual(['Cafes']);
    expect(w.searches).toEqual(['bean there']);
  });

  test('round trip: a new dashboard with new ids, the same charts; a taken name gets "(imported)"', () => {
    const { template } = toTemplate(dashboard(), saved);
    const r = fromTemplate(JSON.stringify(template), ['Monthly check-in']);
    if (!r.ok) throw new Error(r.error);
    expect(r.dashboard.name).toBe('Monthly check-in (imported)');
    expect(r.dashboard.tiles.map((t) => [t.source, t.wide])).toEqual([
      [{ kind: 'builtin', id: 'spending-vs-budget' }, true],
      [{ kind: 'spec', spec: coffee }, false],
    ]);
    expect(fromTemplate(JSON.stringify(template)).ok && true).toBe(true);
  });

  test('anything else is refused in words, and nothing is added', () => {
    const err = (text: string) => {
      const r = fromTemplate(text);
      return r.ok ? null : r.error;
    };
    const t = toTemplate(dashboard(), saved).template;
    expect(err('not json')).toContain("isn't JSON");
    expect(err('{"kind":"something-else"}')).toContain("isn't a Crux dashboard template");
    expect(err(JSON.stringify({ ...t, version: 2 }))).toContain("can't be used");
    expect(err(JSON.stringify({ ...t, tiles: [] }))).toContain("can't be used");
    expect(err(JSON.stringify({ ...t, tiles: [{ builtin: 'made-up', wide: false }] }))).toContain(
      "doesn't have"
    );
    // Values smuggled into a chart are not part of the format.
    const withValues = { ...t, tiles: [{ chart: { ...coffee, values: [1, 2] }, wide: false }] };
    expect(err(JSON.stringify(withValues))).toContain("can't be used");
    // A chart the app can't draw is refused as a chart.
    const fan = { ...t, tiles: [{ chart: { ...coffee, kind: 'fan' }, wide: false }] };
    expect(err(JSON.stringify(fan))).toMatch(/^Chart 1: /);
    expect(err('x'.repeat(200_001))).toContain('too big');
  });
});
