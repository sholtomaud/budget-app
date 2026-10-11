#!/usr/bin/env node
/**
 * Data-hygiene gate (SPEC §16.4, NFR-PRIV-002). Fails when a committed file
 * looks like real financial data. Runs in CI over every tracked file and as a
 * pre-commit hook over staged files (`--staged`).
 *
 *   node scripts/data-hygiene.ts            # all tracked files
 *   node scripts/data-hygiene.ts --staged   # staged files only
 *   node scripts/data-hygiene.ts a.json b   # named files
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Files that must never be committed anywhere (real exports, backups). */
const FORBIDDEN_EXT = /\.(budgetapp|ofx|qfx|qif|xlsx|xls|xlsm)$/i;
const FORBIDDEN_DIR = /^(data|private)\//;
const SKIP_BINARY = /\.(wasm|png|jpe?g|gif|ico|woff2?|zip|gz)$/i;
/** The marker every fixture carries (SPEC §7.1). */
const SYNTHETIC_MARKER = 'x-synthetic';

/** CDR-shaped account IDs must be synthetic (`SYN-…`). */
const ACCOUNT_ID = /"accountId"\s*:\s*"([^"]*)"/g;
/** BSB (ddd-ddd) followed by an account number of 5–10 digits. */
const BSB_ACCOUNT =
  /\b\d{3}-\d{3}[\s,;:/|-]+(?:acc(?:ount)?\.?\s*(?:no\.?|number)?\s*:?\s*)?\d{5,10}\b/gi;
/** Formatted Australian TFN candidates: ddd ddd ddd or ddd-ddd-ddd, or "TFN" + 8–9 digits. */
const TFN_FORMATTED = /\b(\d{3})([ -])(\d{3})\2(\d{3})\b/g;
const TFN_LABELLED = /\bTFN\b\D{0,12}(\d[\d -]{6,11}\d)/gi;

/** ATO TFN check digit: weighted sum mod 11 == 0. */
export function isValidTfn(digits: string): boolean {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 9 && d.length !== 8) return false;
  const weights = d.length === 9 ? [1, 4, 3, 7, 5, 8, 6, 9, 10] : [10, 7, 8, 4, 6, 3, 5, 1];
  const sum = [...d].reduce((acc, c, i) => acc + Number(c) * (weights[i] ?? 0), 0);
  return sum % 11 === 0;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** Problems with one file's path and content. Pure, for tests. */
export function scanFile(path: string, text: string | null): string[] {
  const problems: string[] = [];
  const p = path.replace(/\\/g, '/');
  if (FORBIDDEN_EXT.test(p)) problems.push(`${p}: file type is never committed (real-data format)`);
  if (FORBIDDEN_DIR.test(p))
    problems.push(`${p}: ${p.split('/')[0]}/ is local-only and git-ignored`);
  if (text === null) return problems;

  if (p.startsWith('fixtures/') && /\.(json|csv)$/i.test(p)) {
    const marked = p.endsWith('.json')
      ? hasJsonMarker(text)
      : /^#\s*x-synthetic\b/.test(text.split('\n', 1)[0] ?? '');
    if (!marked) {
      problems.push(
        p.endsWith('.json')
          ? `${p}: fixture lacks a top-level "${SYNTHETIC_MARKER}" key`
          : `${p}: fixture CSV must start with a "# x-synthetic: …" line`
      );
    }
  }

  for (const m of text.matchAll(ACCOUNT_ID)) {
    const id = m[1] ?? '';
    if (!id.startsWith('SYN-')) {
      problems.push(
        `${p}:${lineOf(text, m.index)}: accountId "${id}" is not synthetic (must start SYN-)`
      );
    }
  }
  for (const m of text.matchAll(BSB_ACCOUNT)) {
    problems.push(`${p}:${lineOf(text, m.index)}: looks like a BSB and account number`);
  }
  const tfnHits = new Set<number>();
  for (const m of text.matchAll(TFN_FORMATTED)) {
    if (isValidTfn(m[0])) tfnHits.add(m.index);
  }
  for (const m of text.matchAll(TFN_LABELLED)) {
    if (isValidTfn(m[1] ?? '')) tfnHits.add(m.index);
  }
  for (const i of tfnHits) problems.push(`${p}:${lineOf(text, i)}: looks like an Australian TFN`);
  return problems;
}

function hasJsonMarker(text: string): boolean {
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) && SYNTHETIC_MARKER in v;
  } catch {
    return false;
  }
}

function git(args: string[]): string[] {
  return execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
}

function main(argv: string[]): void {
  const staged = argv.includes('--staged');
  const named = argv.filter((a) => !a.startsWith('--'));
  const files = named.length
    ? named
    : staged
      ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
      : git(['ls-files', '-z']);

  const problems: string[] = [];
  for (const f of files) {
    if (!existsSync(f)) continue;
    const text = SKIP_BINARY.test(f) ? null : readFileSync(f, 'utf8');
    problems.push(...scanFile(f, text));
  }
  if (problems.length) {
    console.error('Data-hygiene gate failed (SPEC §16.4):\n');
    for (const p of problems) console.error(`  ✖ ${p}`);
    console.error(
      '\nReal financial data must never be committed. Use synthetic fixtures (SPEC §7).'
    );
    process.exit(1);
  }
  console.log(`Data-hygiene gate: ${files.length} file(s) clean.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
