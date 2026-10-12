# Deployment

The app and these docs are deployed together to **GitHub Pages** by
`.github/workflows/ci.yml`:

| Job      | Runs on                                     | Does                                                                                                                                           |
| -------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `build`  | every PR and push                           | data-hygiene gate, GSSK pin check, format check, typecheck (TypeScript 7), app build, bundle-size budget, docs build; assembles the Pages site |
| `test`   | every PR and push                           | Vitest: unit and kernel tests                                                                                                                  |
| `e2e`    | every PR and push                           | Playwright against the production build                                                                                                        |
| `deploy` | pushes to `main` only, after all three pass | publishes the site to GitHub Pages                                                                                                             |

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

## Guards in the `deploy` job

- **Pages source check:** before deploying, the job reads the repository's Pages settings and
  fails unless the source is _GitHub Actions_.
- **Smoke test:** after deploying, the job fetches the live URL and fails unless it loads the
  built bundle (`/assets/…`) and does not reference `src/main.ts`.
