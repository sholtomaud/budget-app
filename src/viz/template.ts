/**
 * Dashboard templates (ADR 0039): a dashboard as a file to share. It holds
 * the name and the charts, as built-in ids or chart specs: never values, ids
 * or saved-chart references (they don't exist in another household). A file
 * from outside is checked like any other dashboard before it is added.
 */
import { validate, formatError, type Schema } from '../lib/jsonschema.ts';
import {
  cleanName,
  emptyDashboard,
  MAX_NAME,
  MAX_TILES,
  newId,
  type Dashboard,
} from './dashboard.ts';
import { libraryChart } from './library.ts';
import { CHART_SCHEMA, checkSpec, type ChartSpec } from './spec.ts';

export const TEMPLATE_KIND = 'crux-dashboard-template';
export const TEMPLATE_VERSION = 1;
/** Bigger than any real template; a larger file is refused before it is parsed. */
export const MAX_TEMPLATE_BYTES = 200_000;

export type TemplateTile = { builtin: string; wide: boolean } | { chart: ChartSpec; wide: boolean };

export interface Template {
  kind: typeof TEMPLATE_KIND;
  version: typeof TEMPLATE_VERSION;
  name: string;
  tiles: TemplateTile[];
}

/** The JSON Schema of a template file (schemas/dashboard-template.schema.json). */
export const TEMPLATE_SCHEMA: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'version', 'name', 'tiles'],
  properties: {
    kind: { const: TEMPLATE_KIND },
    version: { const: TEMPLATE_VERSION },
    name: { type: 'string', minLength: 1, maxLength: MAX_NAME },
    tiles: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_TILES,
      items: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['builtin', 'wide'],
            properties: { builtin: { type: 'string', maxLength: 80 }, wide: { type: 'boolean' } },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['chart', 'wide'],
            properties: { chart: CHART_SCHEMA, wide: { type: 'boolean' } },
          },
        ],
      },
    },
  },
};

/** A dashboard as a template; saved charts become their specs. Deleted ones are left out, and said. */
export function toTemplate(
  d: Dashboard,
  saved: readonly { id: string; spec: ChartSpec }[]
): { template: Template; left: number } {
  let left = 0;
  const tiles: TemplateTile[] = [];
  for (const t of d.tiles) {
    const s = t.source;
    if (s.kind === 'builtin') tiles.push({ builtin: s.id, wide: t.wide });
    else if (s.kind === 'spec') tiles.push({ chart: structuredClone(s.spec), wide: t.wide });
    else {
      const c = saved.find((x) => x.id === s.id);
      if (c) tiles.push({ chart: structuredClone(c.spec), wide: t.wide });
      else left++;
    }
  }
  return {
    template: { kind: TEMPLATE_KIND, version: TEMPLATE_VERSION, name: d.name, tiles },
    left,
  };
}

/**
 * Everything in a template that someone wrote, for the person to read before
 * sharing it: the name, titles, captions, series labels, and words a chart
 * looks for in transactions. Amounts and transactions are never in it.
 */
export function templateWords(t: Template): {
  titles: string[];
  labels: string[];
  searches: string[];
} {
  const titles: string[] = [];
  const labels = new Set<string>();
  const searches = new Set<string>();
  for (const x of t.tiles) {
    if (!('chart' in x)) {
      titles.push(libraryChart(x.builtin)?.spec.title ?? x.builtin);
      continue;
    }
    titles.push(x.chart.caption ? `${x.chart.title} (${x.chart.caption})` : x.chart.title);
    for (const s of x.chart.series) {
      labels.add(s.label);
      if (s.filter?.text) searches.add(s.filter.text);
    }
  }
  return { titles, labels: [...labels], searches: [...searches] };
}

/** A template file's text as a new dashboard, or what is wrong with it in words. */
export function fromTemplate(
  text: string,
  takenNames: readonly string[] = []
): { ok: true; dashboard: Dashboard } | { ok: false; error: string } {
  if (text.length > MAX_TEMPLATE_BYTES)
    return { ok: false, error: 'That file is too big to be a dashboard template.' };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't a dashboard template: it isn't JSON." };
  }
  const k = (json as { kind?: unknown } | null)?.kind;
  if (k !== TEMPLATE_KIND)
    return { ok: false, error: "That file isn't a Crux dashboard template." };
  const err = validate(TEMPLATE_SCHEMA, json);
  if (err) return { ok: false, error: `That template can't be used: ${formatError(err)}` };
  const t = json as Template;
  for (const [i, x] of t.tiles.entries()) {
    if ('builtin' in x) {
      if (!libraryChart(x.builtin))
        return {
          ok: false,
          error: `Chart ${i + 1} is a built-in chart this version of Crux doesn't have ("${x.builtin}").`,
        };
    } else {
      const bad = checkSpec(x.chart);
      if (bad) return { ok: false, error: `Chart ${i + 1}: ${bad}` };
    }
  }
  let name = cleanName(t.name);
  if (takenNames.includes(name)) name = cleanName(`${name} (imported)`);
  return {
    ok: true,
    dashboard: {
      ...emptyDashboard(name),
      tiles: t.tiles.map((x) => ({
        id: newId('tile'),
        source:
          'builtin' in x ? { kind: 'builtin', id: x.builtin } : { kind: 'spec', spec: x.chart },
        wide: x.wide,
      })),
    },
  };
}

/** The file name for a template: its name, tidied. */
export const templateFileName = (t: Template) =>
  `${
    t.name
      .replace(/[^\w -]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase() || 'dashboard'
  }.crux-dashboard.json`;
