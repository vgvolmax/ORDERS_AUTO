import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('standalone HTML boots through file:// without page errors', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const appUrl = pathToFileURL(resolve('dist/index.html')).href;
  await page.goto(appUrl);

  await expect(
    page.getByRole('heading', { name: 'Импорт отчётов 1С' }),
  ).toBeVisible();
  await expect(page.getByText('Отчёт MIN/MAX', { exact: true })).toBeVisible();
  await expect(page.getByText('Отчёт поставщиков', { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
