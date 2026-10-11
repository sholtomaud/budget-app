/**
 * Generate a synthetic household on disk (SPEC §7.1).
 *
 *   npm run synth -- --persona fixtures/personas/default.json --seed 42 [--months 24] --out fixtures/syn-default-42/
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { generate } from './generator.ts';
import { parsePersona } from './persona.ts';

const { values } = parseArgs({
  options: {
    persona: { type: 'string' },
    seed: { type: 'string', default: '42' },
    months: { type: 'string' },
    out: { type: 'string' },
  },
});
if (!values.persona || !values.out) {
  console.error('usage: npm run synth -- --persona <file> --seed <n> [--months <n>] --out <dir>');
  process.exit(2);
}
const persona = parsePersona(JSON.parse(readFileSync(values.persona, 'utf8')));
if (values.months) persona.months = Number(values.months);
const out = await generate(persona, values.seed);
rmSync(values.out, { recursive: true, force: true });
for (const f of out.files) {
  const path = join(values.out, f.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, f.content);
}
const txns = Object.keys(out.truth.transactions).length;
console.log(
  `${persona.name} seed ${values.seed}: ${out.files.length} files, ${txns} transactions → ${values.out}`
);
