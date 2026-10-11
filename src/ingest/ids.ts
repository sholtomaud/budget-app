import { sha256Hex } from '../lib/hash.ts';

/**
 * The stable id for a CDR transaction without a transactionId (FR-ING-004):
 * a hash of (accountId, postingDateTime or executionDateTime, amount, description).
 */
export async function syntheticTxnId(fields: {
  accountId: string;
  postingDateTime?: string;
  executionDateTime?: string;
  amount: string;
  description: string;
}): Promise<string> {
  const when = fields.postingDateTime ?? fields.executionDateTime ?? '';
  const key = [fields.accountId, when, fields.amount, fields.description].join('\u001f');
  return `H-${(await sha256Hex(key)).slice(0, 32)}`;
}

/** Account and transaction id together: transaction ids are only unique within an account. */
export function txnKey(accountId: string, id: string): string {
  return `${accountId}\u001f${id}`;
}
