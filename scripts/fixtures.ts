/**
 * Regenerate the committed synthetic fixtures: fixtures/syn-<persona>-42/ for
 * each persona in fixtures/personas/. A test checks the committed files match
 * the generator byte for byte, so a generator change must come with this rerun.
 *
 *   npm run fixtures
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generate } from '../src/synth/generator.ts';
import { parsePersona } from '../src/synth/persona.ts';

export const FIXTURE_SEED = '42';

for (const file of readdirSync('fixtures/personas')
  .filter((f) => f.endsWith('.json'))
  .sort()) {
  const persona = parsePersona(JSON.parse(readFileSync(join('fixtures/personas', file), 'utf8')));
  const out = await generate(persona, FIXTURE_SEED);
  const dir = `fixtures/syn-${persona.name}-${FIXTURE_SEED}`;
  rmSync(dir, { recursive: true, force: true });
  for (const f of out.files) {
    mkdirSync(dirname(join(dir, f.path)), { recursive: true });
    writeFileSync(join(dir, f.path), f.content);
  }
  console.log(
    `${dir}: ${out.files.length} files, ${Object.keys(out.truth.transactions).length} transactions`
  );
}
