import { defineConfig } from 'vitepress';

// On GitHub Pages the docs live under the app: https://<owner>.github.io/<repo>/docs/
// CI sets DOCS_BASE and APP_URL; locally the docs serve from / and link to the dev server.
const base = process.env.DOCS_BASE ?? '/';
const appUrl = process.env.APP_URL ?? 'http://localhost:5173/';

const adrs = [
  ['0001', 'UI framework: native web components', '0001-ui-framework'],
  ['0002', 'Unit tests (superseded by 0006)', '0002-test-runner'],
  ['0003', 'CSV instead of xlsx', '0003-csv-instead-of-xlsx'],
  ['0004', 'GSSK pinned from its dist branch', '0004-gssk-pin-from-dist-branch'],
  ['0005', 'Conservation check and sinks', '0005-conservation-check'],
  ['0006', 'Vitest, VitePress and Pages', '0006-vitest-vitepress-pages'],
  ['0007', 'No third-party runtime code', '0007-no-third-party-runtime'],
  ['0008', 'CDR ingest and synthetic data', '0008-cdr-ingest-and-synthetic-data'],
  ['0009', 'Classification', '0009-classification'],
  ['0010', 'Budget and CAPEX register', '0010-budget-and-capex'],
  ['0011', 'Forecasting and ml-core', '0011-forecasting-and-ml-core'],
  ['0012', 'Freedom simulation', '0012-freedom-simulation'],
  ['0013', 'Scenarios and the optimiser', '0013-scenarios-and-optimiser'],
  ['0019', 'Encryption, export and delete-all', '0019-encryption-export-delete'],
  ['0020', 'Name, landing page and guide', '0020-name-landing-and-guide'],
  ['0014', 'Workbook mapping assistant', '0014-workbook-mapping-assistant'],
  ['0015', 'Bayesian workflow', '0015-bayesian-workflow'],
  ['0016', 'Sync to user-owned storage', '0016-sync-and-user-owned-storage'],
  ['0017', 'Receipts companion app', '0017-receipts-companion-app'],
  ['0018', 'Monetisation and the agentic layer', '0018-monetisation-and-agentic-layer'],
] as const;

export default defineConfig({
  title: 'Crux',
  description: 'Local-first household budget and freedom-capital simulator, on the GSSK kernel.',
  base,
  lang: 'en-AU',
  cleanUrls: false,
  lastUpdated: false,
  srcExclude: ['**/README.md'],
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }]],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Spec', link: '/spec' },
      { text: 'Decisions', link: '/adr/' },
      { text: 'Open the app', link: appUrl, target: '_self' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Using the app', link: '/user-guide' },
          { text: 'Architecture', link: '/guide/architecture' },
          { text: 'Testing', link: '/guide/testing' },
          { text: 'Deployment', link: '/guide/deployment' },
        ],
      },
      { text: 'Reference', items: [{ text: 'Specification', link: '/spec' }] },
      {
        text: 'Decisions (ADRs)',
        link: '/adr/',
        items: adrs.map(([n, title, file]) => ({ text: `${n} · ${title}`, link: `/adr/${file}` })),
      },
    ],
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/sholtomaud/budget-app' }],
    footer: { message: 'MIT licensed. Not financial advice.' },
  },
});
