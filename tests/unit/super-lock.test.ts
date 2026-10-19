import { describe, expect, test } from 'vitest';
import { superLocks } from '../../src/profile/super.ts';
import type { Profile } from '../../src/profile/lifespan.ts';
import type { Holding } from '../../src/sim/model.ts';

const holding = (over: Partial<Holding>): Holding => ({
  id: 'h',
  name: 'Super',
  assetClass: 'super',
  value: 100_000_00n,
  returnModelId: 'super',
  provenance: 'assumed',
  ...over,
});

const profile: Profile = {
  planFor: 'quarter',
  setsHorizon: true,
  you: { years: 53, asOf: '2026-10-19', sex: 'unspecified' },
  partner: { years: 58, asOf: '2026-10-19', sex: 'unspecified' },
};

describe('super locked until preservation age (FR-GOAL-023)', () => {
  test("locks each super holding from its owner's age, up to a year late, never early", () => {
    const out = superLocks(
      [
        holding({ id: 'a' }),
        holding({ id: 'b', owner: 'p2' }),
        holding({ id: 'c', assetClass: 'equity' }),
      ],
      profile,
      60,
      '2026-10-19'
    )!;
    expect(out[0]).toMatchObject({ accessibleFrom: '2033-10-01', lockedBy: 'profile' });
    expect(out[1]).toMatchObject({ accessibleFrom: '2028-10-01', lockedBy: 'profile' });
    expect(out[2]!.accessibleFrom).toBeUndefined();
  });

  test('a date set by hand stays; a profile date follows the age; past preservation age unlocks', () => {
    const own = holding({ accessibleFrom: '2035-01-01' });
    expect(superLocks([own], profile, 60, '2026-10-19')).toBeUndefined();
    const auto = holding({ accessibleFrom: '2033-10-01', lockedBy: 'profile' });
    expect(superLocks([auto], profile, 60, '2026-10-19')).toBeUndefined();
    const older = { ...profile, you: { ...profile.you!, years: 61 } };
    const [free] = superLocks([auto], older, 60, '2026-10-19')!;
    expect(free!.accessibleFrom).toBeUndefined();
    expect(free!.lockedBy).toBeUndefined();
  });

  test('no age, no change', () => {
    expect(
      superLocks([holding({})], { planFor: 'quarter', setsHorizon: true }, 60, '2026-10-19')
    ).toBeUndefined();
  });
});
