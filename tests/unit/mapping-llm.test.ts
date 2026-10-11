import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { maskCell, mappingPrompt, toMapping } from '../../src/api/mapping-llm.ts';
import { preview } from '../../src/budget/workbook.ts';
import { parseCsv } from '../../src/lib/csv.ts';
import { validate } from '../../src/lib/jsonschema.ts';

const csv = readFileSync(
  new URL('../../fixtures/syn-default-42/workbook/opex-budget.csv', import.meta.url),
  'utf8'
);
const rows = parseCsv(csv);

describe('LLM mapping assistant (FR-ING-015…018)', () => {
  test('cells are masked: amounts become ranges, dates <date>, identifiers removed', () => {
    expect(maskCell('$1,234.50')).toBe('<number $1,000–2,000>');
    expect(maskCell('12')).toBe('<number $10–20>');
    expect(maskCell('2025-03-14')).toBe('<date>');
    expect(maskCell('14 Mar 2025')).toBe('<date>');
    expect(maskCell('35%')).toBe('<percent>');
    expect(maskCell('Rent SYN-TXN')).toBe('Rent [account]');
  });

  test('the prompt carries no figure from the sheet', () => {
    const p = mappingPrompt(rows, ['secure', 'independent', 'luxury']);
    const figures = csv.match(/\d+\.\d{2}/g) ?? [];
    expect(figures.length).toBeGreaterThan(0);
    for (const f of figures) expect(p.user).not.toContain(f);
  });

  test('an answer is validated against the sheet and turned into a working mapping', () => {
    const p = mappingPrompt(rows, ['secure', 'independent', 'luxury']);
    const auto = preview('opex-budget.csv', csv).mapping;
    // An answer matching the preset's own detection, plus junk the guard must drop.
    const answer = {
      type: auto.type,
      headerRow: auto.headerRow,
      columns: [
        ...Object.entries(auto.columns).map(([field, column]) => ({ field, column })),
        { field: 'replacementYear', column: 0 }, // a CAPEX field on an OPEX sheet
        { field: 'notes', column: 999 }, // out of range
      ],
      tierColumns: Object.entries(auto.tierColumns).map(([c, tier]) => ({
        column: Number(c),
        tier,
      })),
    };
    expect(validate(p.schema, answer)).toBeNull();
    const m = toMapping(answer, rows);
    expect(m.columns).toEqual(auto.columns);
    expect(m.tierColumns).toEqual(auto.tierColumns);
    const viaLlm = preview('opex-budget.csv', csv, { mapping: m });
    const viaRules = preview('opex-budget.csv', csv);
    expect(viaLlm.lines.length).toBe(viaRules.lines.length);
    expect(viaLlm.totals).toEqual(viaRules.totals);
  });
});
