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
  page.on('pageerror', (error) =>
    evidence.pageErrors.push(error.stack ?? error.message),
  );
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

async function expectOfflineApp(
  page: Page,
  packageDirectory: string,
): Promise<void> {
  const evidence = observeRuntime(page);
  await page.context().setOffline(true);
  await page.goto(
    pathToFileURL(path.join(packageDirectory, 'index.html')).href,
    {
      waitUntil: 'load',
    },
  );

  await expect(
    page.getByRole('heading', { name: 'Импорт отчётов 1С' }),
  ).toBeVisible();
  await expect(page.getByText('Отчёт MIN/MAX', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Отчёт поставщиков', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('ORDERS_AUTO запускается…', { exact: true }),
  ).toHaveCount(0);

  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.remoteRequests).toEqual([]);

  const assetRequests = evidence.fileRequests.filter((url) =>
    /\/assets\/.*\.(?:js|css)(?:$|[?#])/i.test(url),
  );
  expect(assetRequests.some((url) => /\.js(?:$|[?#])/i.test(url))).toBe(true);
  expect(assetRequests.some((url) => /\.css(?:$|[?#])/i.test(url))).toBe(true);
  for (const url of assetRequests) {
    const relative = path.relative(
      resolve(packageDirectory),
      fileURLToPath(url),
    );
    expect(relative.startsWith('..') || path.isAbsolute(relative)).toBe(false);
  }
}

test('E2E-01..05 production package boots offline through file://', async ({
  page,
}) => {
  await expectOfflineApp(page, resolve('dist/ORDERS_AUTO'));
});

test('E2E-06 package remains portable across a path with spaces and Cyrillic', async ({
  page,
}) => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'Тест ORDERS AUTO '));
  const copiedPackage = path.join(
    temporaryRoot,
    'другой уровень',
    'ORDERS_AUTO',
  );
  cpSync(resolve('dist/ORDERS_AUTO'), copiedPackage, { recursive: true });

  try {
    await expectOfflineApp(page, copiedPackage);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('E2E-07 accepted movements drive orders, export and survive reload offline', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const { buildWorkbook } = await import('../fixtures/workbookBuilders');
  const { readFile } = await import('node:fs/promises');
  const { default: ExcelJS } = await import('exceljs');
  const readWorkbook = async (file: string) =>
    Uint8Array.from(await readFile(file)).buffer;
  const evidence = observeRuntime(page);
  await page.context().setOffline(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href);
  const min = buildWorkbook([
    [
      'Код',
      'Артикул',
      'Номенклатура',
      'Количество (в еденицах хранения)',
      'Минимальный остаток',
      'Максимальный остаток',
      'Цена',
    ],
    ['SKU1', 'A1', 'Товар для перемещения', 165, 20, 60, 100],
    [null, null, 'Донор А', 75, 20, 60, null],
    [null, null, 'Донор Б', 80, 20, 60, null],
    [null, null, 'Получатель', 10, 20, 60, null],
  ]);
  const suppliers = buildWorkbook([
    [
      'Контрагент',
      'Код',
      'Номенклатура',
      'Количество',
      'Стоимость',
      'Ед. изм.',
    ],
    ['Поставщик', 'SKU1', 'Товар для перемещения', 1, 100, 'шт'],
  ]);
  await page.getByLabel('Выбрать файл Отчёт MIN/MAX').setInputFiles({
    name: 'min.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(min),
  });
  await page.getByLabel('Выбрать файл Отчёт поставщиков').setInputFiles({
    name: 'sup.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(suppliers),
  });
  await page.getByRole('button', { name: 'Перейти к потребности' }).click();
  await page
    .getByRole('button', { name: 'Ребалансировка', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Маршруты' }).click();
  await page.getByLabel('Режим маршрутов').selectOption('SELECTIVE');
  await page.getByLabel('Маршрут Донор А → Получатель').selectOption('A_TO_B');
  await expect(page.getByLabel('Маршрут Получатель → Донор А')).toHaveValue(
    'B_TO_A',
  );
  await page.getByLabel('Режим маршрутов').selectOption('ALL_ALLOWED');
  await expect(page.getByLabel('Маршрут Донор А → Получатель')).toHaveValue(
    'A_TO_B',
  );
  await expect(page.getByLabel('Маршрут Получатель → Донор А')).toHaveValue(
    'B_TO_A',
  );
  await expect(page.getByLabel('Маршрут Донор А → Получатель')).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath('04-routes-1280.png'),
    fullPage: true,
  });
  await page.getByRole('tab', { name: 'Условия' }).click();
  const receiverTarget = page.getByRole('slider', { name: 'Цель получателя' });
  await receiverTarget.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(receiverTarget).toHaveValue('95');
  await page.keyboard.press('ArrowRight');
  await expect(receiverTarget).toHaveValue('100');
  await page
    .getByLabel('Получатель', { exact: true })
    .selectOption('BELOW_MAX');
  await expect(page.getByLabel('Получатель', { exact: true })).toHaveValue(
    'BELOW_MAX',
  );
  await page
    .getByLabel('Получатель', { exact: true })
    .selectOption('BELOW_MIN');
  await page.getByLabel('Получатель', { exact: true }).focus();
  await page.keyboard.press('Space');
  await page.screenshot({
    path: testInfo.outputPath('00-conditions-select-1280.png'),
  });
  await page.keyboard.press('Escape');
  await page.getByLabel('Единица для ненастроенных SKU').fill('шт');
  await page.getByLabel('Шаг для ненастроенных SKU').fill('1');
  await page
    .getByRole('button', { name: 'Назначить ненастроенным (1)' })
    .click();
  await page.getByRole('button', { name: 'Рассчитать перемещения' }).click();
  await expect(
    page.getByRole('heading', { name: 'Предложения · 2' }),
  ).toBeVisible();
  await page
    .getByRole('checkbox', { name: /Выбрать перемещение SKU1 Донор А/ })
    .click();
  await expect(
    page.getByRole('checkbox', { name: /Выбрать перемещение SKU1 Донор А/ }),
  ).toBeChecked();
  await page.screenshot({
    path: testInfo.outputPath('01-selected-1280.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Принять выбранные (1)' }).click();
  await expect(page.getByRole('dialog')).toContainText('50 → 35');
  await page.screenshot({
    path: testInfo.outputPath('05-acceptance-1280.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Принять перемещения', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Учтённые перемещения · 1' }),
  ).toBeVisible();
  // An additional selected proposal remains unapplied across navigation and reload.
  await page
    .getByRole('checkbox', { name: /Выбрать перемещение SKU1 Донор Б/ })
    .click();
  await expect(
    page.getByRole('checkbox', { name: /Выбрать перемещение SKU1 Донор Б/ }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Получатель', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Получатель', exact: true }),
  ).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'SKU1' });
  await expect(row).toContainText('35');
  await row.getByRole('button', { name: /Учтённые перемещения/ }).click();
  await expect(
    page.getByRole('dialog', { name: 'Учтённые перемещения' }),
  ).toContainText('Без перемещений');
  await expect(page.getByRole('dialog')).toContainText('Донор А → Получатель');
  await expect(page.getByRole('dialog')).not.toContainText('Донор Б');
  await page.screenshot({
    path: testInfo.outputPath('02-movement-popup-1280.png'),
  });
  await page.getByRole('button', { name: 'Открыть ребалансировку' }).click();
  await expect(
    page.getByRole('heading', { name: 'Ребалансировка', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Подразделение: Получатель', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Отменить принятие SKU1/ }),
  ).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath('06-scoped-results-1280.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await page.getByRole('button', { name: 'Поставщики', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Поставщики', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Заказы', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Заказы', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /SKU · Готов/ }).click();
  await expect(page.getByLabel('Количество SKU1', { exact: true })).toHaveValue(
    '35',
  );
  await page.getByLabel('Количество SKU1', { exact: true }).fill('40');
  await page.getByRole('checkbox', { name: 'Заказ проверен' }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Заказ проверен' }),
  ).toBeChecked();
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать CSV заказа' }).click();
  const csv = await csvDownload;
  expect(await readFile((await csv.path())!, 'utf8')).toContain(';40;');
  await expect(
    page.getByRole('button', { name: 'Скачать CSV ещё раз' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const xlsxDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel все' }).click();
  const xlsx = await xlsxDownload,
    workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readWorkbook((await xlsx.path())!));
  expect(workbook.getWorksheet('Получатель')!.getCell('D2').value).toBe(40);
  await page.getByRole('button', { name: /Все заказы Поставщик/ }).click();
  await expect(page.getByLabel('Количество SKU1 Получатель')).toHaveValue('40');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath('03-supplier-matrix-1440.png'),
  });
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(
    page.getByText('Сеанс сохранён на этом компьютере', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Заказы', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /SKU · Выгружен/ }).click();
  await expect(page.getByLabel('Количество SKU1', { exact: true })).toHaveValue(
    '40',
  );
  await expect(
    page.getByRole('checkbox', { name: 'Заказ проверен' }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page
    .getByRole('button', { name: 'Ребалансировка', exact: true })
    .click();
  await expect(
    page.getByRole('checkbox', { name: /Выбрать перемещение SKU1 Донор Б/ }),
  ).toBeChecked();
  const rebalanceDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel ребалансировки' }).click();
  const exported = await rebalanceDownload,
    report = new ExcelJS.Workbook();
  await report.xlsx.load(await readWorkbook((await exported.path())!));
  expect(report.getWorksheet('Принятые')!.getCell('D2').value).toBe(15);
  expect(report.getWorksheet('Предложения')!.getCell('D2').value).toBe(20);
  await page.getByRole('button', { name: 'Загрузить новые отчёты' }).click();
  await page.getByRole('button', { name: 'Начать новый сеанс' }).click();
  await expect(
    page.getByRole('heading', { name: 'Импорт отчётов 1С' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'История сеансов' }).click();
  const archived = page
    .getByRole('row')
    .filter({ hasText: 'min.xlsx' })
    .filter({ hasText: 'sup.xlsx' });
  await archived
    .getByRole('button', { name: 'Восстановить', exact: true })
    .click();
  await page.getByRole('button', { name: 'Восстановить копию' }).click();
  await expect(
    page.getByRole('heading', { name: 'Учтённые перемещения · 1' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Отменить принятие SKU1/ }).click();
  await expect(page.getByRole('dialog')).toContainText('ручные количества');
  await page
    .getByRole('button', { name: 'Отменить принятие', exact: true })
    .click();
  await page.getByRole('button', { name: 'Получатель', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Получатель', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'SKU1' })).toContainText(
    '50',
  );
  await expect(
    page.getByRole('button', { name: /Учтённые перемещения/ }),
  ).toHaveCount(0);
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.remoteRequests).toEqual([]);
});
