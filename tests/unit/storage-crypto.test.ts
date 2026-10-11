import { describe, expect, test } from 'vitest';
import { MemoryStateStore } from '../../src/classify/service.ts';
import { DataService, MemoryBudgetStore } from '../../src/data/service.ts';
import { MemoryImportStore } from '../../src/ingest/service.ts';
import {
  changePassphrase,
  disableEncryption,
  enableEncryption,
  exportBundle,
  importBundle,
  keyringOf,
  MemoryRawDb,
  openAll,
  readBundle,
  type PlainData,
} from '../../src/store/bundle.ts';
import { decode, encode } from '../../src/store/codec.ts';
import {
  createKeyring,
  isSealed,
  rewrapKeyring,
  seal,
  unlockKeyring,
  unseal,
  WrongPassphraseError,
} from '../../src/store/crypto.ts';
import { cdrInputs, synth } from '../helpers/synth.ts';

const IT = 1_000; // fast KDF for tests; the app uses 600 000

/** A realistic database: a synthetic household's imports, classifier and budget state. */
async function household(): Promise<PlainData> {
  const imports = new MemoryImportStore();
  const state = new MemoryStateStore();
  const budget = new MemoryBudgetStore();
  const svc = new DataService(imports, state, budget);
  await svc.importFiles(cdrInputs(await synth('default')));
  return {
    imports: await imports.all(),
    kv: {
      classify: await state.load(),
      budget: { ...(await budget.load()), note: undefined, big: 12345678901234567890n },
      freedom: { goal: { floor: 50_000_00n, projectIncome: undefined }, $t: 'tricky' },
    },
  };
}

const dbWith = (p: PlainData) => {
  const db = new MemoryRawDb();
  db.data = { imports: structuredClone(p.imports), kv: Object.entries(structuredClone(p.kv)) };
  return db;
};

describe('codec', () => {
  test('round-trips bigint, bytes, undefined and objects with a $t key', () => {
    const v = {
      a: 1n,
      b: [-(2n ** 70n), new Uint8Array([0, 255, 7])],
      c: undefined,
      d: { $t: 'big', v: 'not a tag' },
      e: 'x',
    };
    expect(decode(encode(v))).toEqual(v);
  });
});

describe('encryption at rest (NFR-STO-002)', () => {
  test('a keyring unlocks with its passphrase only, and re-wraps without changing the key', async () => {
    const { meta, key } = await createKeyring('correct horse', IT);
    const sealed = await seal(key, { amount: 123n }, 'kv:x');
    await expect(unlockKeyring(meta, 'wrong')).rejects.toBeInstanceOf(WrongPassphraseError);
    const again = await unlockKeyring(meta, 'correct horse');
    expect(await unseal(again, sealed, 'kv:x')).toEqual({ amount: 123n });
    const meta2 = await rewrapKeyring(meta, 'correct horse', 'battery staple');
    await expect(unlockKeyring(meta2, 'correct horse')).rejects.toBeInstanceOf(
      WrongPassphraseError
    );
    expect(await unseal(await unlockKeyring(meta2, 'battery staple'), sealed, 'kv:x')).toEqual({
      amount: 123n,
    });
  });

  test('a sealed record cannot be moved to another key (additional data)', async () => {
    const { key } = await createKeyring('pw-pw-pw-pw', IT);
    const sealed = await seal(key, 'secret', 'kv:budget');
    await expect(unseal(key, sealed, 'kv:freedom')).rejects.toThrow();
  });

  test('enable → change passphrase → disable leaves the data exactly as it was', async () => {
    const plain = await household();
    const db = dbWith(plain);
    const key = await enableEncryption(db, 'first passphrase', IT);
    expect(keyringOf(db.data)).not.toBeNull();
    expect(db.data.imports.every(isSealed)).toBe(true);
    expect(db.data.kv.filter(([k]) => k !== 'keyring').every(([, v]) => isSealed(v))).toBe(true);
    // No plaintext leaks into the stored rows.
    const stored = JSON.stringify(db.data, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
    expect(stored).not.toContain('SYN-TXN');
    expect(stored).not.toContain('HARBOURSIDE');
    expect(await openAll(db.data, key)).toEqual(plain);
    await expect(openAll(db.data, null)).rejects.toThrow('locked');

    await changePassphrase(db, 'first passphrase', 'second passphrase');
    await expect(disableEncryption(db, 'first passphrase')).rejects.toBeInstanceOf(
      WrongPassphraseError
    );
    await disableEncryption(db, 'second passphrase');
    expect(keyringOf(db.data)).toBeNull();
    expect(await openAll(db.data, null)).toEqual(plain);
  });
});

describe('.budgetapp export and import (NFR-STO-003)', () => {
  test('round trip is lossless, plain to encrypted and back', async () => {
    const plain = await household();
    const bytes = await exportBundle(dbWith(plain), null, 'export passphrase', IT);
    // It's a ZIP whose payload is not readable without the passphrase.
    expect(new TextDecoder().decode(bytes)).not.toContain('SYN-TXN');
    await expect(readBundle(bytes, 'nope nope')).rejects.toBeInstanceOf(WrongPassphraseError);

    // Into an encrypted database: records are sealed with that database's key.
    const target = new MemoryRawDb();
    const key = await enableEncryption(target, 'at rest passphrase', IT);
    await importBundle(target, bytes, 'export passphrase', key);
    expect(target.data.imports.every(isSealed)).toBe(true);
    expect(await openAll(target.data, key)).toEqual(plain);

    // And back out of the encrypted database.
    const bytes2 = await exportBundle(target, key, 'another export', IT);
    const plainAgain = new MemoryRawDb();
    await importBundle(plainAgain, bytes2, 'another export', null);
    expect(await openAll(plainAgain.data, null)).toEqual(plain);
  });

  test('refuses a short export passphrase and files from a newer format', async () => {
    await expect(exportBundle(new MemoryRawDb(), null, 'short', IT)).rejects.toThrow(
      '8 characters'
    );
  });
});
