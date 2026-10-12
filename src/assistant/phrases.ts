/**
 * Numbers to plain words for the chat panel (ADR 0023). Every figure is the
 * app's own (a simulation, a forecast, a check); these functions only choose
 * the words, so a person who knows budgeting arithmetic, not statistics, can
 * read the result. Frequencies ("9 in 10 futures") rather than probabilities.
 */

/** How often a plan works, as a frequency of simulated futures. */
export function chanceWords(p: number): string {
  if (p <= 0) return 'in none of the simulated futures';
  if (p >= 0.995) return 'in almost every simulated future';
  if (p < 0.05) return 'in fewer than 1 in 20 simulated futures';
  if (p > 0.95) return 'in more than 19 in 20 simulated futures';
  const tenths = Math.round(p * 10);
  return `in about ${Math.max(1, Math.min(9, tenths))} in 10 simulated futures`;
}

/** How the chance compares with the person's target. */
export function againstTarget(p: number, target: number): 'met' | 'close' | 'short' | 'far' {
  if (p >= target) return 'met';
  if (p >= target - 0.1) return 'close';
  if (p >= target / 2) return 'short';
  return 'far';
}

export const TARGET_WORDS: Record<ReturnType<typeof againstTarget>, string> = {
  met: 'That meets your target.',
  close: 'That is close to your target.',
  short: 'That is short of your target.',
  far: "That is well short of your target, so this plan doesn't work yet. That is a starting point, not a verdict.",
};

/** A dollar amount, rounded to what is worth saying: "$1.7 million", "$650,000", "$42". */
export function dollars(x: number): string {
  const a = Math.abs(x);
  const sign = x < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)} million`;
  if (a >= 1000) {
    const step = a >= 100_000 ? 10_000 : a >= 10_000 ? 1000 : 100;
    return `${sign}$${(Math.round(a / step) * step).toLocaleString('en-AU')}`;
  }
  return `${sign}$${Math.round(a)}`;
}

/** A share as a whole percentage, with a thin space ("15 %"). */
export const percent = (x: number) => `${Math.round(x * 100)} %`;

/** How a holdout coverage (nominal 80 %) reads. */
export function coverageWords(c: number): string {
  if (c > 0.92) return 'a little cautious: the ranges are wider than they need to be';
  if (c >= 0.7) return 'about right';
  return 'too narrow: treat the ranges with care';
}

/** Years, in words. */
export function years(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r} year${r === 1 ? '' : 's'}`;
}

/** Shortfall drivers' keys, as the person would say them. */
export const DRIVER_WORDS: Record<string, string> = {
  returns: 'investment returns',
  spending: 'how much you spend',
  capex: 'big purchases and replacements',
};

/**
 * Plain definitions of the terms the app shows. Keys are lower-case words
 * a person might ask about.
 */
export const GLOSSARY: { terms: string[]; text: string }[] = [
  {
    terms: ['p10', 'p90', 'p50', 'percentile', 'band', 'range'],
    text: '**P10 to P90** is the range the middle 80 % of outcomes fall in. P50 is the middle one. If the forecast says groceries next month are $600 to $900 (P10 to P90), then 1 month in 10 would come in under $600, and 1 in 10 over $900.',
  },
  {
    terms: ['chance of success', 'probability', 'psuccess', 'success'],
    text: '**Chance of success** is how many of the simulated futures work out: your money never drops below your floor and your spending is always covered. 9 in 10 means that in 9 of every 10 possible futures the app tried, the plan holds.',
  },
  {
    terms: ['freedom number'],
    text: "Your **freedom number** is how much you'd need invested to stop working for money. The simple version is a year of spending (before tax) divided by a withdrawal rate. The app also finds it by simulation: the smallest amount that works as often as your target.",
  },
  {
    terms: ['floor'],
    text: 'The **floor** is the least you want to keep invested, no matter what. A future where your money falls below it counts as not working.',
  },
  {
    terms: ['tier', 'tiers', 'secure', 'independent', 'luxury'],
    text: '**Tiers** are levels of spending from your budget: for example Secure (the essentials), Independent (your normal life) and Luxury (more of the extras). Your goal says which one you want to afford.',
  },
  {
    terms: ['capex', 'big purchase', 'big purchases', 'replacement'],
    text: '**Big purchases** (CAPEX) are things you buy now and then and replace: a car, a laptop, a roof. The app estimates when each is due and how much to put aside for it.',
  },
  {
    terms: ['run', 'simulation', 'monte carlo', 'future', 'futures'],
    text: 'A **simulation run** tries your plan in hundreds of possible futures, each with its own investment returns, spending and replacement costs. The run reference tells you exactly which inputs and seed produced a figure, so it can be checked and repeated.',
  },
  {
    terms: ['real', "today's dollars", 'inflation', 'cpi'],
    text: "**Today's dollars** means amounts are adjusted for inflation, so $100 in 2040 means what $100 buys today. The app plans in today's dollars, so you can compare like with like.",
  },
  {
    terms: ['withdrawal', 'withdrawal rate', 'guardrails'],
    text: 'The **withdrawal strategy** is how much you take out of your investments each year after you stop working: a fixed amount, a fixed percentage, or guardrails that spend a little less after bad years.',
  },
];
