import { defineConfig, devices } from '@playwright/test';

/** The deployed site, checked by CI after each deploy (LIVE_URL ends with /). */
const LIVE_URL = process.env.LIVE_URL;
if (!LIVE_URL)
  throw new Error('Set LIVE_URL to the deployed site, e.g. https://<owner>.github.io/<repo>/');

export default defineConfig({
  testDir: 'tests/live',
  // The CDN can serve the previous version for a moment after a deploy.
  retries: 2,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-live-report' }]],
  use: { baseURL: LIVE_URL, trace: 'retain-on-failure', screenshot: 'on' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
