/** How long to plan for, from a rough age and a country (ADR 0043). */
import { describe, expect, test } from 'vitest';
import {
  EMPTY_PROFILE,
  ageNow,
  countryFromDevice,
  lifespanFacts,
  modalAge,
  planAge,
  survival,
  yearsOfFreedom,
  type Profile,
} from '../../src/profile/lifespan.ts';

const today = '2026-10-15';
const au = (p: Partial<Profile> = {}): Profile => ({
  ...EMPTY_PROFILE,
  country: 'AU',
  you: { years: 40, asOf: today, sex: 'male' },
  ...p,
});

describe('the country comes from the device, not the network', () => {
  test('time zone first, then the language region', () => {
    expect(countryFromDevice('Australia/Sydney', ['en-US'])).toBe('AU');
    expect(countryFromDevice('America/Toronto', ['en-US'])).toBe('CA');
    expect(countryFromDevice('America/Chicago', [])).toBe('US');
    expect(countryFromDevice('UTC', ['en-NZ', 'en'])).toBe('NZ');
    expect(countryFromDevice('Europe/Madrid', ['es-ES'])).toBe('EU');
    expect(countryFromDevice('Asia/Kolkata', ['hi-IN'])).toBeUndefined();
  });
});

describe('the Gompertz curve matches the life table', () => {
  test('its mean at birth is the country figure', () => {
    const m = modalAge(82.1);
    let mean = 0;
    for (let x = 0; x < 140; x += 0.01) mean += 0.01 * survival(x + 0.005, 0, m);
    expect(mean).toBeCloseTo(82.1, 1);
    // A plausible most-common age at death for a long-lived country.
    expect(m).toBeGreaterThan(85);
    expect(m).toBeLessThan(92);
  });
});

describe('plan to the age 1 in 4 people live past', () => {
  test('an Australian man of 40', () => {
    const p = planAge(au(), today)!;
    expect(p.ageNow).toBe(40);
    expect(p.typical).toBeGreaterThanOrEqual(82);
    expect(p.typical).toBeLessThanOrEqual(87);
    expect(p.planTo).toBeGreaterThan(p.typical);
    expect(p.planTo).toBeLessThanOrEqual(95);
    expect(p.provenance).toBe('assumed');
  });

  test('more caution plans longer; women and couples plan longer still', () => {
    const quarter = planAge(au(), today)!.planTo;
    expect(planAge(au({ planFor: 'tenth' }), today)!.planTo).toBeGreaterThan(quarter);
    expect(planAge(au({ planFor: 'half' }), today)!.planTo).toBeLessThan(quarter);
    expect(
      planAge(au({ you: { years: 40, asOf: today, sex: 'female' } }), today)!.planTo
    ).toBeGreaterThan(quarter);
    expect(
      planAge(au({ partner: { years: 35, asOf: today, sex: 'female' } }), today)!.planTo
    ).toBeGreaterThan(quarter);
  });

  test('nothing without an age and a country; own figures for countries not listed', () => {
    expect(planAge({ ...EMPTY_PROFILE, country: 'AU' }, today)).toBeUndefined();
    expect(planAge(au({ country: 'other' }), today)).toBeUndefined();
    expect(
      planAge(au({ country: 'other', own: { male: 70, female: 75 } }), today)!.planTo
    ).toBeLessThan(planAge(au(), today)!.planTo);
  });

  test('the age moves on by itself', () => {
    expect(ageNow({ years: 40, asOf: '2024-03-01', sex: 'male' }, today)).toBe(42);
    expect(ageNow({ years: 40, asOf: '2026-01-01', sex: 'male' }, today)).toBe(40);
  });

  test('years of freedom run from the age at freedom to the plan’s end', () => {
    const p = planAge(au(), today)!;
    expect(yearsOfFreedom(p, today, '2038-10-01')).toBe(p.planTo - 52);
  });
});

describe('what the advisor is told', () => {
  test('ages and years, never a date of birth', () => {
    const f = lifespanFacts(au(), { start: '2038-10-01', horizonYears: 30 }, today);
    expect(f).toMatchObject({ ageNow: 40, ageWhenFreedomStarts: 52, yearsLeftToWork: 12 });
    expect(f.yearsToFund).toBe((f.planToAge as number) - 52);
    expect(JSON.stringify(f)).not.toMatch(/asOf|\d{4}-\d{2}-\d{2}/);
  });

  test('without an age, how to add one', () => {
    expect(
      lifespanFacts(EMPTY_PROFILE, { start: '2038-10-01', horizonYears: 30 }, today).none
    ).toMatch(/Profile screen/);
  });
});
