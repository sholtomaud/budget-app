import { describe, expect, test } from 'vitest';
import { formatAmount, parseAmount } from '../../src/lib/money.ts';

describe('money (FR-ING-003)', () => {
  test('parses decimal strings to integer minor units without floats', () => {
    expect(parseAmount('-63.85')).toBe(-6385n);
    expect(parseAmount('0.1') + parseAmount('0.2')).toBe(parseAmount('0.3'));
    expect(parseAmount('1200')).toBe(120000n);
    expect(parseAmount('+5.1')).toBe(510n);
    expect(parseAmount('12.300')).toBe(1230n);
    expect(parseAmount('90071992547409.93')).toBe(9007199254740993n);
    expect(parseAmount('0.00000001', 'BTC')).toBe(1n);
    expect(parseAmount('100', 'JPY')).toBe(100n);
  });

  test('rejects non-decimals and excess precision', () => {
    expect(() => parseAmount('1e3')).toThrow(/Not a decimal/);
    expect(() => parseAmount('12.345')).toThrow(/decimal places/);
    expect(() => parseAmount('')).toThrow();
  });

  test('formats round-trip', () => {
    for (const s of ['-63.85', '0.05', '-0.05', '1200.00', '0.00'])
      expect(formatAmount(parseAmount(s))).toBe(s);
    expect(formatAmount(1n, 'BTC')).toBe('0.00000001');
  });
});
