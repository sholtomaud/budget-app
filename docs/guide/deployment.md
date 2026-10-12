# Deployment

The app and these docs are deployed together to **GitHub Pages** by
`.github/workflows/ci.yml`:

| Job      | Runs on                                | Does                                                                                                                                                         |
| -------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `build`  | every PR and push                      | data-hygiene gate, GSSK pin check, format check, typecheck, app build under `/<repo>/`, bundle-size budget, docs build; assembles and uploads the Pages site |
| `test`   | every PR and push                      | Vitest: unit, kernel, property and eval tests; ml-core tests                                                                                                 |
| `e2e`    | after `build`                          | Playwright against **the site `build` uploaded**, served as Pages serves it (under `/<repo>/`, real 404s, `404.html` for deep links)                         |
| `deploy` | pushes to `main`, after all three pass | checks the Pages source, then publishes the site the e2e tests just passed                                                                                   |
| `live`   | after `deploy`                         | Playwright on the live URL: the app and docs load, the kernel verifies, no request fails, nothing logs an error; screenshots kept for 30 days                |

What is tested is what is shipped: `e2e` downloads the `build` job's site rather than building its
own, and `deploy` publishes that same artifact.

The published site is laid out as:

```
https://<owner>.github.io/<repo>/        the app (BASE_PATH=/<repo>/)
https://<owner>.github.io/<repo>/docs/   these docs (DOCS_BASE=/<repo>/docs/)
```

The app's build writes a `404.html` copy of the app shell, so deep links such as `/<repo>/ledger`
load the app on GitHub Pages. The service worker leaves `/docs/` alone.

## One-time setup

In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**. The workflow
cannot do this with the default token. The `github-pages` environment that GitHub creates allows
deployments from `main`.

This matters: with the source left on _Deploy from a branch_, GitHub also runs its own
`pages build and deployment` on every push. That publishes the raw repository, whose
`index.html` loads `/src/main.ts` and does not work outside the dev server, and it does not wait
for the tests. See the [incident report](../reports/2026-10-12-pages-regression.md).

## Guards

- **Pages source check** (`deploy`): before deploying, the job reads the repository's Pages
  settings and fails unless the source is _GitHub Actions_ (the API calls the branch source
  `legacy`).
- **Page guard** (every e2e and live test, `tests/e2e/fixtures.ts`): a test fails if the site
  answers any request with an error status, or the page throws or logs a console error. Deep
  links, which Pages answers with `404.html` and status 404, are the one expected exception.
- **Linked assets** (e2e and live): every icon, manifest, script and stylesheet the page links to
  is requested directly, because browsers fetch favicons outside the page.
- **Live check** (`live`): the same checks in a browser on the deployed URL, with screenshots
  uploaded as the `live-site-report` artifact on every run.

Run the live check by hand with
`LIVE_URL=https://<owner>.github.io/<repo>/ npx playwright test -c playwright.live.config.ts`.
