import type { Account, BalanceCheckpoint, ImportRecord, Txn } from '../domain/types.ts';
import type { AccountReconciliation } from './ledger.ts';

/** What the UI reads: plain arrays, structured-cloneable across the worker boundary. */
export interface LedgerView {
  timezone: string;
  accounts: Account[];
  txns: Txn[];
  balances: BalanceCheckpoint[];
  reconciliation: AccountReconciliation[];
  imports: ImportRecord[];
}
