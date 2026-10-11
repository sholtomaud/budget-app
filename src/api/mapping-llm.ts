/**
 * The LLM mapping assistant (FR-ING-015…018, ADR 0014). It sees the first
 * rows of a CSV with every amount replaced by a range, dates by `<date>`
 * and text redacted, and answers with a mapping spec: sheet type, header
 * row, field → column and tier columns. The answer is validated locally
 * and the user confirms it in the wizard; it never writes a value.
 */
import { FIELDS, type Mapping, type SheetType } from '../budget/workbook.ts';
import type { Schema } from '../lib/jsonschema.ts';
import { bucketAmount, redactText } from './redact.ts';

const SHEET_TYPES = Object.keys(FIELDS) as SheetType[];
const ALL_FIELDS = [...new Set(SHEET_TYPES.flatMap((t) => FIELDS[t].map((f) => f.key)))];

const MONEY = /^\s*-?\(?\$?\s*-?[\d,]+(\.\d+)?\)?\s*$/;
const DATE = /^\s*(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\s*$/;

/** A cell as the assistant may see it. */
export function maskCell(cell: string): string {
  const c = cell.trim();
  if (!c) return '';
  if (DATE.test(c)) return '<date>';
  if (MONEY.test(c)) {
    const n = Number(c.replace(/[$,()\s]/g, ''));
    return Number.isFinite(n) ? `<number ${bucketAmount(n)}>` : '<number>';
  }
  if (/^\s*-?\d+(\.\d+)?\s*%\s*$/.test(c)) return '<percent>';
  return redactText(c).slice(0, 40);
}

export interface MappingPrompt {
  system: string;
  user: string;
  schema: Schema;
  sample: string[][];
}

export function mappingPrompt(
  rows: readonly string[][],
  tierIds: readonly string[],
  maxRows = 14
): MappingPrompt {
  const sample = rows.slice(0, maxRows).map((r) => r.map(maskCell));
  const fieldDocs = SHEET_TYPES.map(
    (t) => `${t}: ${FIELDS[t].map((f) => `${f.key} (${f.label})`).join(', ')}`
  ).join('\n');
  const schema: Schema = {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'headerRow', 'columns', 'tierColumns'],
    properties: {
      type: { type: 'string', enum: SHEET_TYPES },
      headerRow: { type: 'integer' },
      columns: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['field', 'column'],
          properties: { field: { type: 'string', enum: ALL_FIELDS }, column: { type: 'integer' } },
        },
      },
      tierColumns: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['column', 'tier'],
          properties: { column: { type: 'integer' }, tier: { type: 'string', enum: [...tierIds] } },
        },
      },
    },
  };
  return {
    sample,
    schema,
    system:
      "You map a household budget spreadsheet's columns onto a fixed schema. Rows and columns are numbered from 0. Values have been masked; work from headers and value shapes. Use only the listed fields, each column at most once. Tier columns hold per-tier multipliers in OPEX budgets. Answer only with the requested JSON.",
    user: `Sheet types and their fields:\n${fieldDocs}\n\nTiers: ${tierIds.join(', ')}\n\nFirst rows (row index: cells):\n${sample.map((r, i) => `${i}: ${JSON.stringify(r)}`).join('\n')}`,
  };
}

export interface MappingAnswer {
  type: SheetType;
  headerRow: number;
  columns: { field: string; column: number }[];
  tierColumns: { column: number; tier: string }[];
}

/** Validate an answer against the sheet and turn it into a Mapping, dropping anything inconsistent. */
export function toMapping(a: MappingAnswer, rows: readonly string[][]): Mapping {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const headerRow = a.headerRow >= 0 && a.headerRow < rows.length ? a.headerRow : 0;
  const allowed = new Set(FIELDS[a.type].map((f) => f.key));
  const columns: Record<string, number> = {};
  const used = new Set<number>();
  for (const c of a.columns) {
    if (!allowed.has(c.field) || c.field in columns) continue;
    if (c.column < 0 || c.column >= width || used.has(c.column)) continue;
    columns[c.field] = c.column;
    used.add(c.column);
  }
  const tierColumns: Record<number, string> = {};
  if (a.type === 'opex')
    for (const t of a.tierColumns)
      if (t.column >= 0 && t.column < width && !used.has(t.column)) tierColumns[t.column] = t.tier;
  return { type: a.type, headerRow, columns, tierColumns };
}
