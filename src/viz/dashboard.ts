/**
 * Dashboards (ADR 0036): named layouts of charts. A tile names a built-in
 * chart, a saved chart or a chart spec, never values; the app draws each from
 * today's data. Pure: every change returns a new dashboard.
 */
import { validate, formatError, type Schema } from '../lib/jsonschema.ts';
import { libraryChart } from './library.ts';
import { CHART_SCHEMA, checkSpec, type ChartSpec } from './spec.ts';

export type TileSource =
  | { kind: 'builtin'; id: string }
  | { kind: 'saved'; id: string }
  | { kind: 'spec'; spec: ChartSpec };

export interface Tile {
  id: string;
  source: TileSource;
  /** Two columns wide on a wide screen. */
  wide: boolean;
}

export interface Dashboard {
  id: string;
  name: string;
  tiles: Tile[];
  updatedAt: string;
}

export const MAX_TILES = 12;
export const MAX_NAME = 60;

let seq = 0;
export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const touch = (d: Dashboard, tiles: Tile[]): Dashboard => ({
  ...d,
  tiles,
  updatedAt: new Date().toISOString(),
});

export function emptyDashboard(name: string): Dashboard {
  return {
    id: newId('dash'),
    name: cleanName(name),
    tiles: [],
    updatedAt: new Date().toISOString(),
  };
}

export const cleanName = (s: string) =>
  s.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) || 'Untitled dashboard';

/** A first dashboard: what most people look at first. */
export function starterDashboard(): Dashboard {
  let d = emptyDashboard('Overview');
  for (const id of ['spending-vs-budget', 'spending-by-group', 'savings-over-time'])
    d = addTile(d, { kind: 'builtin', id });
  return { ...d, tiles: d.tiles.map((t, i) => (i === 0 ? { ...t, wide: true } : t)) };
}

/** Add a tile at a position (the end by default). Full dashboards are left as they are. */
export function addTile(d: Dashboard, source: TileSource, at = d.tiles.length): Dashboard {
  if (d.tiles.length >= MAX_TILES) return d;
  const tiles = [...d.tiles];
  tiles.splice(Math.max(0, Math.min(at, tiles.length)), 0, {
    id: newId('tile'),
    source,
    wide: false,
  });
  return touch(d, tiles);
}

/** Move a tile so it lands at `to` (an index in the list as it will be). */
export function moveTile(d: Dashboard, tileId: string, to: number): Dashboard {
  const from = d.tiles.findIndex((t) => t.id === tileId);
  if (from < 0) return d;
  const tiles = [...d.tiles];
  const [t] = tiles.splice(from, 1);
  tiles.splice(Math.max(0, Math.min(to, tiles.length)), 0, t!);
  return touch(d, tiles);
}

export function removeTile(d: Dashboard, tileId: string): Dashboard {
  return touch(
    d,
    d.tiles.filter((t) => t.id !== tileId)
  );
}

export function setWide(d: Dashboard, tileId: string, wide: boolean): Dashboard {
  return touch(
    d,
    d.tiles.map((t) => (t.id === tileId ? { ...t, wide } : t))
  );
}

export function rename(d: Dashboard, name: string): Dashboard {
  return { ...d, name: cleanName(name), updatedAt: new Date().toISOString() };
}

export function duplicate(d: Dashboard, name = `${d.name} (copy)`): Dashboard {
  return {
    ...emptyDashboard(name),
    tiles: d.tiles.map((t) => ({ ...structuredClone(t), id: newId('tile') })),
  };
}

const str = (maxLength: number): Schema => ({ type: 'string', minLength: 1, maxLength });

/** The JSON Schema of a dashboard: what a template file or the AI's answer must be. */
export const DASHBOARD_SCHEMA: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'tiles', 'updatedAt'],
  properties: {
    id: str(80),
    name: str(MAX_NAME),
    updatedAt: str(40),
    tiles: {
      type: 'array',
      maxItems: MAX_TILES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'source', 'wide'],
        properties: {
          id: str(80),
          wide: { type: 'boolean' },
          source: {
            anyOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['kind', 'id'],
                properties: { kind: { const: 'builtin' }, id: str(80) },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['kind', 'id'],
                properties: { kind: { const: 'saved' }, id: str(80) },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['kind', 'spec'],
                properties: { kind: { const: 'spec' }, spec: CHART_SCHEMA },
              },
            ],
          },
        },
      },
    },
  },
};

/** Problems with a dashboard, in words, or null. Charts inside are checked as charts. */
export function checkDashboard(d: unknown): string | null {
  const err = validate(DASHBOARD_SCHEMA, d);
  if (err) return formatError(err);
  for (const [i, t] of (d as Dashboard).tiles.entries()) {
    const s = t.source;
    if (s.kind === 'builtin' && !libraryChart(s.id))
      return `Tile ${i + 1}: no built-in chart "${s.id}".`;
    if (s.kind === 'spec') {
      const bad = checkSpec(s.spec);
      if (bad) return `Tile ${i + 1}: ${bad}`;
    }
  }
  return null;
}
