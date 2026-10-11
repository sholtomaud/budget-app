# ADR 0019 — Encryption at rest, export and delete-all (M7)

- Status: accepted
- Date: 2026-10-11
- SPEC: §14 (NFR-STO-001…005) refined; amended to match in Draft 10

## Decisions

1. **A wrapped data key.**
   - A random 256-bit data key (DEK) encrypts every record with AES-GCM.
   - The DEK is itself encrypted under a key derived from the passphrase (PBKDF2-SHA-256, 600 000
     iterations, 16-byte salt).
   - The wrapped DEK, salt and parameters are the _keyring_, stored unencrypted in `kv:keyring`.
     Its presence means the database is encrypted.
   - Changing the passphrase re-wraps one key; records are untouched.
   - The unwrapped DEK is non-extractable. It is passed to the workers that read IndexedDB (ingest,
     sim) as a `CryptoKey`, which structured clone carries without exposing its bytes.
2. **Per-record sealing with additional data.**
   - Each stored value becomes `{ $sealed: 1, iv, ct }`.
   - The additional data is `kv:<key>` or `imports:<id>`, so a ciphertext cannot be swapped into
     another record.
   - Import rows keep `record.id` readable, because it is the store's key path. Import IDs are
     content hashes, not personal data.
3. **One code path.**
   - `IdbValue` and `IdbImportStore` seal on write and unseal on read through the worker's `vault`.
   - Whole-database operations (enable, disable, change passphrase, export, import) run on a
     `RawDb` interface, so they are unit-tested in memory on a synthetic household and run on
     IndexedDB in the app.
4. **A lossless codec.** Records hold `bigint` money and possibly bytes or `undefined`. A small
   tagged-JSON codec preserves them for encryption and export. A plain object with a `$t` key is
   escaped, so decoding never misreads user data.
5. **Locking reloads the app.**
   - Locking, by the button or after idle (15 minutes by default), reloads the page. Every worker,
     cached view and rendered screen holding decrypted data is discarded.
   - On start, screens wait for the vault (`whenReady`). A lock screen covers the app until the
     passphrase unlocks it.
   - The lock screen also offers "delete all data" for a forgotten passphrase. Nothing can recover
     the data without it, and the UI says so.
6. **Turning encryption off needs the passphrase**, not just an open session, so an unattended
   unlocked session can't strip it.
7. **`.budgetapp` export.**
   - A ZIP holding `manifest.json` (format, version, KDF parameters, IV, counts; plain) and
     `payload.bin`: AES-GCM over gzip of the encoded data, under a key derived from the export
     passphrase (minimum 8 characters).
   - The at-rest keyring is never exported. An export opens anywhere with its own passphrase.
   - Import replaces everything and keeps the target's encryption state: into an encrypted
     database, records are sealed with its key.
   - Newer format versions are refused.
8. **Delete all data** removes:
   - the IndexedDB database, after terminating the workers that hold connections;
   - Cache Storage and OPFS;
   - the service-worker registration;
   - this app's `localStorage` preferences.

   It then reloads to the Start screen.

9. **Workers are tracked** so they can be terminated. A Vite constraint applies: the
   `new Worker(new URL(...))` expression must stay inline at every call site. A helper that took
   the URL as an argument made the build ship the worker's TypeScript source as a static asset.

## Not done

- **Run outputs in OPFS** (NFR-STO-001): simulation results are not persisted yet. They are
  re-computed from seeds (NFR-DET-001). OPFS is cleared by delete-all for when they are.
- **Argon2id:** PBKDF2 is WebCrypto-native and needs no third-party code (ADR 0007). Argon2id would
  need a WASM implementation in ml-core. Revisit if PBKDF2's cost becomes a concern.
