/**
 * How long to plan for (ADR 0043). The profile holds a rough age (never a
 * date of birth), a country and, if the person says, a sex for the life
 * table. A Gompertz curve fitted to the country's life expectancy gives the
 * age a person of that age is likely to reach; the plan runs to the age that
 * 1 in 4 (or 1 in 2, or 1 in 10) of them live past. Pure and deterministic.
 */
import table from '../../data-tables/life-expectancy.json' with { type: 'json' };

export type Sex = 'female' | 'male' | 'unspecified';
/** The share of people that age who live past the plan's end. */
export type PlanFor = 'half' | 'quarter' | 'tenth';

export const PLAN_FOR: Record<PlanFor, { share: number; label: string }> = {
  half: { share: 0.5, label: 'The typical age (1 in 2 live longer)' },
  quarter: { share: 0.25, label: 'A long life (1 in 4 live longer)' },
  tenth: { share: 0.1, label: 'A very long life (1 in 10 live longer)' },
};

export interface PersonAge {
  /** Whole years, as the person gave it. */
  years: number;
  /** When they gave it, so the age moves on by itself. */
  asOf: string;
  sex: Sex;
}

export interface Profile {
  /** ISO 3166 code from the life table, or 'other' with the person's own figures. */
  country?: string;
  /** How the country was set: from this device's time zone or language, or by the person. */
  countryFrom?: 'device' | 'you';
  /** For a country not in the table: life expectancy at birth, years. */
  own?: { male: number; female: number };
  you?: PersonAge;
  partner?: PersonAge;
  planFor: PlanFor;
  /** The plan's length on the Freedom screen follows the profile (default on). */
  setsHorizon: boolean;
}

export const EMPTY_PROFILE: Profile = { planFor: 'quarter', setsHorizon: true };

export interface CountryRow {
  code: string;
  name: string;
  year: number;
  male: number;
  female: number;
  source: string;
}

export const COUNTRIES: readonly CountryRow[] = table.countries;

/** Spread of ages at death around the most common one, in years (assumed, typical of rich countries). */
export const DISPERSION = 10;

/** Time zones that name a country in the table without doubt. */
const ZONE_COUNTRY: [RegExp, string][] = [
  [/^Australia\//, 'AU'],
  [/^(Pacific\/Auckland|Pacific\/Chatham|NZ)$/, 'NZ'],
  [/^(Europe\/London|Europe\/Belfast|GB)$/, 'GB'],
  [/^(Europe\/Dublin|Eire)$/, 'IE'],
  [/^Europe\/(Berlin|Busingen)$/, 'DE'],
  [/^Europe\/Paris$/, 'FR'],
  [/^(Asia\/Tokyo|Japan)$/, 'JP'],
  [
    /^(America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Montreal|Moncton|Glace_Bay|Goose_Bay|Whitehorse|Dawson|Dawson_Creek|Fort_Nelson|Creston|Iqaluit|Rankin_Inlet|Resolute|Cambridge_Bay|Inuvik|Swift_Current|Atikokan|Blanc-Sablon)|Canada\/.*)$/,
    'CA',
  ],
  [
    /^(America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Juneau|Sitka|Nome|Adak|Boise|Detroit|Indiana\/.*|Kentucky\/.*|North_Dakota\/.*|Menominee|Metlakatla|Yakutat)|Pacific\/Honolulu|US\/.*)$/,
    'US',
  ],
];

/**
 * The country this device is set to, from its time zone, else its language
 * (en-AU → AU). On the device only: nothing is looked up online.
 */
export function countryFromDevice(
  timeZone: string,
  languages: readonly string[]
): string | undefined {
  const known = new Set(COUNTRIES.map((c) => c.code));
  for (const [re, code] of ZONE_COUNTRY) if (re.test(timeZone)) return code;
  for (const l of languages) {
    const region = /^[a-z]{2,3}[-_]([A-Z]{2})\b/i.exec(l)?.[1]?.toUpperCase();
    if (region && known.has(region)) return region;
  }
  if (/^Europe\//.test(timeZone)) return 'EU';
  return undefined;
}

/** Survival to age x for someone alive at age a, under Gompertz with modal age m. */
export function survival(x: number, a: number, m: number, b = DISPERSION): number {
  if (x <= a) return 1;
  return Math.exp(-(Math.exp((x - m) / b) - Math.exp((a - m) / b)));
}

/** The modal age at death that gives life expectancy `e0` at birth. */
export function modalAge(e0: number, b = DISPERSION): number {
  const mean = (m: number) => {
    let s = 0;
    for (let x = 0; x < 140; x += 0.1) s += 0.1 * survival(x + 0.05, 0, m, b);
    return s;
  };
  let lo = 30;
  let hi = 130;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (mean(mid) < e0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Life expectancy at birth for a sex; 'unspecified' takes the average of both. */
export function birthExpectancy(f: { male: number; female: number }, sex: Sex): number {
  return sex === 'male' ? f.male : sex === 'female' ? f.female : (f.male + f.female) / 2;
}

/** Age now, from the age given and when it was given (whole years). */
export function ageNow(p: PersonAge, today: string): number {
  const months =
    (Number(today.slice(0, 4)) - Number(p.asOf.slice(0, 4))) * 12 +
    Number(today.slice(5, 7)) -
    Number(p.asOf.slice(5, 7));
  return p.years + Math.max(0, Math.floor(months / 12));
}

/**
 * The age by which only `share` of the household is still alive: for a couple,
 * the last of the two. `people` are [age now, modal age] pairs.
 */
export function ageReached(people: readonly [number, number][], share: number): number {
  const alive = (x: number) => 1 - people.reduce((p, [a, m]) => p * (1 - survival(x, a, m)), 1);
  let lo = Math.min(...people.map(([a]) => a));
  let hi = 140;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (alive(mid) > share) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface PlanAge {
  /** Plan to this age (of the person, not the partner): whole years, rounded up. */
  planTo: number;
  /** The age at which half the household is still alive, for comparison. */
  typical: number;
  ageNow: number;
  /** Where the life expectancy figures came from. */
  source: string;
  provenance: 'assumed';
}

/** The country's figures: the table's, or the person's own. */
export function countryFigures(
  p: Profile
): { male: number; female: number; source: string } | undefined {
  if (p.country === 'other')
    return p.own && p.own.male > 0 && p.own.female > 0
      ? { ...p.own, source: 'your own figures' }
      : undefined;
  const c = COUNTRIES.find((x) => x.code === p.country);
  return c && { male: c.male, female: c.female, source: `${c.name} ${c.year}, ${c.source}` };
}

/** How long to plan for, or undefined until the profile has an age and a country. */
export function planAge(p: Profile, today: string): PlanAge | undefined {
  const f = countryFigures(p);
  if (!f || !p.you) return undefined;
  const persons = [p.you, ...(p.partner ? [p.partner] : [])];
  const ages = persons.map((x) => ageNow(x, today));
  const modal = persons.map((x) => modalAge(birthExpectancy(f, x.sex)));
  // Gompertz is shift-invariant, so each person counts in years from now (m − age).
  // For a couple, the plan lasts until the last of them; said as the person's own age.
  const ahead = modal.map((m, i) => [0, m - ages[i]!] as [number, number]);
  const ageAt = (share: number) => ages[0]! + ageReached(ahead, share);
  return {
    planTo: Math.ceil(ageAt(PLAN_FOR[p.planFor].share)),
    typical: Math.round(ageAt(0.5)),
    ageNow: ages[0]!,
    source: f.source,
    provenance: 'assumed',
  };
}

/** Years of freedom: from the person's age when freedom starts to the plan's end. */
export function yearsOfFreedom(plan: PlanAge, today: string, start: string): number {
  const months =
    (Number(start.slice(0, 4)) - Number(today.slice(0, 4))) * 12 +
    Number(start.slice(5, 7)) -
    Number(today.slice(5, 7));
  return Math.max(1, Math.round(plan.planTo - (plan.ageNow + Math.max(0, months) / 12)));
}

/**
 * What the profile says about the plan's timeline, for the advisor (ADR 0043):
 * ages in whole years, never a date of birth.
 */
export function lifespanFacts(
  p: Profile,
  goal: { start: string; horizonYears: number },
  today: string
): Record<string, unknown> {
  const plan = planAge(p, today);
  if (!plan)
    return {
      none: p.you
        ? 'The profile has no country figures, so there is no planning age. The user can choose a country on the Profile screen.'
        : 'There is no age in the profile. The user can add a rough age on the Profile screen; Crux then works out how many years to plan for.',
    };
  const fund = yearsOfFreedom(plan, today, goal.start);
  const ageAtFreedom = plan.planTo - fund;
  return {
    ageNow: plan.ageNow,
    ...(p.partner ? { partnerAgeNow: ageNow(p.partner, today) } : {}),
    typicalAge: plan.typical,
    planToAge: plan.planTo,
    plannedFor: PLAN_FOR[p.planFor].label,
    ageWhenFreedomStarts: ageAtFreedom,
    yearsLeftToWork: Math.max(0, ageAtFreedom - plan.ageNow),
    yearsToFund: fund,
    yearsOfFreedomSetBy: p.setsHorizon ? 'the profile' : 'hand, on the Freedom screen',
    lifeTable: plan.source,
    provenance: plan.provenance,
  };
}
