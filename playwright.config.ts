import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {timeout: 10_000},
  use: {
    baseURL: 'http://127.0.0.1:4173',
    video: 'on',
  },
  webServer: {
    command: 'npx http-server . -p 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
