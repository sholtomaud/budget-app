/** Holdings one at a time (ADR 0048): add, change, remove, and the plan stays consistent. */
import { describe, expect, test } from 'vitest';
import { changeHolding, defaultSetup, type FreedomSetup } from '../../src/sim/inputs.ts';
import { emptyBudget } from '../../src/budget/state.ts';

const base = (): FreedomSetup => {
  const s = defaultSetup(
    { accounts: [], balances: [], txns: [], assets: [], budget: emptyBudget() },
    '2026-10-01'
  );
  return {
    ...s,
    holdings: [
      {
        id: 'cash',
        name: 'Savings',
        assetClass: 'cash',
        value: 7_000_00n,
        returnModelId: 'cash',
        provenance: 'actual',
      },
      {
        id: 'etf',
        name: 'Shares',
        assetClass: 'equity',
        value: 690_000_00n,
        returnModelId: 'equity',
        provenance: 'actual',
      },
      {
        id: 'super',
        name: 'Super',
        assetClass: 'super',
        value: 390_000_00n,
        returnModelId: 'super',
        provenance: 'actual',
      },
    ],
    decisions: {
      ...s.decisions,
      sellOrder: ['cash', 'etf', 'super'],
      allocation: { etf: 1 },
      withdrawal: { kind: 'hold', holdingIds: ['etf'] },
    },
  };
};

describe('changing one holding (ADR 0048)', () => {
  test('Bitcoin is added as its own holding, with its own model, sold after shares', () => {
    const r = changeHolding(base(), {
      change: 'add',
      assetClass: 'btc',
      value: 50_000_00n,
      id: 'b1',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.holding).toMatchObject({
      assetClass: 'btc',
      returnModelId: 'btc',
      name: 'Bitcoin',
      provenance: 'actual',
    });
    expect(r.setup.decisions.sellOrder).toEqual(['cash', 'etf', 'b1', 'super']);
    // The other holdings are untouched.
    expect(r.setup.holdings.find((h) => h.id === 'etf')!.value).toBe(690_000_00n);
  });

  test('a model the plan has is kept; one it lacks gives way to the kind’s default', () => {
    const ok = changeHolding(base(), {
      change: 'add',
      assetClass: 'btc',
      value: 1n,
      id: 'b',
      returnModelId: 'btc-bootstrap',
    });
    expect(ok.ok && ok.holding!.returnModelId).toBe('btc-bootstrap');
    const odd = changeHolding(base(), {
      change: 'add',
      assetClass: 'btc',
      value: 1n,
      id: 'b',
      returnModelId: 'moon',
    });
    expect(odd.ok && odd.holding!.returnModelId).toBe('btc');
  });

  test('a change of value or kind; a new kind takes its model', () => {
    const v = changeHolding(base(), { change: 'update', holdingId: 'etf', value: 640_000_00n });
    expect(v.ok && v.holding).toMatchObject({ value: 640_000_00n, returnModelId: 'equity' });
    const k = changeHolding(base(), { change: 'update', holdingId: 'etf', assetClass: 'btc' });
    expect(k.ok && k.holding).toMatchObject({ assetClass: 'btc', returnModelId: 'btc' });
  });

  test('removing one takes it out of the sell order, new savings and hold', () => {
    const r = changeHolding(base(), { change: 'remove', holdingId: 'etf' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.setup.holdings.map((h) => h.id)).toEqual(['cash', 'super']);
    expect(r.setup.decisions.sellOrder).toEqual(['cash', 'super']);
    expect(r.setup.decisions.allocation).toEqual({});
    expect(r.setup.decisions.withdrawal).toEqual({ kind: 'hold', holdingIds: [] });
  });

  test('refused: a negative value, or a holding that isn’t there', () => {
    expect(
      changeHolding(base(), { change: 'add', assetClass: 'btc', value: -1n, id: 'x' }).ok
    ).toBe(false);
    expect(changeHolding(base(), { change: 'remove', holdingId: 'nope' }).ok).toBe(false);
  });
});
