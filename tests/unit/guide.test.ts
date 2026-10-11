import { describe, expect, test } from 'vitest';
import { GUIDE, guideStore, isDone, nextStep, restartGuide, visit } from '../../src/app/guide.ts';

describe('getting-started guide (ADR 0020)', () => {
  test('starts with adding data; screens only count once there is data', () => {
    restartGuide();
    expect(nextStep(false, [])?.id).toBe('data');
    visit('/ledger', false);
    expect(guideStore.getState().visited).toEqual([]);
    expect(nextStep(true, [])?.id).toBe('transactions');
  });

  test('visiting screens ticks steps off in any order; the guide ends when all are done', () => {
    restartGuide();
    visit('/budget', true);
    visit('/ledger', true);
    const { visited } = guideStore.getState();
    expect(isDone(GUIDE[2]!, true, visited)).toBe(true);
    expect(nextStep(true, visited)?.id).toBe('capex');
    for (const g of GUIDE) visit(g.path, true);
    expect(nextStep(true, guideStore.getState().visited)).toBeNull();
  });
});
