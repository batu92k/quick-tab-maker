import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end flows run against the dev server. Each test gets a fresh browser
 * context, so IndexedDB starts empty and the app seeds its demo song — which
 * gives every flow a known starting point without any shared-state juggling.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
