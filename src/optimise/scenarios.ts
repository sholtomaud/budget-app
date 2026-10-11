/**
 * Saved scenarios and their side-by-side comparison (SPEC §11.4, §12
 * Scenarios): what each one decides, as display rows, so the screen can show
 * the decisions next to each other and mark where they differ.
 */
import type { FreedomSetup } from '../sim/inputs.ts';

export const MAX_COMPARE = 4;

export interface SavedScenario {
  id: string;
  name: string;
  createdAt: string;
  source: 'freedom' | 'optimiser' | 'advisor';
  setup: FreedomSetup;
  /** For optimiser results: the simulation it came from. */
  runId?: string;
}

const money = (minor: bigint | undefined) =>
  `$${Math.round(Number(minor ?? 0n) / 100).toLocaleString('en-AU')}`;
const pct = (x: number) => `${Math.round(x * 100)} %`;

function strategy(s: FreedomSetup): string {
  const w = s.decisions.withdrawal;
  switch (w.kind) {
    case 'fixed-real':
      return 'Fixed real';
    case 'percent':
      return `Percent, ${(w.rate * 100).toFixed(1)} %`;
    case 'guardrails':
      return `Guardrails, ${((w.initialRate ?? 0.04) * 100).toFixed(1)} % ± ${pct(w.band)}`;
    case 'skim':
      return `Skim above ${(w.threshold * 100).toFixed(1)} %`;
    case 'hold':
      return `Hold ${w.holdingIds.length} holding${w.holdingIds.length === 1 ? '' : 's'}`;
  }
}

/** The decisions of each setup as rows of display strings: [label, value per setup]. */
export function decisionRows(setups: readonly FreedomSetup[]): [string, string[]][] {
  const row = (label: string, f: (s: FreedomSetup) => string): [string, string[]] => [
    label,
    setups.map(f),
  ];
  return [
    row('Tier', (s) => s.goal.tier),
    row('Freedom starts', (s) => s.goal.start.slice(0, 7)),
    row('Years of freedom', (s) => String(s.goal.horizonYears)),
    row('Floor', (s) => money(s.goal.floor)),
    row('Target', (s) => pct(s.goal.targetProbability)),
    row('Spending after freedom', (s) => pct(s.levers?.tierSpend ?? 1) + ' of tier'),
    row('Spending now', (s) => pct(s.levers?.currentSpend ?? 1) + ' of today'),
    row('Project income', (s) => money(s.goal.projectIncome) + ' a year'),
    row('Take-home pay', (s) => money(s.decisions.netPayMonthly) + ' a month'),
    row('Paid work until', (s) => s.decisions.workUntil?.slice(0, 7) ?? 'freedom starts'),
    row('Withdrawals', strategy),
    row('Holdings', (s) =>
      money(s.holdings.reduce((a, h) => a + h.value, 0n) + s.decisions.bankBuffer)
    ),
    row('Tax', (s) => s.taxTable ?? 'off'),
    row('Seed', (s) => s.seed),
  ];
}

/** Indices of rows whose values are not all the same. */
export function differingRows(rows: [string, string[]][]): Set<number> {
  return new Set(rows.flatMap(([, vs], i) => (vs.some((v) => v !== vs[0]) ? [i] : [])));
}
