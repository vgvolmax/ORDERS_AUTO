import { expect, test, type Page } from '@playwright/test';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface RuntimeEvidence {
  consoleErrors: string[];
  fileRequests: string[];
  pageErrors: string[];
  remoteRequests: string[];
}

function observeRuntime(page: Page): RuntimeEvidence {
  const evidence: RuntimeEvidence = {
    consoleErrors: [],
    fileRequests: [],
    pageErrors: [],
    remoteRequests: [],
  };
  page.on('pageerror', (error) => evidence.pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/i.test(url)) evidence.remoteRequests.push(url);
    if (/^file:/i.test(url)) evidence.fileRequests.push(url);
  });
  return evidence;
}

async function expectOfflineApp(page: Page, packageDirectory: string): Promise<void> {
  const evidence = observeRuntime(page);
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(path.join(packageDirectory, 'index.html')).href, {
    waitUntil: 'load',
  });

  await expect(page.getByRole('heading', { name: 'Импорт отчётов 1С' })).toBeVisible();
  await expect(page.getByText('Отчёт MIN/MAX', { exact: true })).toBeVisible();
  await expect(page.getByText('Отчёт поставщиков', { exact: true })).toBeVisible();
  await expect(page.getByText('ORDERS_AUTO запускается…', { exact: true })).toHaveCount(0);

  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.remoteRequests).toEqual([]);

  const assetRequests = evidence.fileRequests.filter((url) => /\/assets\/.*\.(?:js|css)(?:$|[?#])/i.test(url));
  expect(assetRequests.some((url) => /\.js(?:$|[?#])/i.test(url))).toBe(true);
  expect(assetRequests.some((url) => /\.css(?:$|[?#])/i.test(url))).toBe(true);
  for (const url of assetRequests) {
    const relative = path.relative(resolve(packageDirectory), fileURLToPath(url));
    expect(relative.startsWith('..') || path.isAbsolute(relative)).toBe(false);
  }
}

test('E2E-01..05 production package boots offline through file://', async ({ page }) => {
  await expectOfflineApp(page, resolve('dist/ORDERS_AUTO'));
});

test('E2E-06 package remains portable across a path with spaces and Cyrillic', async ({ page }) => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'Тест ORDERS AUTO '));
  const copiedPackage = path.join(temporaryRoot, 'другой уровень', 'ORDERS_AUTO');
  cpSync(resolve('dist/ORDERS_AUTO'), copiedPackage, { recursive: true });

  try {
    await expectOfflineApp(page, copiedPackage);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
