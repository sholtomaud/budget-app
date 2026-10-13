# ADR 0016 — Local-first sync to storage the user owns

- Status: proposed (milestone M12)
- Date: 2026-10-11
- SPEC: §1.1, §14.1 (FR-SYNC-001…008), NFR-PRIV-004

## Context

Data lives in IndexedDB on one device (NFR-PRIV-001). Users want:

- the same data on a laptop and a phone;
- a backup that survives a cleared browser;
- receipts from the iOS app (ADR 0017) to land in the same ledger.

The obvious design, our own cloud account system on AWS, would make us the custodian of
households' financial data. That brings breach liability, Privacy Act obligations, and a server
the static app otherwise doesn't need.

## Decision

**Local-first, with sync to storage the user already owns. We host no user data.**

1. **IndexedDB stays the source of truth** on each device. The app works fully offline, as now.
2. **Sync targets are the user's own cloud storage**, through the provider's OAuth in the browser
   (PKCE / token client, no app server):
   - **Google Drive** after Google sign-in, using the hidden per-app folder (`drive.appdata` scope)
     so the app sees only its own files, or `drive.file` for a user-visible folder;
   - later Dropbox (app folder), OneDrive (app root) and iCloud (CloudKit JS; also the natural
     store for the iOS app).

   Signing in to the provider _is_ the account. There is no budget-app account and no password.

3. **End-to-end encrypted.** The client encrypts every object with the M7 key: a PBKDF2/Argon2
   passphrase-derived key wrapping a data key, then AES-GCM. The provider holds ciphertext only.
   Losing the passphrase means losing the cloud copy; local data and exports are unaffected.
4. **Sync model.** The data is already mostly an append-only log:
   - imports, user labels, rules, decisions, scenarios and receipts are events with IDs;
   - settings are last-writer-wins registers with a hybrid logical clock.

   Sync is therefore an encrypted event log plus periodic encrypted snapshots, with a set-union
   merge by event ID. Because the ledger is rebuilt from imports on load (ADR 0008), the merged
   state is deterministic. Conflicts on the same register show both values to the user.

5. **Egress rules apply** (FR-API-001…005): provider origins go in the CSP `connect-src`, sync is
   opt-in per device, and every sync is logged. Payloads are already encrypted, so redaction is
   moot. The privacy e2e test is extended to assert that only ciphertext leaves.
6. **Our own cloud is not built.** If a hosted service is needed later (the M14 bank connector, or
   the M15 offers feed), it stores no household data at rest. The connector already follows this
   (FR-LIVE-003).

## Consequences

- No server, no user database, and no breach surface of ours for household data.
- Google sign-in is identity only for the user's own Drive. Social sign-in elsewhere (Apple,
  Microsoft) arrives with those providers' storage.
- §1.1's "no cloud sync" non-goal narrows to "no cloud sync to servers we operate".
