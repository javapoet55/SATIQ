import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 30000, workers: 1,
  use: {baseURL: 'http://127.0.0.1:5173', channel: 'chrome', headless: true, reducedMotion: 'reduce', trace: 'retain-on-failure'},
  webServer: {command: 'npm run dev -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: true},
});
