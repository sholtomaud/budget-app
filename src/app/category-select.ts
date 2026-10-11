import type { Category } from '../classify/categories.ts';
import { categoryName } from '../classify/categories.ts';

export const KINDS = [
  'income',
  'opex',
  'capex',
  'transfer',
  'investment',
  'tax',
  'fee',
  'interest',
  'refund',
];

/** A <select> of categories grouped by kind. */
export function categorySelect(
  categories: readonly Category[],
  selected?: string,
  extra: [string, string][] = []
): HTMLSelectElement {
  const s = document.createElement('select');
  for (const [v, label] of extra) s.append(new Option(label, v));
  const groups = new Map<string, Category[]>();
  for (const c of categories) groups.set(c.kind, [...(groups.get(c.kind) ?? []), c]);
  for (const kind of KINDS) {
    const cs = groups.get(kind);
    if (!cs?.length) continue;
    const g = document.createElement('optgroup');
    g.label = kind;
    for (const c of [...cs].sort((a, b) => a.name.localeCompare(b.name)))
      g.append(new Option(c.name, c.id));
    s.append(g);
  }
  if (selected && ![...s.options].some((o) => o.value === selected)) {
    s.prepend(new Option(categoryName(selected, categories), selected));
  }
  if (selected) s.value = selected;
  return s;
}
