import { displayMoney } from '../lib/money.ts';

export const money = (minor: bigint, ccy = 'AUD') => displayMoney(minor, ccy);

const dateFmt = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** '2025-03-14' → '14 Mar 2025'. */
export function day(iso: string): string {
  return dateFmt.format(new Date(`${iso}T00:00:00Z`));
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

export const count = (n: number) => n.toLocaleString('en-AU');

/** Build an element with text content and attributes. Never parses HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

/** A provenance label (NFR-HON-001). */
export function prov(p: string): HTMLSpanElement {
  const s = el('span', { class: 'prov', 'data-prov': p }, p);
  return s;
}
