import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('root ORDERS_AUTO.html boots through file:// without page errors', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const remoteRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('request', (request) => {
    if (/^https?:/i.test(request.url())) remoteRequests.push(request.url());
  });

  await page.context().setOffline(true);

  const appUrl = pathToFileURL(resolve('ORDERS_AUTO.html')).href;
  await page.goto(appUrl, { waitUntil: 'load' });
  expect(page.url()).toMatch(/^file:\/\//);

  const importHeading = page.getByRole('heading', { name: 'Импорт отчётов 1С' });
  try {
    await expect(importHeading).toBeVisible({ timeout: 3_000 });
  } catch (error) {
    const bodyText = (await page.locator('body').innerText()).slice(0, 2_000);
    throw new Error(
      [
        'Root ORDERS_AUTO.html did not reach the import screen.',
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
  expect(remoteRequests).toEqual([]);

  const visibleBody = await page.locator('body').innerText();
  expect(visibleBody.length).toBeLessThan(100_000);
  expect(visibleBody).not.toMatch(/function\s*\([^)]*\)\s*\{.{500}/s);

  const giantBodyTextNodes = await page.locator('body').evaluate((body) =>
    [...body.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent?.length ?? 0)
      .filter((length) => length > 100_000),
  );
  expect(giantBodyTextNodes).toEqual([]);
});
