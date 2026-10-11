import { describe, expect, test } from 'vitest';
import { addMonths, localDateOf, weekday, zonedDateTime } from '../../src/lib/dates.ts';

describe('dates (FR-ING-008)', () => {
  test('local wall-clock times carry the zone offset, across daylight saving', () => {
    expect(zonedDateTime('2025-03-14', 9, 12, 0, 'Australia/Sydney')).toBe(
      '2025-03-14T09:12:00+11:00'
    );
    expect(zonedDateTime('2025-07-14', 9, 12, 0, 'Australia/Sydney')).toBe(
      '2025-07-14T09:12:00+10:00'
    );
    expect(zonedDateTime('2025-07-14', 9, 0, 0, 'UTC')).toBe('2025-07-14T09:00:00+00:00');
  });

  test('instants are bucketed to the local date of the configured zone', () => {
    expect(localDateOf('2025-03-13T14:30:00Z', 'Australia/Sydney')).toBe('2025-03-14');
    expect(localDateOf('2025-03-13T14:30:00Z', 'UTC')).toBe('2025-03-13');
    expect(localDateOf('2025-03-14T00:10:00+11:00', 'Australia/Perth')).toBe('2025-03-13');
  });

  test('month arithmetic clamps to the month length', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2024-07-01', 24)).toBe('2026-07-01');
    expect(weekday('2025-03-13')).toBe(4);
  });
});
