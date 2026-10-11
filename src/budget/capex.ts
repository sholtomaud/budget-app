/**
 * The CAPEX register's numbers (FR-CAP-001…005): replacement timing and cost,
 * the sinking fund, and annualised CAPEX per tier.
 */
import type { Asset } from '../domain/types.ts';
import { daysBetween, type IsoDate } from '../lib/dates.ts';
import { deriveSeed, Rng } from '../lib/prng.ts';
import { expectedReplacements, replacementSummary, type ReplacementSummary } from './lifetime.ts';
import { tierRank, type Tier, type TierId } from './model.ts';

export interface AssetView {
  asset: Asset;
  /** Null for wish-list items not yet bought. */
  replacement: ReplacementSummary | null;
  /** Replacement cost at P50, in today's dollars (real) and in dollars of the day (nominal). */
  costReal: bigint;
  costNominal: bigint;
  /** Real cost per week of owning it: cost / life / 52. */
  perWeek: number;
  /** Expected replacements within the horizon. */
  expectedCount: number;
  expectedByYear: number[];
}

export interface CapexSummary {
  assets: AssetView[];
  /** FR-CAP-002: weekly set-aside (minor units, real) that funds the expected replacements over the horizon. */
  sinkingFundPerWeek: number;
  horizonYears: number;
  /** Expected real CAPEX per year of the horizon. */
  expectedByYear: number[];
}

/** An asset counts toward a tier when the tier is at least the asset's lowest tier (FR-CAP-003). */
export function inTier(asset: Asset, tier: TierId, tiers: readonly Tier[]): boolean {
  if (asset.status === 'retired') return false;
  if (asset.decision?.action === 'drop') return false;
  return tierRank(tiers, asset.tier ?? tiers[0]?.id) <= tierRank(tiers, tier);
}

/** FR-CAP-003: Σ replacement cost / life, per week, over assets included in the tier (minor units). */
export function annualisedCapexPerWeek(
  assets: readonly Asset[],
  tier: TierId,
  tiers: readonly Tier[]
): number {
  let total = 0;
  for (const a of assets) {
    if (!a.replace && a.status === 'owned') continue;
    if (!inTier(a, tier, tiers)) continue;
    const cost = Number((a.forecastCost ?? a.cost).minor);
    total += cost / Math.max(0.1, a.life.meanYears) / 52;
  }
  return total;
}

export function capexSummary(
  assets: readonly Asset[],
  today: IsoDate,
  opts: { cpi: number; horizonYears: number; seed?: bigint }
): CapexSummary {
  const H = opts.horizonYears;
  const yearly = new Array<number>(Math.ceil(H)).fill(0);
  const views: AssetView[] = [];
  for (const a of assets) {
    const shape = a.life.shape ?? 2.5;
    const cost = (a.forecastCost ?? a.cost).minor;
    const growth = a.replacementCostGrowth ?? 0;
    let replacement: ReplacementSummary | null = null;
    let expectedCount = 0;
    let expectedByYear = new Array<number>(Math.ceil(H)).fill(0);
    const active = a.status !== 'retired' && a.decision?.action !== 'drop';
    if (a.status === 'owned' && a.purchasedAt && active) {
      const age = Math.max(0, daysBetween(a.purchasedAt, today) / 365.25);
      replacement = replacementSummary(a.life.meanYears, shape, age);
      if (a.replace) {
        const rng = new Rng(deriveSeed(opts.seed ?? 42n, 'capex', a.id));
        const e = expectedReplacements(a.life.meanYears, shape, age, H, rng, 2000);
        expectedCount = e.count;
        expectedByYear = e.byYear;
      }
    } else if (
      (a.status === 'wish' || a.status === 'planned') &&
      active &&
      a.decision?.action !== 'defer'
    ) {
      // A wish-list item to buy by a date counts once, in that year (FR-CAP-004).
      const by = a.decision?.by;
      const y = by
        ? Math.max(0, Math.min(Math.ceil(H) - 1, Math.floor(daysBetween(today, by) / 365.25)))
        : 0;
      expectedByYear[y] = 1;
      expectedCount = 1;
    }
    const years = replacement?.p50 ?? 0;
    const costReal = BigInt(Math.round(Number(cost) * Math.pow(1 + growth, years)));
    const costNominal = BigInt(Math.round(Number(cost) * Math.pow(1 + growth + opts.cpi, years)));
    expectedByYear.forEach(
      (n, i) => (yearly[i]! += n * Number(cost) * Math.pow(1 + growth, i + 0.5))
    );
    views.push({
      asset: a,
      replacement,
      costReal,
      costNominal,
      perWeek: active ? Number(cost) / Math.max(0.1, a.life.meanYears) / 52 : 0,
      expectedCount,
      expectedByYear,
    });
  }
  const total = yearly.reduce((s, x) => s + x, 0);
  return {
    assets: views,
    sinkingFundPerWeek: total / (52 * H),
    horizonYears: H,
    expectedByYear: yearly,
  };
}
