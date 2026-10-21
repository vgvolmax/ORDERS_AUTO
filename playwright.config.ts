import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        launchOptions: process.env.ORDERS_AUTO_CHROME_PATH
          ? { executablePath: process.env.ORDERS_AUTO_CHROME_PATH }
          : {},
      },
    },
  ],
});
