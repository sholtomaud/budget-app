/**
 * Redaction for anything sent to an external provider (FR-API-003). By
 * default a payload carries no account IDs, masked or full account
 * numbers, BSBs, emails, phone numbers or exact amounts: amounts are
 * bucketed. The consent dialog shows the result before anything is sent.
 */

const BUCKETS = [0, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000];

/** A dollar amount as a range: 63.85 → "$50–100"; over $50k → "over $50,000". */
export function bucketAmount(dollars: number): string {
  const a = Math.abs(dollars);
  const fmt = (n: number) => `$${n.toLocaleString('en-AU')}`;
  for (let i = 1; i < BUCKETS.length; i++)
    if (a < BUCKETS[i]!) return `${fmt(BUCKETS[i - 1]!)}–${fmt(BUCKETS[i]!).slice(1)}`;
  return `over ${fmt(BUCKETS.at(-1)!)}`;
}

/** Round to two significant figures for aggregate figures: 653 412 → "~$650,000". */
export function roughAmount(dollars: number): string {
  if (dollars === 0) return '$0';
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.abs(dollars))) - 1));
  const r = Math.round(dollars / mag) * mag;
  return `~${r < 0 ? '−' : ''}$${Math.abs(r).toLocaleString('en-AU')}`;
}

const PATTERNS: [RegExp, string][] = [
  [/\bSYN-[A-Z0-9-]+\b/g, '[account]'],
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]'],
  // A BSB and the account number after it go together.
  [/\b\d{3}[- ]?\d{3}[\s-]*\d{4,}\b/g, '[bsb account]'],
  [/(?:x{2,}|\*{2,})\s?\d{2,4}\b/gi, '[card]'],
  [/\+?\d[\d ()-]{7,}\d/g, '[number]'],
  [/\b\d{6,}\b/g, '[number]'],
];

/** Remove identifiers from free text (descriptions, references). */
export function redactText(s: string): string {
  let out = s;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out.replace(/\s+/g, ' ').trim();
}

/** Keys that must never appear in a payload (checked by the privacy tests). */
export const FORBIDDEN_KEYS = [
  'accountId',
  'maskedNumber',
  'bsb',
  'accountNumber',
  'transactionId',
];
