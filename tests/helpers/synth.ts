import { readFileSync } from 'node:fs';
import { generate, type SynthOutput } from '../../src/synth/generator.ts';
import { parsePersona, type Persona } from '../../src/synth/persona.ts';
import { IngestService, MemoryImportStore, type InputFile } from '../../src/ingest/service.ts';

export const PERSONAS = ['frugal-renter', 'default', 'high-capex-crypto'] as const;

export function loadPersona(name: string): Persona {
  return parsePersona(
    JSON.parse(
      readFileSync(new URL(`../../fixtures/personas/${name}.json`, import.meta.url), 'utf8')
    )
  );
}

const cache = new Map<string, Promise<SynthOutput>>();

/** Generate (once per process) a persona at a seed, optionally shortened. */
export function synth(name: string, seed = '42', months?: number): Promise<SynthOutput> {
  const key = `${name}|${seed}|${months ?? ''}`;
  let p = cache.get(key);
  if (!p) {
    const persona = loadPersona(name);
    if (months) persona.months = months;
    p = generate(persona, seed);
    cache.set(key, p);
  }
  return p;
}

/** The generated files the importer would see (everything but truth and manifest). */
export function cdrInputs(
  out: SynthOutput,
  filter: (path: string) => boolean = () => true
): InputFile[] {
  const enc = new TextEncoder();
  return out.files
    .filter(
      (f) =>
        f.path.endsWith('.json') &&
        f.path !== 'truth.json' &&
        f.path !== 'manifest.json' &&
        filter(f.path)
    )
    .map((f) => ({ name: f.path, bytes: enc.encode(f.content) }));
}

export async function ingest(inputs: InputFile[], label = 'test'): Promise<IngestService> {
  const svc = new IngestService(new MemoryImportStore());
  await svc.importFiles(inputs, { label });
  return svc;
}
