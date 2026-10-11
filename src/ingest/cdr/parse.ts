/**
 * Recognise and validate one CDR Banking API response file (FR-ING-001/002).
 * A file is rejected on its own, with a message naming the first failing path.
 */
import accountsSchema from '../../../schemas/cdr/accounts.schema.json' with { type: 'json' };
import balancesSchema from '../../../schemas/cdr/balances.schema.json' with { type: 'json' };
import transactionsSchema from '../../../schemas/cdr/transactions.schema.json' with { type: 'json' };
import { formatError, validate, type Schema } from '../../lib/jsonschema.ts';

export type CdrKind = 'accounts' | 'balances' | 'transactions';

export interface CdrAccount {
  accountId: string;
  displayName: string;
  nickname?: string;
  productCategory: string;
  productName: string;
  maskedNumber: string;
  [k: string]: unknown;
}

export interface CdrBalance {
  accountId: string;
  currentBalance: string;
  availableBalance: string;
  creditLimit?: string;
  currency?: string;
  [k: string]: unknown;
}

export interface CdrTransaction {
  accountId: string;
  transactionId?: string;
  isDetailAvailable: boolean;
  type: string;
  status: 'PENDING' | 'POSTED';
  description: string;
  postingDateTime?: string;
  valueDateTime?: string;
  executionDateTime?: string;
  amount: string;
  currency?: string;
  reference: string;
  merchantName?: string;
  merchantCategoryCode?: string;
  billerCode?: string;
  billerName?: string;
  [k: string]: unknown;
}

export type CdrPayload =
  | { kind: 'accounts'; items: CdrAccount[]; synthetic: boolean }
  | { kind: 'balances'; items: CdrBalance[]; asAt?: string; synthetic: boolean }
  | { kind: 'transactions'; items: CdrTransaction[]; synthetic: boolean };

export type ParseResult =
  | { ok: true; payload: CdrPayload }
  | { ok: false; kind: CdrKind | 'unknown'; skipped: boolean; message: string };

const SCHEMAS: Record<CdrKind, Schema> = {
  accounts: accountsSchema as Schema,
  balances: balancesSchema as Schema,
  transactions: transactionsSchema as Schema,
};

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function detectKind(doc: unknown): CdrKind | null {
  const data = (doc as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== 'object') return null;
  if (Array.isArray(data.transactions)) return 'transactions';
  if (Array.isArray(data.balances)) return 'balances';
  if (Array.isArray(data.accounts)) return 'accounts';
  return null;
}

export function parseCdrText(text: string): ParseResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      kind: 'unknown',
      skipped: false,
      message: `Not valid JSON: ${(e as Error).message}`,
    };
  }
  return parseCdrDocument(doc);
}

export function parseCdrDocument(doc: unknown): ParseResult {
  const kind = detectKind(doc);
  if (!kind) {
    return {
      ok: false,
      kind: 'unknown',
      skipped: true,
      message: 'Not a CDR banking response (no data.accounts, data.balances or data.transactions)',
    };
  }
  const err = validate(SCHEMAS[kind], doc);
  if (err) return { ok: false, kind, skipped: false, message: formatError(err) };
  const d = doc as Record<string, unknown> & { data: Record<string, unknown[]> };
  const synthetic = 'x-synthetic' in d;
  switch (kind) {
    case 'accounts':
      return { ok: true, payload: { kind, items: d.data.accounts as CdrAccount[], synthetic } };
    case 'transactions':
      return {
        ok: true,
        payload: { kind, items: d.data.transactions as CdrTransaction[], synthetic },
      };
    case 'balances': {
      // CDR balances carry no observation time; budget-app reads an optional
      // top-level "x-as-at" (ADR 0008), else the caller supplies the file time.
      const asAt = d['x-as-at'];
      if (asAt !== undefined && (typeof asAt !== 'string' || !DATE_TIME.test(asAt))) {
        return {
          ok: false,
          kind,
          skipped: false,
          message: '$["x-as-at"] must be an ISO 8601 date-time with offset',
        };
      }
      return {
        ok: true,
        payload: {
          kind,
          items: d.data.balances as CdrBalance[],
          ...(asAt ? { asAt } : {}),
          synthetic,
        },
      };
    }
  }
}
