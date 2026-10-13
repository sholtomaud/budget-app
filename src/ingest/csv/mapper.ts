/**
 * Proposes a mapping spec for a transaction CSV (FR-ING-015/016/018, ADR
 * 0030), in three tiers: a layout the user already confirmed, a bank or
 * accounting preset, then the learned model. The model is trained on
 * synthetic layouts and retrained with the user's own corrections, which are
 * kept on the device in the household's data.
 */
import { DIM, tableFeatures, type Sparse } from './features.ts';
import { UNSURE } from './fields.ts';
import { synthLayouts } from './layouts.ts';
import { predict, train, type Model, type Sample } from './model.ts';
import { matchPreset, normHeader, PRESETS } from './presets.ts';
import {
  dataRowIndices,
  detectDateOrder,
  detectHeaderRow,
  FIELDS,
  readTable,
  type BankCsvSpec,
  type DateOrder,
  type Field,
} from './read.ts';

export type SuggestedBy = 'memory' | 'preset' | 'model';

export interface ColumnSuggestion {
  field: Field;
  confidence: number;
  by: SuggestedBy;
}

export interface Suggestion {
  spec: BankCsvSpec;
  columns: ColumnSuggestion[];
  /** The preset's name, or "a layout you used before". */
  source: string;
}

/** A layout the user confirmed, keyed by its header (or shape, without one). */
export interface LayoutMemory {
  signature: string;
  headerRow: number | null;
  columns: Field[];
  dateOrder: DateOrder;
  invert: boolean;
  at: string;
}

/** A column the user fixed or confirmed over an unsure suggestion, kept as a training sample. */
export interface Correction {
  header: string;
  x: Sparse;
  field: Field;
  at: string;
}

export interface MapperState {
  layouts: LayoutMemory[];
  corrections: Correction[];
}

export const emptyMapperState = (): MapperState => ({ layouts: [], corrections: [] });

export const MAX_LAYOUTS = 50;
export const MAX_CORRECTIONS = 300;
/** A correction counts as this many synthetic samples. */
export const CORRECTION_WEIGHT = 8;
/** A confirmed column the model was less sure of than UNSURE is learned from too. */
export { UNSURE };

export const TRAIN_SEED = 'csv-mapper-train-v1';
const TRAIN_LAYOUTS = 400;
const OPTIONS = { epochs: 12, rate: 0.3, l2: 1e-5 };

let baseSamples: Sample[] | null = null;
let baseModel: Model | null = null;

function samplesOf(seed: string, count: number): Sample[] {
  const out: Sample[] = [];
  for (const l of synthLayouts(seed, count)) {
    const xs = tableFeatures(l.rows, l.headerRow);
    l.truth.forEach((f, j) => out.push({ x: xs[j]!, y: FIELDS.indexOf(f) }));
  }
  return out;
}

/** The model trained on synthetic layouts only (memoised; deterministic). */
export function baseMapperModel(): Model {
  baseSamples ??= samplesOf(TRAIN_SEED, TRAIN_LAYOUTS);
  baseModel ??= train(baseSamples, FIELDS.length, DIM, { ...OPTIONS, seed: TRAIN_SEED });
  return baseModel;
}

/** The synthetic model retrained with the user's corrections. */
export function personalModel(corrections: readonly Correction[]): Model {
  if (!corrections.length) return baseMapperModel();
  baseMapperModel();
  const extra = corrections.map((c) => ({
    x: c.x,
    y: FIELDS.indexOf(c.field),
    weight: CORRECTION_WEIGHT,
  }));
  return train([...baseSamples!, ...extra], FIELDS.length, DIM, {
    ...OPTIONS,
    seed: TRAIN_SEED,
  });
}

/**
 * One field per column: the most confident (column, field) pairs first, each
 * field used once, `ignore` as often as needed.
 */
export function assignFields(probs: readonly number[][]): { field: Field; confidence: number }[] {
  const out: ({ field: Field; confidence: number } | null)[] = probs.map(() => null);
  const pairs: [number, number, number][] = [];
  probs.forEach((p, j) => p.forEach((v, c) => pairs.push([v, j, c])));
  pairs.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  const used = new Set<Field>();
  const split = (f: Field) => f === 'debit' || f === 'credit';
  for (const [v, j, c] of pairs) {
    const f = FIELDS[c]!;
    if (out[j] || (f !== 'ignore' && used.has(f))) continue;
    // One amount column, or money in and out, never both.
    if (f === 'amount' && (used.has('debit') || used.has('credit'))) continue;
    if (split(f) && used.has('amount')) continue;
    out[j] = { field: f, confidence: v };
    used.add(f);
  }
  return out.map((o) => o ?? { field: 'ignore', confidence: 0 });
}

export function layoutSignature(rows: readonly string[][], headerRow: number | null): string {
  if (headerRow !== null) return `h:${rows[headerRow]!.map(normHeader).join('|')}`;
  const first = rows[dataRowIndices(rows, null)[0] ?? -1] ?? [];
  return `n:${first.length}`;
}

const stem = (file: string) =>
  (file.split('/').pop() ?? file)
    .replace(/\.[^.]*$/, '')
    .replace(/[_-]+/g, ' ')
    .trim() || 'Imported account';

/** Propose a mapping spec for a CSV. */
export function suggest(
  file: string,
  text: string,
  state: MapperState,
  model: Model = personalModel(state.corrections)
): Suggestion {
  const { rows } = readTable(text);
  const headerRow = detectHeaderRow(rows);
  const signature = layoutSignature(rows, headerRow);
  const base = {
    kind: 'bank-csv' as const,
    version: 1 as const,
    currency: 'AUD',
    account: stem(file),
  };
  const remembered = state.layouts.find((l) => l.signature === signature);
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (remembered && remembered.columns.length === width) {
    return {
      spec: {
        ...base,
        headerRow: remembered.headerRow,
        columns: [...remembered.columns],
        dateOrder: remembered.dateOrder,
        invert: remembered.invert,
      },
      columns: remembered.columns.map((field) => ({ field, confidence: 1, by: 'memory' })),
      source: 'a layout you used before',
    };
  }
  const dateOrderOf = (columns: Field[]) => {
    const j = columns.indexOf('date');
    return j < 0
      ? 'dmy'
      : detectDateOrder(dataRowIndices(rows, headerRow).map((i) => rows[i]![j] ?? ''));
  };
  const preset = matchPreset(rows, headerRow);
  if (preset) {
    const columns = preset.columns;
    return {
      spec: {
        ...base,
        headerRow,
        columns,
        dateOrder: preset.preset.dateOrder ?? dateOrderOf(columns),
        invert: false,
        preset: preset.preset.id,
      },
      columns: columns.map((field) => ({ field, confidence: 1, by: 'preset' })),
      source: preset.preset.label,
    };
  }
  const xs = tableFeatures(rows, headerRow);
  const assigned = assignFields(xs.map((x) => predict(model, x)));
  const columns = assigned.map((a) => a.field);
  return {
    spec: { ...base, headerRow, columns, dateOrder: dateOrderOf(columns), invert: false },
    columns: assigned.map((a) => ({ ...a, by: 'model' })),
    source: 'the column mapper',
  };
}

/**
 * Learn from a confirmed import: remember the layout, and keep every column
 * the model got wrong, or was unsure of, as a training sample.
 */
export function learn(
  state: MapperState,
  text: string,
  confirmed: BankCsvSpec,
  now: Date,
  model: Model = personalModel(state.corrections)
): MapperState {
  const { rows } = readTable(text);
  const at = now.toISOString();
  const signature = layoutSignature(rows, confirmed.headerRow);
  const layouts = [
    {
      signature,
      headerRow: confirmed.headerRow,
      columns: [...confirmed.columns],
      dateOrder: confirmed.dateOrder,
      invert: confirmed.invert,
      at,
    },
    ...state.layouts.filter((l) => l.signature !== signature),
  ].slice(0, MAX_LAYOUTS);
  const xs = tableFeatures(rows, confirmed.headerRow);
  const predicted = assignFields(xs.map((x) => predict(model, x)));
  const header = confirmed.headerRow === null ? [] : rows[confirmed.headerRow]!;
  const fixed: Correction[] = [];
  confirmed.columns.forEach((field, j) => {
    const p = predicted[j];
    if (xs[j] && (p?.field !== field || p.confidence < UNSURE))
      fixed.push({ header: header[j] ?? '', x: xs[j]!, field, at });
  });
  return { layouts, corrections: [...state.corrections, ...fixed].slice(-MAX_CORRECTIONS) };
}

/** Preset names, for the docs and the Import screen. */
export const PRESET_NAMES = PRESETS.map((p) => p.label);
