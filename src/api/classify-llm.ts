/**
 * LLM category suggestions (§8 stage 6, §13.2). The payload carries, per
 * transaction, only a reference number, the normalised merchant, the
 * redacted description, an amount range and whether money went in or out.
 * The answer must pick from the app's own category ids (or null), enforced
 * by structured outputs and re-validated locally. Suggestions never
 * override the user's own labels (FR-CLS-004).
 */
import type { Category } from '../classify/categories.ts';
import type { Schema } from '../lib/jsonschema.ts';
import { bucketAmount, redactText } from './redact.ts';

export interface Candidate {
  key: string;
  merchant: string;
  description: string;
  amount: number;
}

export interface ClassifyPrompt {
  system: string;
  user: string;
  schema: Schema;
  /** ref → txn key; refs are 1-based positions, never IDs. */
  refs: Map<number, string>;
  payloadItems: {
    ref: number;
    merchant: string;
    description: string;
    amount: string;
    direction: string;
  }[];
}

export function classifyPrompt(
  items: readonly Candidate[],
  categories: readonly Category[]
): ClassifyPrompt {
  const ids = categories.map((c) => c.id).filter((id) => id !== 'uncategorised');
  const refs = new Map<number, string>();
  const payloadItems = items.map((t, i) => {
    refs.set(i + 1, t.key);
    return {
      ref: i + 1,
      merchant: redactText(t.merchant),
      description: redactText(t.description),
      amount: bucketAmount(t.amount),
      direction: t.amount < 0 ? 'money out' : 'money in',
    };
  });
  const schema: Schema = {
    type: 'object',
    additionalProperties: false,
    required: ['labels'],
    properties: {
      labels: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['ref', 'categoryId'],
          properties: {
            ref: { type: 'integer' },
            categoryId: { anyOf: [{ type: 'string', enum: ids }, { type: 'null' }] },
          },
        },
      },
    },
  };
  const catalogue = categories
    .filter((c) => c.id !== 'uncategorised')
    .map((c) => `${c.id}: ${c.name}`)
    .join('\n');
  return {
    refs,
    payloadItems,
    schema,
    system:
      "You categorise an Australian household's bank transactions. Choose the single best category id from the list for each item, or null if you can't tell. Never invent a category. Answer only with the requested JSON.",
    user: `Categories:\n${catalogue}\n\nTransactions:\n${JSON.stringify(payloadItems, null, 1)}`,
  };
}

/** Map the answer's refs back to transaction keys, dropping nulls and unknown refs. */
export function labelsFromAnswer(
  p: ClassifyPrompt,
  answer: { labels: { ref: number; categoryId: string | null }[] }
): { key: string; categoryId: string }[] {
  return answer.labels.flatMap((l) => {
    const key = p.refs.get(l.ref);
    return key && l.categoryId ? [{ key, categoryId: l.categoryId }] : [];
  });
}
