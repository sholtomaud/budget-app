import type { Txn } from '../domain/types.ts';
import { tokens } from '../ingest/similarity.ts';

/**
 * Tokens that identify who the money went to or came from (§8 stage 3): the
 * merchant name when present, else the description. Store numbers, card
 * prefixes (SQ *), company suffixes and case are removed by `tokens`.
 */
export function merchantTokens(
  t: Pick<Txn, 'merchantName' | 'description' | 'billerName'>
): string[] {
  const src = t.merchantName || t.billerName || t.description;
  return tokens(src);
}

export function merchantKey(t: Pick<Txn, 'merchantName' | 'description' | 'billerName'>): string {
  return merchantTokens(t).join(' ');
}
