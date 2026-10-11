# ADR 0004 — Vendor GSSK from its `dist` branch, pinned by commit and SHA-256

- Status: accepted
- Date: 2026-10-11
- Refines: SPEC §15.3, NFR-KER-001; relates to KR-4

## Decision

`vendor/gssk/` holds `gssk.wasm`, `gssk.js`, `gssk.d.ts`, `gssk.schema.json` and `gssk.h`,
copied from the [GSSK-Giannantoni](https://github.com/energese-project/GSSK-Giannantoni) `dist`
branch. That branch is the output of GSSK's own release CI (`make wasm` with its pinned WASI
SDK). `GSSK_PIN.json` records the repo, branch, **commit SHA** of the dist build, GSSK version,
and the SHA-256 of every vendored file. The tag is `null` until GSSK tags releases (KR-4).

- `npm run gssk:update -- <dist-commit>` re-vendors and rewrites the pin. Upgrading is a
  deliberate PR.
- `npm run gssk:verify` and `tests/kernel/` check every file against the pin.
- At runtime the `sim` worker hashes the fetched `gssk.wasm` and refuses to run on mismatch, or
  when the kernel reports a version other than the pinned one.

This replaces §15.3's "builds GSSK in a container at that commit". Rebuilding locally adds a
container and toolchain dependency for no gain in trust, because we pin the exact bytes either
way.

Current pin: GSSK 5.3.0, dist @ `3043a57ca4c39896f6784b8db2c0b80662416d46`.
