/**
 * A safe markdown subset for chat replies (ADR 0023): paragraphs, bullet and
 * numbered lists, headings, **bold**, *italic*, `code`. It parses to a tree;
 * the panel builds DOM nodes from it, so nothing in a reply is ever treated
 * as HTML.
 *
 * Run references (the ids `run_plan` returned) become numbered footnotes, so
 * "(run: `0abd…·seed 42·runs 0–499`)" repeated three times reads as [1].
 * A short trailing "not financial advice" note is dropped: the panel shows
 * that once.
 */

export type Inline =
  | { t: 'text'; s: string }
  | { t: 'b'; c: Inline[] }
  | { t: 'i'; c: Inline[] }
  | { t: 'code'; s: string }
  | { t: 'ref'; n: number };

export type Block =
  | { type: 'p'; inline: Inline[] }
  | { type: 'h'; inline: Inline[] }
  | { type: 'ul' | 'ol'; items: Inline[][] };

export interface Parsed {
  blocks: Block[];
  /** Run ids in footnote order (footnote n is runs[n - 1]). */
  runs: string[];
}

const REF = '\u0000';
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace run-id citations with numbered markers. */
function markRuns(text: string, runIds: readonly string[]): { text: string; runs: string[] } {
  const runs: string[] = [];
  let out = text;
  for (const id of runIds) {
    if (!id || runs.includes(id)) continue;
    const re = new RegExp(
      `[*_]*\\s*(?:run(?:\\s*id)?\\s*:?\\s*)?\`?${escapeRe(id)}\`?\\s*[*_]*`,
      'gi'
    );
    if (!re.test(out)) continue;
    runs.push(id);
    out = out.replace(re, `${REF}${runs.length}${REF}`);
  }
  // "(…[1]…)" with nothing else inside, and "*([1])*", become the bare marker.
  out = out.replace(/[*_]*\(\s*(\u0000\d+\u0000)\s*\)[*_]*/g, '$1');
  out = out.replace(/,\s*(\u0000\d+\u0000)/g, ' $1');
  return { text: out, runs };
}

function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', s: buf });
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\u0000(\d+)\u0000/))) {
      flush();
      out.push({ t: 'ref', n: Number(m[1]) });
      i += m[0].length;
    } else if ((m = rest.match(/^`([^`]+)`/))) {
      flush();
      out.push({ t: 'code', s: m[1]! });
      i += m[0].length;
    } else if ((m = rest.match(/^\*\*([^*]+?)\*\*/)) || (m = rest.match(/^__([^_]+?)__/))) {
      flush();
      out.push({ t: 'b', c: parseInline(m[1]!) });
      i += m[0].length;
    } else if (
      (m = rest.match(/^\*([^*\s][^*]*?)\*/)) ||
      (m = rest.match(/^_([^_\s][^_]*?)_(?!\w)/))
    ) {
      flush();
      out.push({ t: 'i', c: parseInline(m[1]!) });
      i += m[0].length;
    } else {
      buf += s[i];
      i++;
    }
  }
  flush();
  return out;
}

const isDisclaimer = (p: string) =>
  p.length < 220 && /financial advice/i.test(p) && /^[*_(\s]*(note|this is|these)/i.test(p);

export function parseMarkdown(text: string, runIds: readonly string[] = []): Parsed {
  const { text: marked, runs } = markRuns(text.replace(/\r\n/g, '\n'), runIds);
  const blocks: Block[] = [];
  // Line by line: consecutive list lines form a list, other lines a paragraph,
  // so a list straight after a sentence (no blank line) is still a list.
  let para: string[] = [];
  let list: { type: 'ul' | 'ol'; items: Inline[][] } | null = null;
  const endPara = () => {
    const joined = para.join(' ').trim();
    para = [];
    if (!joined || isDisclaimer(joined)) return;
    const h = /^#{1,4}\s+(.*)$/.exec(joined);
    blocks.push(
      h ? { type: 'h', inline: parseInline(h[1]!) } : { type: 'p', inline: parseInline(joined) }
    );
  };
  const endList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const line of marked.split('\n')) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      endPara();
      const type = bullet ? 'ul' : 'ol';
      if (list && list.type !== type) endList();
      list ??= { type, items: [] };
      list.items.push(parseInline(item[1]!));
    } else if (!line.trim()) {
      endPara();
      endList();
    } else {
      endList();
      if (/^#{1,4}\s/.test(line)) endPara();
      para.push(line.trim());
      if (/^#{1,4}\s/.test(line)) endPara();
    }
  }
  endPara();
  endList();
  // A reference used without its parentheses still needs its footnote.
  return { blocks, runs };
}

/** The plain text of a parsed reply (for typewriter length and tests). */
export function plainText(p: Parsed): string {
  const inl = (xs: Inline[]): string =>
    xs
      .map((x) => (x.t === 'text' || x.t === 'code' ? x.s : x.t === 'ref' ? `[${x.n}]` : inl(x.c)))
      .join('');
  return p.blocks
    .map((b) => ('items' in b ? b.items.map(inl).join('\n') : inl(b.inline)))
    .join('\n\n');
}
