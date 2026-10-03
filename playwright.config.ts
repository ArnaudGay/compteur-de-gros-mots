import { defineConfig } from '@playwright/test';

export const E2E_PORT = 8791;
export const E2E_DATA = '.e2e-data';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Base vide à chaque lancement.
    command: `rm -rf ${E2E_DATA} && node dist/server/main.js`,
    url: `http://localhost:${E2E_PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(E2E_PORT),
      PUBLIC_ORIGIN: `http://localhost:${E2E_PORT}`,
      DATA_DIR: E2E_DATA,
      NODE_ENV: 'test',
    },
  },
});
