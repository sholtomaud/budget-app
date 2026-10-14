import table from '../../data-tables/categories.json' with { type: 'json' };
import type { ClassificationKind } from '../domain/types.ts';

export interface Category {
  id: string;
  name: string;
  kind: ClassificationKind;
  custom?: boolean;
  /** COICOP 2018 division or group (ADR 0034), for consumption categories. */
  coicop?: string;
}

const PREFIX_KIND: Record<string, ClassificationKind> = {
  income: 'income',
  capex: 'capex',
  investment: 'investment',
  transfer: 'transfer',
  fees: 'fee',
  tax: 'tax',
};

/** The kind a category implies: by explicit kind, else its first segment, else opex. */
export function kindOfCategory(id: string, categories?: readonly Category[]): ClassificationKind {
  const c = categories?.find((x) => x.id === id);
  if (c) return c.kind;
  const def = (table.categories as { id: string; kind?: string }[]).find((x) => x.id === id);
  if (def?.kind) return def.kind as ClassificationKind;
  return PREFIX_KIND[id.split('.')[0] ?? ''] ?? 'opex';
}

export function defaultCategories(): Category[] {
  return (table.categories as { id: string; name: string; kind?: string; coicop?: string }[]).map(
    (c) => ({
      id: c.id,
      name: c.name,
      kind: (c.kind as ClassificationKind | undefined) ?? kindOfCategory(c.id),
      ...(c.coicop ? { coicop: c.coicop } : {}),
    })
  );
}

/** A readable name for a category id that may not be in the list (e.g. from a persona). */
export function categoryName(id: string, categories: readonly Category[]): string {
  const c = categories.find((x) => x.id === id);
  if (c) return c.name;
  const last = id.split('.').pop() ?? id;
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, ' ');
}

export const UNCATEGORISED = 'uncategorised';
