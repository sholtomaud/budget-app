import { describe, expect, test } from 'vitest';
import { MemoryStateStore } from '../../src/classify/service.ts';
import { DataService } from '../../src/data/service.ts';
import { MemoryImportStore } from '../../src/ingest/service.ts';
import { cdrInputs, synth } from '../helpers/synth.ts';

describe('DataService', () => {
  test('classifies on import; user labels survive undo and re-import', async () => {
    const out = await synth('default');
    const imports = new MemoryImportStore();
    const state = new MemoryStateStore();
    const svc = new DataService(imports, state);
    const rec = await svc.importFiles(cdrInputs(out));
    let v = svc.view();
    expect(v.txns.every((t) => t.classification)).toBe(true);
    const rent = v.txns.find((t) => t.description.includes('HARBOURSIDE'))!;
    const key = `${rent.accountId}\u001f${rent.id}`;
    const similar = svc.similar(key);
    expect(similar.length).toBeGreaterThan(90);
    await svc.correct([key], 'housing.rent', true);
    v = svc.view();
    expect(v.txns.filter((t) => t.classification?.categoryId === 'housing.rent').length).toBe(
      similar.length + 1
    );
    expect(v.userLabelled).toEqual([key]);

    await svc.undo(rec.id);
    expect(svc.view().txns).toHaveLength(0);
    await svc.importFiles(cdrInputs(out));
    // A fresh service over the same stores: everything comes back, labels included.
    const again = new DataService(imports, state);
    await again.load();
    const back = again.view().txns.find((t) => t.id === rent.id)!;
    expect(back.classification).toMatchObject({ by: 'user', categoryId: 'housing.rent' });
    expect(again.view().memory.map((m) => m.key)).toContain('HARBOURSIDE REALTY');
  });
});
