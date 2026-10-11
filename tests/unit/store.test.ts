import { describe, expect, test } from 'vitest';
import { Store } from '../../src/app/core/store.ts';

describe('Store', () => {
  test('merges partial state and notifies subscribers', () => {
    const store = new Store({ a: 1, b: 2 });
    const seen: Array<{ a: number; b: number }> = [];
    const off = store.subscribe((s) => seen.push(s));
    store.setState({ b: 3 });
    off();
    store.setState({ a: 9 });
    expect(seen).toEqual([{ a: 1, b: 3 }]);
    expect(store.getState()).toEqual({ a: 9, b: 3 });
  });

  test('getState returns a copy', () => {
    const store = new Store({ a: 1 });
    store.getState().a = 5;
    expect(store.getState().a).toBe(1);
  });
});
