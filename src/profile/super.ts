/**
 * Super locked until preservation age, from the profile's age (ADR 0044).
 * Pure: the app applies it to the saved plan.
 */
import { addMonths } from '../lib/dates.ts';
import type { Holding } from '../sim/model.ts';
import { ageNow, type Profile } from './lifespan.ts';

/**
 * Each super holding the person hasn't dated by hand is locked until its
 * owner reaches `preservationAge` (the partner's age for 'p2', the person's
 * otherwise). The age is in whole years, so the date is the later end: up to
 * a year late, never early. Undefined when nothing changes.
 */
export function superLocks(
  holdings: readonly Holding[],
  p: Profile,
  preservationAge: number,
  today: string
): Holding[] | undefined {
  let changed = false;
  const out = holdings.map((h) => {
    if (h.assetClass !== 'super' || (h.accessibleFrom && h.lockedBy !== 'profile')) return h;
    const who = h.owner === 'p2' ? p.partner : p.you;
    if (!who) return h;
    const years = preservationAge - ageNow(who, today);
    const { accessibleFrom: _from, lockedBy: _by, ...rest } = h;
    const next: Holding =
      years > 0
        ? {
            ...rest,
            accessibleFrom: addMonths(`${today.slice(0, 7)}-01`, years * 12),
            lockedBy: 'profile',
          }
        : rest;
    if (next.accessibleFrom === h.accessibleFrom && next.lockedBy === h.lockedBy) return h;
    changed = true;
    return next;
  });
  return changed ? out : undefined;
}
