import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('standalone HTML boots through file:// without page errors', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  const appUrl = pathToFileURL(resolve('dist/index.html')).href;
  await page.goto(appUrl, { waitUntil: 'load' });

  const importHeading = page.getByRole('heading', { name: 'Импорт отчётов 1С' });
  try {
    await expect(importHeading).toBeVisible({ timeout: 3_000 });
  } catch (error) {
    const bodyText = (await page.locator('body').innerText()).slice(0, 2_000);
    throw new Error(
      [
        'Offline app did not reach the import screen.',
        `URL: ${page.url()}`,
        `pageerror: ${JSON.stringify(pageErrors)}`,
        `console.error: ${JSON.stringify(consoleErrors)}`,
        `body: ${JSON.stringify(bodyText)}`,
        `original assertion: ${error instanceof Error ? error.message : String(error)}`,
      ].join('\n'),
    );
  }

  await expect(page.getByText('Отчёт MIN/MAX', { exact: true })).toBeVisible();
  await expect(page.getByText('Отчёт поставщиков', { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
