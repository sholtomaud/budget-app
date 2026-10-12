/**
 * Plan checks (ADR 0026): settings that make a plan fail for reasons the
 * person probably didn't intend, found before (and alongside) the
 * simulation. Each check says what it found in plain words and, where there
 * is an obvious correction, offers it as a changed setup to apply.
 *
 * Checks never recommend a product or an investment (NFR-MISSION-001): what
 * savings are held in is the person's decision; the app only points out what
 * its own assumptions mean.
 */
import type { FreedomSetup } from './inputs.ts';
import { DEFAULT_MODEL_FOR, type SpendingInput } from './model.ts';
import { monthsBetween } from './modelgen.ts';

export type CheckId = 'no-pay' | 'pay-gap' | 'idle-bank' | 'all-cash' | 'over-spending' | 'credits';

export interface PlanCheck {
  id: CheckId;
  /** A problem makes the plan fail in a way the person likely didn't mean; a note is worth knowing. */
  level: 'problem' | 'note';
  /** Plain words, no markdown. */
  text: string;
  /** The obvious correction, as a changed setup. */
  fix?: { label: string; summary: string; setup: FreedomSetup };
}

const dollars = (minor: bigint) => Number(minor) / 100;
const aud = (n: number) =>
  n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const when = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const span = (months: number) => {
  const y = Math.round(months / 12);
  return y >= 1 ? `${y} year${y === 1 ? '' : 's'}` : `${months} month${months === 1 ? '' : 's'}`;
};
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const CASH_LIKE = new Set(['cash', 'term_deposit']);
/** Months of spending a bank buffer is meant to hold. */
const BUFFER_MONTHS = 6;

/**
 * Check a setup. `spending` is the need with the setup's levers applied;
 * `asOf` is the simulation's first month ('YYYY-MM').
 */
export function checkPlan(setup: FreedomSetup, spending: SpendingInput, asOf: string): PlanCheck[] {
  const out: PlanCheck[] = [];
  const start = setup.goal.start;
  const toStart = monthsBetween(asOf, start);
  const pay = setup.decisions.netPayMonthly;
  const now = sum(spending.current);
  const workUntil = setup.decisions.workUntil;

  // 1. Nothing coming in before freedom: the years until then are paid from savings.
  if (pay !== undefined && pay <= 0n && toStart >= 6) {
    out.push({
      id: 'no-pay',
      level: 'problem',
      text: `No pay comes in before freedom starts in ${when(start)}, so the ${span(toStart)} until then are paid from your savings, and starting later makes that worse. If you've already stopped working, your freedom starts now.`,
      fix: {
        label: 'Start freedom now',
        summary: `freedom starts ${when(`${asOf}-01`)}, not ${when(start)}`,
        setup: {
          ...setup,
          goal: { ...setup.goal, start: `${asOf}-01` },
          decisions: { ...setup.decisions, workUntil: undefined },
        },
      },
    });
  } else if (pay !== undefined && pay > 0n && workUntil) {
    // 2. Paid work ends well before freedom starts.
    const gap = monthsBetween(workUntil.slice(0, 7), start.slice(0, 7));
    if (gap >= 6)
      out.push({
        id: 'pay-gap',
        level: 'problem',
        text: `Paid work ends in ${when(workUntil)}, ${span(gap)} before freedom starts in ${when(start)}. Those years have no pay, so they're paid from your savings.`,
        fix: {
          label: 'Work until freedom starts',
          summary: `paid work continues until ${when(start)}`,
          setup: { ...setup, decisions: { ...setup.decisions, workUntil: undefined } },
        },
      });
  }

  // 3. A large "cash kept in the bank": the plan treats it as an everyday buffer that earns nothing.
  const bank = dollars(setup.decisions.bankBuffer);
  const buffer = Math.max(1000, Math.ceil((BUFFER_MONTHS * now) / 1000) * 1000);
  if (bank > Math.max(2 * buffer, 20_000)) {
    const moved = bank - buffer;
    const holdings = [...setup.holdings];
    const i = holdings.findIndex((h) => h.assetClass === 'cash');
    if (i >= 0)
      holdings[i] = {
        ...holdings[i]!,
        value: holdings[i]!.value + BigInt(Math.round(moved * 100)),
      };
    else
      holdings.push({
        id: 'savings',
        name: 'Savings',
        assetClass: 'cash',
        value: BigInt(Math.round(moved * 100)),
        returnModelId: DEFAULT_MODEL_FOR.cash,
        owner: 'p1',
        provenance: 'assumed',
      });
    out.push({
      id: 'idle-bank',
      level: 'problem',
      text: `${aud(bank)} is in "Cash kept in the bank". The plan treats that as an everyday buffer, and it earns nothing. About ${BUFFER_MONTHS} months of spending (${aud(buffer)}) is plenty there; the rest belongs under What you own, where it earns what its return model says.`,
      fix: {
        label: `Keep ${aud(buffer)} in the bank, move the rest to savings`,
        summary: `${aud(moved)} moved from the bank buffer to a savings holding`,
        setup: {
          ...setup,
          holdings,
          decisions: { ...setup.decisions, bankBuffer: BigInt(Math.round(buffer * 100)) },
        },
      },
    });
  }

  // 4. Everything in cash over a long horizon (a note: what to hold is the person's call).
  const held = setup.holdings.reduce((a, h) => a + dollars(h.value), 0) + bank;
  const cash =
    setup.holdings
      .filter((h) => CASH_LIKE.has(h.assetClass))
      .reduce((a, h) => a + dollars(h.value), 0) + bank;
  const horizon = Math.max(0, toStart) / 12 + setup.goal.horizonYears;
  if (held > 0 && cash / held >= 0.9 && horizon >= 15)
    out.push({
      id: 'all-cash',
      level: 'note',
      text: `All of your savings are in cash, which the plan assumes earns about 0.5 % a year after inflation. Over ${Math.round(horizon)} years, what savings are held in can matter as much as how much is saved. The return models under What you own are assumptions you can change; a licensed adviser can help with what suits you.`,
    });

  // 5. Spending more than take-home pay while working.
  if (pay !== undefined && pay > 0n && toStart > 0 && now > dollars(pay) * 1.02)
    out.push({
      id: 'over-spending',
      level: 'problem',
      text: `You spend about ${aud(now)} a month and take home about ${aud(dollars(pay))}, so savings shrink every month until freedom. If some of that "spending" is transfers to savings or card repayments, recategorising it on the Transactions screen will correct this.`,
    });

  // 6. Spending groups that took in more than they spent (ADR 0025).
  const g = spending.credits;
  if (g?.length) {
    const names = g.map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(', ');
    out.push({
      id: 'credits',
      level: 'note',
      text: `${names}: more money came in than went out over the last 12 months, so ${g.length > 1 ? 'these count' : 'this counts'} as no spending. Pay or a transfer may be filed under a spending category; check Transactions.`,
    });
  }
  return out;
}
