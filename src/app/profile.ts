/**
 * The profile in the vault (ADR 0043): a rough age, a country and how long
 * to plan for. When it sets the plan's length, the Freedom plan's years of
 * freedom follow it, from the person's age when freedom starts.
 */
import { SETUP_CHANGED } from './proposals.ts';
import { sim } from './workers.ts';
import {
  EMPTY_PROFILE,
  countryFromDevice,
  planAge,
  yearsOfFreedom,
  type Profile,
} from '../profile/lifespan.ts';
import { superLocks } from '../profile/super.ts';
import { DEFAULT_TAX_TABLE, type FreedomSetup } from '../sim/inputs.ts';
import type { Holding } from '../sim/model.ts';
import { taxTable } from '../sim/tax.ts';

export const PROFILE_CHANGED = 'app:profile-changed';

export const today = () => new Date().toISOString().slice(0, 10);

/** The saved profile; a new one takes its country from this device. */
export async function loadProfile(): Promise<Profile> {
  const saved = (await sim().loadKv('profile')) as Profile | null;
  if (saved) return { ...EMPTY_PROFILE, ...saved };
  const country = countryFromDevice(
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    navigator.languages ?? [navigator.language]
  );
  return { ...EMPTY_PROFILE, ...(country ? { country, countryFrom: 'device' as const } : {}) };
}

export async function saveProfile(p: Profile): Promise<void> {
  await sim().saveKv('profile', p);
  window.dispatchEvent(new CustomEvent(PROFILE_CHANGED));
}

/** The plan's years of freedom from the profile, or undefined if it doesn't set them. */
export function profileHorizon(p: Profile, setup: FreedomSetup): number | undefined {
  if (!p.setsHorizon) return undefined;
  const plan = planAge(p, today());
  return plan && yearsOfFreedom(plan, today(), setup.goal.start);
}

/** Super holdings locked until preservation age from the profile's age, or undefined if unchanged. */
export function profileSuperLocks(p: Profile, setup: FreedomSetup): Holding[] | undefined {
  const age = taxTable(setup.taxTable ?? DEFAULT_TAX_TABLE).superannuation.preservationAge;
  return superLocks(setup.holdings, p, age, today());
}

/** Save what the profile sets in the plan (years of freedom, super's lock), if it differs. */
export async function applyProfile(p: Profile): Promise<void> {
  const setup = await sim().loadSetup();
  if (!setup) return;
  const years = profileHorizon(p, setup);
  const holdings = profileSuperLocks(p, setup);
  if ((years === undefined || years === setup.goal.horizonYears) && !holdings) return;
  await sim().saveSetup({
    ...setup,
    ...(holdings ? { holdings } : {}),
    goal: { ...setup.goal, horizonYears: years ?? setup.goal.horizonYears },
  });
  window.dispatchEvent(new CustomEvent(SETUP_CHANGED));
}
