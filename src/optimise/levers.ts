/**
 * Decision levers the optimiser may move (SPEC §11.3, §11.4), in natural
 * units: years to shift freedom's start, multipliers on spending, project
 * income in dollars a year. The user unlocks each and sets its bounds.
 */
import { addMonths } from '../lib/dates.ts';
import { NO_LEVERS, type FreedomSetup } from '../sim/inputs.ts';

export type LeverId = 'start' | 'tierSpend' | 'currentSpend' | 'projectIncome';

export interface LeverSpec {
  id: LeverId;
  lo: number;
  hi: number;
}

export const LEVERS: Record<
  LeverId,
  { label: string; unit: string; lo: number; hi: number; step: number }
> = {
  start: { label: 'Freedom starts (years later)', unit: 'years', lo: -3, hi: 10, step: 0.5 },
  tierSpend: { label: 'Spending after freedom (× tier)', unit: '×', lo: 0.7, hi: 1.1, step: 0.05 },
  currentSpend: { label: 'Spending now (× today)', unit: '×', lo: 0.7, hi: 1, step: 0.05 },
  projectIncome: { label: 'Project income ($ a year)', unit: '$', lo: 0, hi: 40_000, step: 1_000 },
};

export type LeverValues = Record<LeverId, number>;

/** The setup's own position on every lever (start is an offset, so 0). */
export function baseValues(setup: FreedomSetup): LeverValues {
  const l = setup.levers ?? NO_LEVERS;
  return {
    start: 0,
    tierSpend: l.tierSpend,
    currentSpend: l.currentSpend,
    projectIncome: Number(setup.goal.projectIncome ?? 0n) / 100,
  };
}

/** A copy of the setup moved to `values`. Start shifts by whole months. */
export function applyLevers(setup: FreedomSetup, values: Partial<LeverValues>): FreedomSetup {
  const months = Math.round((values.start ?? 0) * 12);
  const base = setup.levers ?? NO_LEVERS;
  const start = months ? addMonths(`${setup.goal.start.slice(0, 7)}-01`, months) : setup.goal.start;
  const shift = (d: string | undefined) =>
    d && months ? addMonths(`${d.slice(0, 7)}-01`, months) : d;
  return {
    ...setup,
    goal: {
      ...setup.goal,
      start,
      projectIncome:
        values.projectIncome === undefined
          ? setup.goal.projectIncome
          : BigInt(Math.round(values.projectIncome * 100)),
    },
    // Paid work moves with freedom's start.
    decisions: { ...setup.decisions, workUntil: shift(setup.decisions.workUntil) },
    levers: {
      tierSpend: values.tierSpend ?? base.tierSpend,
      currentSpend: values.currentSpend ?? base.currentSpend,
    },
  };
}
