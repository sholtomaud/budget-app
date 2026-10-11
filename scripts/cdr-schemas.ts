/**
 * Derive the JSON Schemas the importer validates against (FR-ING-002) from the
 * Consumer Data Standards Banking OpenAPI document at a pinned version.
 *
 *   git clone --depth 1 --branch v1.36.0 https://github.com/ConsumerDataStandardsAustralia/standards
 *   node scripts/cdr-schemas.ts standards/swagger-gen/api/cds_banking.json v1.36.0 <commit>
 *
 * Writes schemas/cdr/{accounts,balances,transactions}.schema.json and
 * src/ingest/cdr/VERSION. Unknown fields stay allowed: the importer keeps
 * them in `raw` (FR-ING-002).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

type Json = Record<string, unknown>;

const [file, version, commit] = process.argv.slice(2);
if (!file || !version || !commit) {
  console.error('usage: node scripts/cdr-schemas.ts <cds_banking.json> <version-tag> <commit>');
  process.exit(2);
}

const doc = JSON.parse(readFileSync(file, 'utf8')) as {
  info: { version: string };
  components: { schemas: Record<string, Json> };
};
const all = doc.components.schemas;
const KEEP = new Set([
  'type',
  'required',
  'properties',
  'items',
  'enum',
  'allOf',
  'anyOf',
  'oneOf',
  '$ref',
  'x-cds-type',
  'minimum',
  'maximum',
]);

function convert(node: unknown, deps: Set<string>): unknown {
  if (Array.isArray(node)) return node.map((n) => convert(n, deps));
  if (!node || typeof node !== 'object') return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node as Json)) {
    if (!KEEP.has(k)) continue;
    if (k === '$ref' && typeof v === 'string') {
      const name = v.replace('#/components/schemas/', '');
      deps.add(name);
      out.$ref = `#/$defs/${name}`;
    } else if (k === 'properties') {
      out.properties = Object.fromEntries(
        Object.entries(v as Json).map(([p, s]) => [p, convert(s, deps)])
      );
    } else out[k] = convert(v, deps);
  }
  return out;
}

function build(rootName: string, title: string): Json {
  const defs: Json = {};
  const queue = [rootName];
  const seen = new Set<string>();
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const src = all[name];
    if (!src) throw new Error(`Schema ${name} not found in ${file}`);
    const deps = new Set<string>();
    defs[name] = convert(src, deps);
    queue.push(...deps);
  }
  const root = defs[rootName] as Json;
  delete defs[rootName];
  return {
    $comment: `Derived by scripts/cdr-schemas.ts from Consumer Data Standards ${version} (${commit}), components.schemas.${rootName}. Do not edit by hand.`,
    title,
    ...root,
    $defs: Object.fromEntries(Object.entries(defs).sort(([a], [b]) => a.localeCompare(b))),
  };
}

mkdirSync('schemas/cdr', { recursive: true });
const outputs: [string, string, string][] = [
  ['accounts', 'ResponseBankingAccountListV3', 'GET /banking/accounts'],
  ['balances', 'ResponseBankingAccountsBalanceList', 'GET /banking/accounts/balances'],
  [
    'transactions',
    'ResponseBankingTransactionListV2',
    'GET /banking/accounts/{accountId}/transactions',
  ],
];
for (const [name, root, title] of outputs) {
  writeFileSync(
    `schemas/cdr/${name}.schema.json`,
    JSON.stringify(build(root, title), null, 2) + '\n'
  );
}
mkdirSync('src/ingest/cdr', { recursive: true });
writeFileSync(
  'src/ingest/cdr/VERSION',
  `${version}\n# Consumer Data Standards, https://github.com/ConsumerDataStandardsAustralia/standards @ ${commit}\n# OpenAPI info.version ${doc.info.version}\n`
);
console.log(`Wrote schemas/cdr/*.schema.json for CDS ${version}`);
