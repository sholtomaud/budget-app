import { DEFAULT_PERIODS, type PeriodTable } from './periods.ts';
import {
  DEFAULT_SETTINGS,
  DEFAULT_TIERS,
  type BudgetLine,
  type BudgetSettings,
  type Tier,
} from './model.ts';
import type { SheetType } from './workbook.ts';

export interface WorkbookImport {
  file: string;
  type: SheetType;
  at: string;
  lines: number;
  assets: number;
  issues: number;
}

/** Everything the Budget and CAPEX screens own, persisted as one record. */
export interface BudgetState {
  lines: BudgetLine[];
  tiers: Tier[];
  periods: PeriodTable;
  settings: BudgetSettings;
  /** Goal sheet values, kept for the Freedom screen (M5), with their source rows. */
  goal: Record<string, { value: string; file: string; row: number }>;
  imports: WorkbookImport[];
}

export function emptyBudget(): BudgetState {
  return {
    lines: [],
    tiers: structuredClone(DEFAULT_TIERS),
    periods: structuredClone(DEFAULT_PERIODS),
    settings: { ...DEFAULT_SETTINGS },
    goal: {},
    imports: [],
  };
}
