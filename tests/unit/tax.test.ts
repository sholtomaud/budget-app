import { describe, expect, test } from 'vitest';
import {
  incomeTax,
  medicareLevy,
  taxableGain,
  taxProvenance,
  taxTable,
  totalTax,
} from '../../src/sim/tax.ts';

const t = taxTable('au-2025-26');

describe('AU 2025-26 income tax (SPEC §11.2, §16.1)', () => {
  // Worked from the ATO resident rates table for 2025-26.
  test.each([
    [0, 0],
    [18_200, 0],
    [30_000, 1_888],
    [45_000, 4_288],
    [100_000, 20_788],
    [135_000, 31_288],
    [190_000, 51_638],
    [250_000, 78_638],
  ])('income tax on %i is %i', (income, tax) => {
    expect(incomeTax(t, income)).toBeCloseTo(tax, 6);
  });

  test('Medicare levy: none at the threshold, shaded in above it, then 2 %', () => {
    expect(medicareLevy(t, 27_222)).toBe(0);
    expect(medicareLevy(t, 30_000)).toBeCloseTo((30_000 - 27_222) * 0.1, 6);
    expect(medicareLevy(t, 100_000)).toBeCloseTo(2_000, 6);
    expect(totalTax(t, 100_000)).toBeCloseTo(22_788, 6);
  });

  test('CGT discount applies from 12 months of holding', () => {
    expect(taxableGain(t, 10_000, 11)).toBe(10_000);
    expect(taxableGain(t, 10_000, 12)).toBe(5_000);
    expect(taxableGain(t, -5, 24)).toBe(0);
  });

  test('an unverified table is labelled assumed (NFR-HON-001)', () => {
    expect(t.verifiedBy).toBeNull();
    expect(taxProvenance(t)).toBe('assumed');
    expect(taxProvenance({ ...t, verifiedBy: 'x', verifiedOn: '2026-01-01' })).toBe('calibrated');
  });
});
