# Incident: the live app broke after the M8 merge

- Date: 2026-10-11 (merge 22:32 UTC), found 2026-10-12
- Impact: the live app at `https://sholtomaud.github.io/budget-app/` did not load. The browser
  asked for `https://sholtomaud.github.io/src/main.ts` and `/favicon.svg` and got 404s.
- Data: none at risk. The app is local-first; nothing is stored on the server.
- Fix: [CI guards and a test fix](#what-changed), plus **one repository setting the owner must
  change** (below).

## What happened

Every push to `main` started **two** independent deployments to GitHub Pages:

| Workflow                     | Publishes                                        | Gated on tests?                              |
| ---------------------------- | ------------------------------------------------ | -------------------------------------------- |
| `CI` → `deploy` job          | the built site (`dist/` plus the docs)           | yes: `needs: [build, test, e2e]`             |
| `pages build and deployment` | the raw repository, as GitHub's branch publisher | **no**: runs on every push, whatever CI says |

The second one exists because **Settings → Pages → Source** is set to _Deploy from a branch_.
The deployment guide said to set it to _GitHub Actions_, but nothing checked that.

Until the M8 merge the two raced and the gated CI deploy usually finished last, overwriting the raw
publish, so the problem stayed hidden. On the M8 merge:

1. `pages build and deployment` published the raw repository at 22:32:54. Its `index.html` is
   the **source** page, which loads `/src/main.ts`: that only works in the Vite dev server. On
   Pages it resolves to the domain root and 404s.
2. `CI` failed: one e2e test (`storage.spec.ts`, "encrypt at rest, lock, export, delete all,
   import") hit `Execution context was destroyed, most likely because of a navigation`.
3. So the gated `deploy` job was **skipped**, correctly, and nothing replaced the broken raw
   publish.

**The test gate worked. A second, ungated publisher went around it.**

## Why the e2e test failed

A race in the test, not a bug in the app. "Delete all data" ends with a full page load of the
start screen (`location.href = BASE_URL`). The test waited only for the URL to change, then
read IndexedDB with `page.evaluate`. The URL changes when the navigation commits, before the new
page has loaded, so the evaluate could run in a document that was being replaced. It passed on
the PR run and locally, and failed on `main`. The restore step had the same pattern: the app
reloads 600 ms after showing "Restored", and the test did not wait for that reload.

"Flaky" is not a root cause: the test was wrong to assume the page was settled.

## What changed

- **`tests/e2e/storage.spec.ts`:** before delete-all and before restore, the test registers for
  the page's `load` event, then waits for that load (and the start screen's heading) before
  touching the page. It passes 5 out of 5 with `--repeat-each=5`.
- **`.github/workflows/ci.yml`, `deploy` job:**
  - _Pages source check._ Before deploying, it reads the repository's Pages settings and fails
    with a clear error unless the source is _GitHub Actions_. A misconfigured source now turns CI
    red on `main` instead of silently racing.
  - _Smoke test after deploy._ It fetches the live URL and fails unless the page loads the built
    bundle (`/assets/…`) and does not reference `src/main.ts`.
- **`docs/guide/deployment.md`:** explains why the setting matters and what the checks do.

## Action for the owner (required)

In **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.

This stops `pages build and deployment` from running. Until it is changed, every push to `main`
still publishes the raw repository, and the new check will mark the `deploy` job red. The
workflow cannot change this setting with its default token.

Then re-run the latest `CI` run on `main` (or merge this fix) to publish the built app.

## Lessons

- **One publisher.** A deployment path that bypasses the tests will eventually ship something
  broken. Check the deployment configuration in CI, not only in a guide.
- **Verify the live result.** A deploy that "succeeds" can still serve the wrong thing; a smoke
  test on the live URL catches it.
- **Waiting on a URL is not waiting on a page.** In e2e tests, wait for the navigation's `load`
  event and for something the new page renders.
