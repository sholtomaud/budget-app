import { describe, expect, test } from 'vitest';
import { isValidTfn, scanFile as scan } from '../../scripts/data-hygiene.ts';

// Real-looking values are assembled at runtime so this file passes the gate it tests.
const BSB = ['062', '000'].join('-');
const TFN = ['123', '456', '782'];
const ACCOUNT_ID_KEY = ['account', 'Id'].join('');

describe('data-hygiene gate (NFR-PRIV-002)', () => {
  test('passes synthetic CDR fixtures', () => {
    const text = JSON.stringify({
      'x-synthetic': { generator: 'budget-app/synth@0.1.0', seed: '42' },
      data: { transactions: [{ accountId: 'SYN-TXN', amount: '-63.85' }] },
    });
    expect(scan('fixtures/syn-default-42/page-1.json', text)).toEqual([]);
  });

  test('fails a fixture without the x-synthetic marker', () => {
    const problems = scan('fixtures/x/accounts.json', '{"data":{}}');
    expect(problems.length).toBe(1);
    expect(problems[0]!).toMatch(/x-synthetic/);
  });

  test('fixture CSVs need a leading marker line', () => {
    expect(scan('fixtures/x/budget.csv', '# x-synthetic: seed=42\nItem,Cost\n')).toEqual([]);
    expect(scan('fixtures/x/budget.csv', 'Item,Cost\n').length).toBe(1);
  });

  test('fails a CDR accountId that is not SYN-', () => {
    const problems = scan('anything.json', `{ "${ACCOUNT_ID_KEY}": "a1b2c3d4" }`);
    expect(problems[0]!).toMatch(/accountId "a1b2c3d4" is not synthetic/);
  });

  test('fails BSB-and-account-number patterns', () => {
    expect(scan('notes.md', `Pay to ${BSB} 12345678 by Friday`).length).toBe(1);
    expect(scan('notes.md', `BSB ${BSB}, account 1234567`).length).toBe(1);
  });

  test('fails a formatted TFN with a valid check digit, ignores invalid ones', () => {
    expect(isValidTfn(TFN.join(' '))).toBe(true);
    expect(isValidTfn('123 456 789')).toBe(false);
    expect(scan('notes.md', `my number is ${TFN.join(' ')}`).length).toBe(1);
    expect(scan('notes.md', `TFN: ${TFN.join('')}`).length).toBe(1);
    expect(scan('notes.md', 'phone 123 456 789')).toEqual([]);
  });

  test('forbids real-data file types and local-only directories anywhere', () => {
    expect(scan('exports/statement.ofx', null).length).toBe(1);
    expect(scan('fixtures/workbook.xlsx', null).length).toBe(1);
    expect(scan('backup.budgetapp', null).length).toBe(1);
    expect(scan('data/notes.txt', '').length).toBe(1);
    expect(scan('private/x.json', '{}').length).toBe(1);
  });
});
