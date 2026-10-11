import type { Txn } from '../domain/types.ts';
import { merchantKey } from './normalise.ts';

/** A user rule (§8 stage 2). All present conditions must hold. Rule hits have confidence 1. */
export interface Rule {
  id: string;
  name: string;
  categoryId: string;
  match: {
    /** Normalised merchant text contains this (case-insensitive). */
    merchant?: string;
    /** Regular expression over the raw description, case-insensitive. */
    description?: string;
    billerCode?: string;
    mcc?: string;
    accountId?: string;
    /** Amount range in minor units, applied to the absolute amount. */
    minAbs?: string;
    maxAbs?: string;
    direction?: 'debit' | 'credit';
  };
}

export function ruleMatches(rule: Rule, t: Txn): boolean {
  const m = rule.match;
  if (m.merchant && !merchantKey(t).includes(m.merchant.toUpperCase())) return false;
  if (m.description) {
    let re: RegExp;
    try {
      re = new RegExp(m.description, 'i');
    } catch {
      return false;
    }
    if (!re.test(t.description)) return false;
  }
  if (m.billerCode && t.billerCode !== m.billerCode) return false;
  if (m.mcc && t.mcc !== m.mcc) return false;
  if (m.accountId && t.accountId !== m.accountId) return false;
  const abs = t.amount < 0n ? -t.amount : t.amount;
  if (m.minAbs !== undefined && abs < BigInt(m.minAbs)) return false;
  if (m.maxAbs !== undefined && abs > BigInt(m.maxAbs)) return false;
  if (m.direction === 'debit' && t.amount >= 0n) return false;
  if (m.direction === 'credit' && t.amount <= 0n) return false;
  return Object.keys(m).length > 0;
}

/** Ordered: the first matching rule wins. */
export function firstRule(rules: readonly Rule[], t: Txn): Rule | undefined {
  return rules.find((r) => ruleMatches(r, t));
}
