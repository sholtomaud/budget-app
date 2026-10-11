import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
// @ts-expect-error -- plain .mjs script without type declarations
import { isValidTfn, scanFile } from '../../scripts/data-hygiene.mjs';

const scan = scanFile as (path: string, text: string | null) => string[];

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
    assert.deepEqual(scan('fixtures/syn-default-42/page-1.json', text), []);
  });

  test('fails a fixture without the x-synthetic marker', () => {
    const problems = scan('fixtures/x/accounts.json', '{"data":{}}');
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /x-synthetic/);
  });

  test('fixture CSVs need a leading marker line', () => {
    assert.deepEqual(scan('fixtures/x/budget.csv', '# x-synthetic: seed=42\nItem,Cost\n'), []);
    assert.equal(scan('fixtures/x/budget.csv', 'Item,Cost\n').length, 1);
  });

  test('fails a CDR accountId that is not SYN-', () => {
    const problems = scan('anything.json', `{ "${ACCOUNT_ID_KEY}": "a1b2c3d4" }`);
    assert.match(problems[0]!, /accountId "a1b2c3d4" is not synthetic/);
  });

  test('fails BSB-and-account-number patterns', () => {
    assert.equal(scan('notes.md', `Pay to ${BSB} 12345678 by Friday`).length, 1);
    assert.equal(scan('notes.md', `BSB ${BSB}, account 1234567`).length, 1);
  });

  test('fails a formatted TFN with a valid check digit, ignores invalid ones', () => {
    assert.ok(isValidTfn(TFN.join(' ')));
    assert.ok(!isValidTfn('123 456 789'));
    assert.equal(scan('notes.md', `my number is ${TFN.join(' ')}`).length, 1);
    assert.equal(scan('notes.md', `TFN: ${TFN.join('')}`).length, 1);
    assert.deepEqual(scan('notes.md', 'phone 123 456 789'), []);
  });

  test('forbids real-data file types and local-only directories anywhere', () => {
    assert.equal(scan('exports/statement.ofx', null).length, 1);
    assert.equal(scan('fixtures/workbook.xlsx', null).length, 1);
    assert.equal(scan('backup.budgetapp', null).length, 1);
    assert.equal(scan('data/notes.txt', '').length, 1);
    assert.equal(scan('private/x.json', '{}').length, 1);
  });
});
