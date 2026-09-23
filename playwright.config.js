import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 45000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100', headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge', viewport: { width: 1440, height: 1000 } },
  webServer: { command: 'node server.js', url: 'http://127.0.0.1:3100/health', reuseExistingServer: false,
    env: { PORT: '3100', DATA_DIR: '.tools/browser-test-data', NODE_ENV: 'test' } }
});
