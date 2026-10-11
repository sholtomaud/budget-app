/**
 * The `synth` worker (SPEC §4, §7.1): generates a synthetic household in the
 * browser. truth.json is withheld: the app never reads it (FR-SYN-004).
 */
import type { InputFile } from '../ingest/service.ts';
import { generate } from '../synth/generator.ts';
import { parsePersona, type Persona } from '../synth/persona.ts';
import { expose, type Endpoint } from './rpc.ts';

const files = import.meta.glob<Persona>('../../fixtures/personas/*.json', {
  eager: true,
  import: 'default',
});
const personas = Object.values(files).map((p) => parsePersona(p));

export interface PersonaSummary {
  name: string;
  description: string;
  months: number;
  start: string;
}

const api = {
  personas(): PersonaSummary[] {
    return personas.map((p) => ({
      name: p.name,
      description: p.description ?? '',
      months: p.months,
      start: p.start,
    }));
  },
  async generate(name: string, seed: string): Promise<InputFile[]> {
    const persona = personas.find((p) => p.name === name);
    if (!persona) throw new Error(`Unknown persona ${name}`);
    const out = await generate(structuredClone(persona), seed);
    const enc = new TextEncoder();
    return out.files
      .filter((f) => f.path !== 'truth.json' && f.path !== 'manifest.json')
      .map((f) => ({ name: `syn-${name}-${seed}/${f.path}`, bytes: enc.encode(f.content) }));
  },
};

export type SynthApi = typeof api;

expose(api, globalThis as unknown as Endpoint);
