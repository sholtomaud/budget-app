/** Description similarity for matching PENDING to POSTED records (FR-ING-005). */

const STOP = new Set([
  'AU',
  'AUS',
  'PTY',
  'LTD',
  'SQ',
  'THE',
  'NSW',
  'VIC',
  'QLD',
  'CARD',
  'VISA',
  'EFTPOS',
]);

/** Upper-case word tokens without store numbers, punctuation, or stop words. */
export function tokens(s: string): string[] {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !/^\d+$/.test(t) && !STOP.has(t));
}

/** Normalised merchant text: tokens joined by spaces (store numbers, suburbs-as-suffix kept). */
export function normaliseMerchant(s: string): string {
  return tokens(s).join(' ');
}

/**
 * Dice coefficient over tokens, where a truncated token matches its full form
 * ("HI" ~ "HILLS"), since banks truncate pending descriptions.
 */
export function descriptionSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0)
    return a.trim().toUpperCase() === b.trim().toUpperCase() ? 1 : 0;
  const used = new Set<number>();
  let matches = 0;
  for (const x of ta) {
    const j = tb.findIndex(
      (y, k) =>
        !used.has(k) &&
        (x === y || (Math.min(x.length, y.length) >= 2 && (x.startsWith(y) || y.startsWith(x))))
    );
    if (j >= 0) {
      used.add(j);
      matches++;
    }
  }
  return (2 * matches) / (ta.length + tb.length);
}
