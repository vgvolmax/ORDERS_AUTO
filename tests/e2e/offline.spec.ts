import { expect, test, type Page } from '@playwright/test';
import { cpSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
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

test('E2E-08 only approved suppliers are selectable and exported after offline reload', async ({
  page,
}, testInfo) => {
  const { buildWorkbook } = await import('../fixtures/workbookBuilders');
  const { readFile } = await import('node:fs/promises');
  const { default: JSZip } = await import('jszip');
  const evidence = observeRuntime(page);
  const allowed = 'ИП Баранов Роман Борисович';
  const secondAllowed = 'ИП Никишин Андрей Николаевич';
  const hidden = 'ООО Скрытый поставщик';
  await page.context().setOffline(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href);
  const min = buildWorkbook([
    [
      'Код',
      'Артикул',
      'Номенклатура',
      'Количество',
      'Минимальный остаток',
      'Максимальный остаток',
      'Цена',
    ],
    ...['SKU1', 'SKU2', 'SKU3'].flatMap((code) => [
      [code, code, `Товар ${code}`, 0, 2, 10, 100],
      [null, null, 'Ленина', 0, 2, 10, null],
    ]),
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
    [allowed, 'SKU1', 'Товар SKU1', 10, 1000, 'шт'],
    [hidden, 'SKU1', 'Товар SKU1', 100, 1, 'шт'],
    [hidden, 'SKU2', 'Товар SKU2', 10, 1, 'шт'],
    [allowed, 'SKU3', 'Товар SKU3', 10, 1000, 'шт'],
    [secondAllowed, 'SKU3', 'Товар SKU3', 10, 900, 'шт'],
    [hidden, 'SKU3', 'Товар SKU3', 100, 1, 'шт'],
  ]);
  for (const [label, name, bytes] of [
    ['Выбрать файл Отчёт MIN/MAX', 'min.xlsx', min],
    ['Выбрать файл Отчёт поставщиков', 'sup.xlsx', suppliers],
  ] as const) {
    await page.getByLabel(label).setInputFiles({
      name,
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(bytes),
    });
  }
  await expect(
    page.getByText(/2 поставщиков в рабочем пуле · скрыто: 1/),
  ).toBeVisible();
  await expect(page.getByText(/Нет поставщика:/)).toContainText('1');
  await expect(page.getByText(/Несколько поставщиков:/)).toContainText('1');
  await page.getByRole('button', { name: 'Перейти к потребности' }).click();
  const filter = page.getByRole('combobox', { name: 'Поставщик', exact: true });
  await expect(filter.locator('option')).toHaveText([
    'Все поставщики',
    'Не выбран поставщик',
    allowed,
    secondAllowed,
  ]);
  await page.getByRole('button', { name: 'Поставщики', exact: true }).click();
  await expect(page.getByText(/Рабочий пул: 32 поставщика/)).toBeVisible();
  await expect(page.getByText('Код SKU2', { exact: true })).toBeVisible();
  await expect(page.getByText(/В рабочем пуле нет истории/)).toBeVisible();
  const choice = page.getByRole('combobox', { name: 'Поставщик SKU3' });
  await expect(choice.locator('option')).toHaveCount(3);
  await expect(
    choice.locator('option').filter({ hasText: hidden }),
  ).toHaveCount(0);
  const expectDecisionLayout = async () => {
    const row = page.locator('.decision').filter({ hasText: 'Код SKU3' });
    const check = await row.getByRole('checkbox').boundingBox();
    const identity = await row.locator(':scope > div').first().boundingBox();
    const select = await choice.boundingBox();
    expect(check).not.toBeNull();
    expect(identity).not.toBeNull();
    expect(select).not.toBeNull();
    expect(check!.x + check!.width).toBeLessThan(identity!.x);
    expect(identity!.x + identity!.width).toBeLessThan(select!.x);
    expect(
      Math.abs(
        check!.y + check!.height / 2 - identity!.y - identity!.height / 2,
      ),
    ).toBeLessThan(2);
    expect(
      Math.abs(
        select!.y + select!.height / 2 - identity!.y - identity!.height / 2,
      ),
    ).toBeLessThan(2);
    const labels = await page
      .locator('.supplier-auto-toolbar > label')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x, right: rect.right };
        }),
      );
    expect(labels).toHaveLength(3);
    expect(labels[1]!.x - labels[0]!.right).toBeGreaterThanOrEqual(8);
    expect(labels[2]!.x - labels[1]!.right).toBeGreaterThanOrEqual(8);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  };
  await expectDecisionLayout();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expectDecisionLayout();
  await page.screenshot({
    path: testInfo.outputPath('12-supplier-decisions-1024.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await choice.focus();
  await page.keyboard.press('Space');
  await page.screenshot({
    path: testInfo.outputPath('10-approved-supplier-select-1280.png'),
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await choice.selectOption(secondAllowed);
  await expect(choice).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Поставщики', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Код SKU2', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Поставщик SKU3' }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({
    path: testInfo.outputPath('11-approved-suppliers-narrow-1024.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Заказы', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `Все заказы ${allowed}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: `Все заказы ${secondAllowed}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(hidden, { exact: true })).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Скачать все (2)', exact: true })
    .click();
  const download = await downloadPromise;
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const csvFiles = Object.values(zip.files).filter((entry) => !entry.dir);
  expect(csvFiles).toHaveLength(2);
  for (const entry of csvFiles) {
    const csv = await entry.async('string');
    expect(entry.name).not.toContain(hidden);
    expect(csv).not.toContain(hidden);
    expect(csv).not.toContain('SKU2');
  }
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.remoteRequests).toEqual([]);
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
    ['SKU1', 'A1', 'Товар для перемещения', 150, 20, 60, 100],
    [null, null, 'Донор А', 75, 20, 60, null],
    [null, null, 'Донор Б', 65, 20, 60, null],
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
    [
      'ИП Баранов Роман Борисович',
      'SKU1',
      'Товар для перемещения',
      1,
      100,
      'шт',
    ],
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
  const pairA = page.getByRole('button', {
    name: /^Маршрут Донор А → Получатель:/,
  });
  await pairA.click();
  const routeDialog = page.getByRole('dialog', {
    name: 'Направление: Донор А ↔ Получатель',
    exact: true,
  });
  await routeDialog
    .getByRole('radio', { name: 'Донор А → Получатель', exact: true })
    .check();
  await routeDialog
    .getByRole('button', { name: 'Применить', exact: true })
    .click();
  await expect(pairA).toHaveAccessibleName(
    'Маршрут Донор А → Получатель: Донор А → Получатель',
  );
  await expect(
    page.getByRole('button', { name: /^Маршрут Получатель → Донор А:/ }),
  ).toHaveAccessibleName('Маршрут Получатель → Донор А: Донор А → Получатель');
  await page.getByLabel('Режим маршрутов').selectOption('ALL_ALLOWED');
  await expect(pairA).toHaveAccessibleName(
    'Маршрут Донор А → Получатель: Донор А → Получатель',
  );
  await expect(pairA).toBeEnabled();
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
  // Goal30 minus stock10 =20, exactly covered by donor surpluses15+5.
  await page.keyboard.press('Home');
  for (let step = 0; step < 5; step++) await page.keyboard.press('ArrowRight');
  await expect(receiverTarget).toHaveValue('25');
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
    page.getByRole('heading', { name: 'Перемещения по направлениям · 2' }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('07-transfer-matrix-1280.png'),
    fullPage: true,
  });
  const routeA = page.getByRole('button', {
    name: 'Открыть перемещение Донор А → Получатель',
  });
  await routeA.focus();
  await page.keyboard.press('Enter');
  const transferDrawer = page.getByRole('dialog', {
    name: 'Состав перемещения',
  });
  await expect(transferDrawer).toContainText('Товар для перемещения');
  await expect(transferDrawer).toContainText('A1');
  await expect(transferDrawer).toContainText('75 → 60');
  await expect(transferDrawer).toContainText('10 → 25');
  await expect(transferDrawer.getByRole('spinbutton')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(routeA).toBeFocused();
  await routeA.click();
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
  await transferDrawer
    .getByRole('button', { name: 'Принять выбранные в перемещении (1)' })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Принять выбранные перемещения' }),
  ).toContainText('50 → 35');
  await page.screenshot({
    path: testInfo.outputPath('05-acceptance-1280.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Принять перемещения', exact: true })
    .click();
  await expect(
    transferDrawer.getByText('Принято', { exact: true }),
  ).toBeVisible();
  await expect(transferDrawer).toContainText('75 → 60');
  await page.screenshot({
    path: testInfo.outputPath('08-accepted-transfer-1280.png'),
  });
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Открыть перемещение Донор Б → Получатель' })
    .click();
  // An additional selected proposal remains unapplied across navigation and reload.
  await page
    .getByRole('checkbox', { name: /Выбрать перемещение SKU1 Донор Б/ })
    .click();
  await expect(
    page.getByRole('checkbox', { name: /Выбрать перемещение SKU1 Донор Б/ }),
  ).toBeChecked();
  await page.keyboard.press('Escape');
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
  await expect(page.getByText(/Учтено строк по фильтрам: 1/)).toBeVisible();
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
  await page.getByRole('button', { name: /Все заказы ИП Баранов/ }).click();
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
  await page
    .getByRole('button', { name: 'Открыть перемещение Донор Б → Получатель' })
    .click();
  await expect(
    page.getByRole('checkbox', { name: /Выбрать перемещение SKU1 Донор Б/ }),
  ).toBeChecked();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(transferDrawer).toBeVisible();
  await expect(
    transferDrawer.getByRole('button', { name: 'Закрыть карточку' }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('09-transfer-narrow-1024.png'),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press('Escape');

  const rebalanceDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel ребалансировки' }).click();
  const exported = await rebalanceDownload,
    report = new ExcelJS.Workbook();
  await report.xlsx.load(await readWorkbook((await exported.path())!));
  expect(report.getWorksheet('Принятые')!.getCell('D2').value).toBe(15);
  expect(report.getWorksheet('Предложения')!.getCell('D2').value).toBe(5);
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
  await expect(page.getByText(/Учтено строк по фильтрам: 1/)).toBeVisible();
  await page.getByRole('button', { name: 'Рассчитать перемещения' }).click();
  await expect(
    page.getByRole('button', { name: 'Рассчитать перемещения' }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Открыть перемещение Донор А → Получатель' })
    .click();
  await page.getByRole('button', { name: /Отменить принятие SKU1/ }).click();
  await expect(
    page.getByRole('dialog', { name: 'Отменить принятие перемещения' }),
  ).toContainText('ручные количества');
  await page
    .getByRole('button', { name: 'Отменить принятие', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Отменить принятие перемещения' }),
  ).toHaveCount(0);
  await expect(transferDrawer).toContainText(
    'В этом направлении больше нет позиций.',
  );
  await page.keyboard.press('Escape');
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

for (const { count, width, height } of [
  { count: 46, width: 1280, height: 720 },
  { count: 130, width: 1024, height: 768 },
]) {
  test(`E2E-09 transfer drawer ${count} rows fits the screen without scrolling and exports accepted CSV`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const { buildWorkbook } = await import('../fixtures/workbookBuilders');
    const evidence = observeRuntime(page);
    await page.context().setOffline(true);
    await page.setViewportSize({ width, height });
    await page.goto(pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href);
    const codes = Array.from(
      { length: count },
      (_, i) => `SKU${String(i + 1).padStart(4, '0')}`,
    );
    const min = buildWorkbook([
      [
        'Код',
        'Артикул',
        'Номенклатура',
        'Количество',
        'Минимальный остаток',
        'Максимальный остаток',
        'Цена',
      ],
      ...codes.flatMap((code) => [
        [
          code,
          `Артикул ${code}`,
          `Длинное название товара: уголок комбинированный PPR НР для инженерных систем ${code}`,
          36,
          10,
          15,
          100,
        ],
        [null, null, 'Егорьевск', 30, 10, 15, null],
        [null, null, 'Ленина', 6, 10, 15, null],
      ]),
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
      ...codes.map((code) => [
        'ООО "Терем"',
        code,
        `Товар ${code}`,
        1,
        100,
        'шт',
      ]),
    ]);
    for (const [label, name, bytes] of [
      ['Выбрать файл Отчёт MIN/MAX', 'min.xlsx', min],
      ['Выбрать файл Отчёт поставщиков', 'sup.xlsx', suppliers],
    ] as const)
      await page.getByLabel(label).setInputFiles({
        name,
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from(bytes),
      });
    await page.getByRole('button', { name: 'Перейти к потребности' }).click();
    await page
      .getByRole('button', { name: 'Ребалансировка', exact: true })
      .click();
    await page.getByRole('tab', { name: 'Условия' }).click();
    await page.getByLabel('Единица для ненастроенных SKU').fill('шт');
    await page.getByLabel('Шаг для ненастроенных SKU').fill('1');
    await page
      .getByRole('button', { name: `Назначить ненастроенным (${count})` })
      .click();
    await page.getByRole('button', { name: 'Рассчитать перемещения' }).click();
    const cell = page.getByRole('button', {
      name: 'Открыть перемещение Егорьевск → Ленина',
    });
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible();
    await cell.click();
    await expect(toast).toBeVisible();
    const drawer = page.getByRole('dialog', { name: 'Состав перемещения' });
    const viewport = drawer.locator('.virtual-scroll');
    await expect(viewport).toHaveCount(1);
    const button = drawer.getByRole('button', {
      name: /Принять выбранные в перемещении/,
    });
    const expectNoScroll = () =>
      expect
        .poll(() =>
          drawer.evaluate((root) =>
            [root, ...root.querySelectorAll('*')].every((node) => {
              const el = node as HTMLElement;
              const style = getComputedStyle(el);
              return !(
                (/auto|scroll/.test(style.overflowX) &&
                  el.clientWidth > 0 &&
                  el.scrollWidth > el.clientWidth + 1) ||
                (/auto|scroll/.test(style.overflowY) &&
                  el.clientHeight > 0 &&
                  el.scrollHeight > el.clientHeight + 1)
              );
            }),
          ),
        )
        .toBe(true);
    const expectFooter = async () => {
      await expectNoScroll();
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height);
      const toastBox = await toast.boundingBox();
      if (toastBox) {
        const close = await drawer
          .getByRole('button', { name: 'Закрыть', exact: true })
          .boundingBox();
        for (const action of [box!, close!]) {
          const overlapWidth =
            Math.min(action.x + action.width, toastBox.x + toastBox.width) -
            Math.max(action.x, toastBox.x);
          const overlapHeight =
            Math.min(action.y + action.height, toastBox.y + toastBox.height) -
            Math.max(action.y, toastBox.y);
          expect(
            overlapWidth > 0 && overlapHeight > 0,
            'Toast must not obscure drawer actions',
          ).toBe(false);
        }
      }
      const owners = await drawer.locator('*').evaluateAll(
        (nodes) =>
          nodes.filter((node) => {
            const el = node as HTMLElement;
            return (
              el.clientWidth > 0 &&
              el.scrollWidth > el.clientWidth + 1 &&
              /auto|scroll/.test(getComputedStyle(el).overflowX)
            );
          }).length,
      );
      expect(owners).toBe(0);
      const verticalOwners = await drawer.locator('*').evaluateAll(
        (nodes) =>
          nodes.filter((node) => {
            const el = node as HTMLElement;
            return (
              el.clientHeight > 0 &&
              el.scrollHeight > el.clientHeight + 1 &&
              /auto|scroll/.test(getComputedStyle(el).overflowY)
            );
          }).length,
      );
      expect(verticalOwners).toBe(0);
      const drawerFits = await drawer.evaluate(
        (el) =>
          el.scrollHeight <= el.clientHeight + 1 &&
          el.scrollWidth <= el.clientWidth + 1,
      );
      expect(drawerFits).toBe(true);
    };
    await expectFooter();
    await expect(drawer.getByLabel('Сумма перемещения')).toContainText(
      new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2 }).format(
        count * 900,
      ),
    );
    await drawer
      .getByRole('checkbox', { name: /Выбрать перемещение SKU0001/ })
      .check();
    await expect(
      drawer.getByText('Выбрано к принятию: 1', { exact: true }),
    ).toBeVisible();
    await expect(button).toBeEnabled();
    await drawer.getByRole('button', { name: 'Последняя страница' }).click();
    const lastRow = viewport
      .getByRole('row')
      .filter({ hasText: codes.at(-1)! });
    await expect(lastRow).toHaveCount(1);
    await lastRow.getByRole('checkbox').check();
    await expect(button).toHaveAccessibleName(
      'Принять выбранные в перемещении (2)',
    );
    await drawer
      .getByRole('button', {
        name: `Показать полное название ${codes.at(-1)!}`,
      })
      .click();
    const product = page.getByRole('dialog', {
      name: `Товар ${codes.at(-1)!}`,
    });
    await expect(product).toContainText('для инженерных систем');
    await page.keyboard.press('Escape');
    await expect(product).toHaveCount(0);
    if (width === 1280) {
      await page.setViewportSize({ width, height: 600 });
      await expectNoScroll();
      const shortBox = await button.boundingBox();
      expect(shortBox!.y + shortBox!.height).toBeLessThanOrEqual(600);
      await expect
        .poll(() =>
          drawer.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath('14-transfer-short-1280-600.png'),
      });
      await page.setViewportSize({ width, height });
    }
    await expectFooter();
    await page.screenshot({
      path: testInfo.outputPath(`13-transfer-${count}-${width}.png`),
      fullPage: false,
    });
    await drawer.getByRole('button', { name: 'Закрыть карточку' }).click();
    const sender = page.getByRole('group', {
      name: 'Итоги отправителя Егорьевск',
    });
    await expect(sender).toContainText('Выбрано: 1 800,00');
    await expect(sender).toContainText(
      new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2 }).format(
        count * 900,
      ),
    );
    await expect(cell).toContainText('Выбрано на сумму: 1 800,00');
    await page.screenshot({
      path: testInfo.outputPath(`15-sender-selected-${count}-${width}.png`),
      fullPage: true,
    });
    await cell.click();
    await button.click();
    const confirm = page.getByRole('dialog', {
      name: 'Принять выбранные перемещения',
    });
    await expect(confirm).toBeVisible();
    await confirm
      .getByRole('button', { name: 'Принять перемещения', exact: true })
      .click();
    await expect(confirm).toHaveCount(0);
    await expect(
      drawer.getByLabel('Принято на сумму в перемещении'),
    ).toContainText('1 800,00');
    await expectFooter();
    await drawer
      .getByRole('textbox', { name: 'Поиск по составу перемещения' })
      .fill('SKU0001');
    await expect(drawer.getByRole('row')).toHaveCount(2);
    const downloaded = page.waitForEvent('download');
    await drawer
      .getByRole('button', { name: 'Скачать CSV принятых позиций (2)' })
      .click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toMatch(
      /^Перемещение__Егорьевск__Ленина__.*\.csv$/,
    );
    const csv = readFileSync((await file.path())!, 'utf8');
    expect(
      csv.startsWith(
        '\ufeffКод;Артикул;Номенклатура;Отправитель;Получатель;Количество;Ед.;Цена MIN/MAX;Сумма\r\n',
      ),
    ).toBe(true);
    expect(csv).toContain('SKU0001;');
    expect(csv).toContain(`${codes.at(-1)!};`);
    expect(csv.split('\r\n')).toHaveLength(4);
    expect(csv).not.toContain('SKU0002;');
    await drawer.getByRole('button', { name: 'Закрыть карточку' }).click();
    await expect(cell).toContainText(`Принято: 2 из ${count}`);
    await expect(cell).not.toContainText('Отклонено: 1');
    await expect(
      page.getByText('Принято на сумму', { exact: true }).locator('..'),
    ).toContainText('1 800,00');
    await page
      .getByRole('textbox', {
        name: 'Поиск по коду, артикулу, товару и маршруту',
      })
      .fill('SKU0001');
    await cell.click();
    const filteredDownload = page.waitForEvent('download');
    await drawer
      .getByRole('button', { name: 'Скачать CSV принятых позиций (2)' })
      .click();
    const filteredCsv = readFileSync(
      (await (await filteredDownload).path())!,
      'utf8',
    );
    expect(filteredCsv).toContain(`${codes.at(-1)!};`);
    expect(filteredCsv.split('\r\n')).toHaveLength(4);
    expect(evidence.pageErrors).toEqual([]);
    expect(evidence.consoleErrors).toEqual([]);
    expect(evidence.remoteRequests).toEqual([]);
  });
}

const coverageBranches = [
  'Донор А',
  'Донор Б',
  'Первый',
  'Второй',
  'Склад 5',
  'Склад 6',
  'Склад 7',
  'Склад 8',
  'Склад 9',
];

async function importFullCoverageFixture(
  page: Page,
  branchNames = coverageBranches,
) {
  const { buildWorkbook } = await import('../fixtures/workbookBuilders');
  const min = buildWorkbook([
    [
      'Код',
      'Артикул',
      'Номенклатура',
      'Количество',
      'Минимальный остаток',
      'Максимальный остаток',
      'Цена',
    ],
    ...['FULL1', 'FULL2', 'SKIP14'].flatMap((code) => {
      const firstDonor = code === 'SKIP14' ? 16 : 18;
      return [
        [
          code,
          `Артикул ${code}`,
          `Товар полного покрытия ${code}`,
          firstDonor + 16 + (branchNames.length - 4) * 10,
          1,
          10,
          100,
        ],
        [null, null, 'Донор А', firstDonor, 1, 10, null],
        [null, null, 'Донор Б', 16, 1, 10, null],
        [null, null, 'Первый', 0, 1, 8, null],
        [null, null, 'Второй', 0, 1, 6, null],
        ...branchNames
          .slice(4)
          .map((branch) => [null, null, branch, 10, 1, 10, null]),
      ];
    }),
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
    ...['FULL1', 'FULL2', 'SKIP14'].map((code) => [
      'ИП Баранов Роман Борисович',
      code,
      `Товар полного покрытия ${code}`,
      1,
      100,
      'шт',
    ]),
  ]);
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href);
  for (const [label, name, bytes] of [
    ['Выбрать файл Отчёт MIN/MAX', 'full-coverage-min.xlsx', min],
    ['Выбрать файл Отчёт поставщиков', 'full-coverage-sup.xlsx', suppliers],
  ] as const) {
    await page.getByLabel(label).setInputFiles({
      name,
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(bytes),
    });
  }
  await page.getByRole('button', { name: 'Перейти к потребности' }).click();
  await page
    .getByRole('button', { name: 'Ребалансировка', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Маршруты', exact: true }).click();
}

async function expectRouteFrameFits(page: Page) {
  const frame = page.getByRole('region', {
    name: 'Настройка маршрутов',
    exact: true,
  });
  await expect
    .poll(() =>
      frame.evaluate((root) => {
        const main = root.closest('main')!;
        const table = root.querySelector('table')!;
        const errors: string[] = [];
        const viewport = {
          width: window.innerWidth,
          height: window.innerHeight,
        };
        for (const [name, el] of [
          ['page', document.scrollingElement!],
          ['body', document.body],
          ['main', main],
          ['frame', root],
          ['table', table],
        ] as const) {
          const node = el as HTMLElement;
          if (node.scrollWidth > node.clientWidth)
            errors.push(
              `${name}: horizontal overflow ${node.scrollWidth}/${node.clientWidth}`,
            );
          if (node.scrollHeight > node.clientHeight)
            errors.push(
              `${name}: vertical overflow ${node.scrollHeight}/${node.clientHeight}`,
            );
          if (
            ['page', 'body', 'main'].includes(name) &&
            /hidden|clip/.test(
              `${getComputedStyle(node).overflowX} ${getComputedStyle(node).overflowY}`,
            )
          ) {
            errors.push(`${name}: clipped overflow`);
          }
        }
        for (const el of [
          root,
          table,
          ...root.querySelectorAll(
            'button,input,select,th,td,.routes-legend,.routes-pagination',
          ),
        ]) {
          const box = el.getBoundingClientRect();
          if (
            box.left < 0 ||
            box.top < 0 ||
            box.right > viewport.width ||
            box.bottom > viewport.height
          ) {
            errors.push(
              `${el.tagName} ${el.getAttribute('aria-label') ?? el.className}: outside viewport`,
            );
          }
        }
        if (window.scrollX !== 0 || window.scrollY !== 0)
          errors.push('page scrolled');
        return errors;
      }),
    )
    .toEqual([]);
}

async function expectRouteDialogFits(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect
    .poll(() =>
      dialog.evaluate((root) => {
        const errors: string[] = [];
        for (const el of [root, root.querySelector('.modal-body')!]) {
          const node = el as HTMLElement;
          if (
            node.scrollWidth > node.clientWidth ||
            node.scrollHeight > node.clientHeight
          )
            errors.push(`${node.className}: overflow`);
        }
        for (const el of [
          root,
          ...root.querySelectorAll('button,input,label'),
        ]) {
          const box = el.getBoundingClientRect();
          if (
            box.left < 0 ||
            box.top < 0 ||
            box.right > innerWidth ||
            box.bottom > innerHeight
          )
            errors.push(`${el.tagName}: outside viewport`);
        }
        for (const button of root.querySelectorAll('button')) {
          const box = button.getBoundingClientRect();
          if (
            !button.contains(
              document.elementFromPoint(
                box.left + box.width / 2,
                box.top + box.height / 2,
              ),
            )
          )
            errors.push(`${button.textContent}: covered`);
        }
        return errors;
      }),
    )
    .toEqual([]);
}

async function setPairDirection(
  page: Page,
  from: string,
  to: string,
  label: string,
) {
  await page
    .getByRole('button', { name: new RegExp(`^Маршрут ${from} → ${to}:`) })
    .click();
  const dialog = page.getByRole('dialog', {
    name: `Направление: ${from} ↔ ${to}`,
    exact: true,
  });
  await dialog.getByRole('radio', { name: label, exact: true }).check();
  await dialog.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function configureFullCoverage(page: Page) {
  await page.getByLabel('Режим маршрутов').selectOption('SELECTIVE');
  // A can reach both receivers, but B can only reach Second: the joint flow
  // must reserve A's8 for First and use B's6 for Second.
  await setPairDirection(page, 'Донор А', 'Первый', 'Донор А → Первый');
  await setPairDirection(page, 'Донор А', 'Второй', 'Донор А → Второй');
  await setPairDirection(page, 'Донор Б', 'Второй', 'Донор Б → Второй');
  await page.getByRole('tab', { name: 'Условия', exact: true }).click();
  await page.getByLabel('Единица для ненастроенных SKU').fill('шт');
  await page.getByLabel('Шаг для ненастроенных SKU').fill('1');
  await page
    .getByRole('button', { name: 'Назначить ненастроенным (3)', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Рассчитать перемещения', exact: true })
    .click();
}

function coverageMetric(page: Page, label: string) {
  return page
    .locator('.coverage-metrics .metric')
    .filter({ has: page.getByText(label, { exact: true }) });
}

test('E2E-10 nine-branch route matrix fits, edits pairs and groups, and preserves disabled directions offline', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const evidence = observeRuntime(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await importFullCoverageFixture(page);
  await expect(
    page.getByRole('tab', { name: 'Приоритеты', exact: true }),
  ).toHaveCount(0);
  const matrix = page.getByRole('table', {
    name: 'Матрица маршрутов',
    exact: true,
  });
  const pair = page.getByRole('button', { name: /^Маршрут Донор А → Первый:/ });
  const reversePair = page.getByRole('button', {
    name: /^Маршрут Первый → Донор А:/,
  });
  for (const height of [720, 600]) {
    await page.setViewportSize({ width: 1280, height });
    await expect(matrix.locator('tbody tr')).toHaveCount(9);
    await expect(matrix.locator('thead th')).toHaveCount(10);
    await expect(matrix.getByRole('button', { name: /^Маршрут / })).toHaveCount(
      72,
    );
    await expectRouteFrameFits(page);
    await pair.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', {
      name: 'Направление: Донор А ↔ Первый',
      exact: true,
    });
    await expect(
      dialog.getByRole('radio', { name: 'В обе стороны', exact: true }),
    ).toBeChecked();
    await expectRouteDialogFits(page);
    const close = dialog.getByRole('button', {
      name: 'Закрыть окно',
      exact: true,
    });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(
      dialog.getByRole('button', { name: 'Применить', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await dialog.getByRole('radio', { name: 'Запрещено', exact: true }).check();
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(pair).toBeFocused();
    await expect(pair).toHaveText('↔');
    const groupTrigger = page.getByRole('button', {
      name: 'Настроить направления Донор А, строка',
      exact: true,
    });
    await groupTrigger.focus();
    await page.keyboard.press('Enter');
    await expectRouteDialogFits(page);
    await expect(page.getByRole('dialog')).toContainText(
      'Будет изменено пар: 8',
    );
    await expect(
      page
        .getByRole('dialog')
        .getByRole('button', { name: 'Применить', exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath(`20-route-group-1280-${height}.png`),
    });
    await page.keyboard.press('Escape');
    await expect(groupTrigger).toBeFocused();
    await expectRouteFrameFits(page);
    await page.screenshot({
      path: testInfo.outputPath(`20-route-matrix-1280-${height}.png`),
    });
  }
  await setPairDirection(page, 'Донор А', 'Первый', 'Донор А → Первый');
  await expect(pair).toHaveText('→');
  await expect(reversePair).toHaveText('←');
  await expect(pair).toHaveAccessibleName(
    'Маршрут Донор А → Первый: Донор А → Первый',
  );
  await expect(reversePair).toHaveAccessibleName(
    'Маршрут Первый → Донор А: Донор А → Первый',
  );
  await expect(pair).toHaveClass(/routes-oneway/);
  await setPairDirection(page, 'Донор А', 'Первый', 'Запрещено');
  await expect(pair).toHaveText('×');
  await expect(pair).toHaveClass(/routes-blocked/);
  await expect(reversePair).toHaveText('×');
  await setPairDirection(page, 'Донор А', 'Первый', 'В обе стороны');
  await expect(pair).toHaveClass(/routes-both/);

  const participation = matrix.getByRole('checkbox', {
    name: 'Участие Склад 9',
    exact: true,
  });
  await expect(participation).toHaveCount(2);
  await participation.first().uncheck();
  for (const checkbox of await participation.all())
    await expect(checkbox).not.toBeChecked();
  const disabledHeader = matrix.getByRole('button', {
    name: 'Настроить направления Склад 9, строка',
    exact: true,
  });
  await expect(disabledHeader).toBeDisabled();
  await expect(disabledHeader.locator('xpath=ancestor::th')).toHaveClass(
    'routes-header-inactive',
  );
  const disabledPair = matrix.getByRole('button', {
    name: /^Маршрут Донор А → Склад 9:/,
  });
  await expect(disabledPair).toBeDisabled();
  await expect(disabledPair).toHaveText('↔');
  await expect(disabledPair).toHaveClass(/routes-disabled/);
  expect(
    await disabledPair.evaluate((el) => Number(getComputedStyle(el).opacity)),
  ).toBeLessThan(1);
  await page
    .getByRole('button', {
      name: 'Настроить направления Донор А, столбец',
      exact: true,
    })
    .click();
  const group = page.getByRole('dialog', {
    name: 'Направления: Донор А',
    exact: true,
  });
  await expect(group).toContainText('Будет изменено пар: 7');
  await group
    .getByRole('radio', {
      name: 'Только получает: остальные → Донор А',
      exact: true,
    })
    .check();
  await group.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(pair).toHaveText('←');
  await expect(reversePair).toHaveText('→');
  await participation.last().check();
  for (const checkbox of await participation.all())
    await expect(checkbox).toBeChecked();
  await expect(disabledPair).toBeEnabled();
  await expect(disabledPair).toHaveText('↔');
  await expect(disabledHeader.locator('xpath=ancestor::th')).toHaveClass(
    'routes-header-active',
  );
  await page.getByLabel('Режим маршрутов').selectOption('SELECTIVE');
  await expect(pair).toHaveText('←');
  await expect(
    page.getByRole('button', { name: /^Маршрут Первый → Второй:/ }),
  ).toHaveText('×');

  // Narrow-screen fallback paginates rather than losing any row or column.
  await page.setViewportSize({ width: 1024, height: 768 });
  for (const axis of ['строка', 'столбец'] as const) {
    const seen = new Set<string>();
    const next = page.getByRole('button', {
      name: axis === 'строка' ? 'Следующие строки' : 'Следующие столбцы',
      exact: true,
    });
    for (let i = 0; i < coverageBranches.length; i++) {
      await expectRouteFrameFits(page);
      const labels = await matrix
        .getByRole('button', {
          name: new RegExp(`^Настроить направления .+, ${axis}$`),
        })
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')!));
      labels.forEach((label) =>
        seen.add(
          label.replace('Настроить направления ', '').replace(`, ${axis}`, ''),
        ),
      );
      if (!(await next.count()) || (await next.isDisabled())) break;
      await next.click();
    }
    expect([...seen].sort()).toEqual([...coverageBranches].sort());
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(
    page.getByText('Сеанс сохранён на этом компьютере', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(pair).toHaveText('←');
  await expect(page.getByLabel('Режим маршрутов')).toHaveValue('SELECTIVE');
  await expectRouteFrameFits(page);
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.remoteRequests).toEqual([]);
});

test('E2E-11 whole-SKU coverage skips14 rather than2 and accepted subsets survive disabling and revoke offline', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const evidence = observeRuntime(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await importFullCoverageFixture(page);
  await configureFullCoverage(page);
  await expect(
    coverageMetric(page, 'К перемещению').locator('.coverage-quantity'),
  ).toHaveText('28 шт');
  const skippedMetric = coverageMetric(page, 'Не распределено');
  await expect(skippedMetric.locator('.coverage-quantity')).toHaveText('14 шт');
  await expect(skippedMetric).toContainText('1 400,00');
  await expect(skippedMetric).toContainText('1 SKU');
  await expect(coverageMetric(page, 'Принято на сумму')).toContainText('0,00');
  await expect(
    page.getByRole('heading', {
      name: 'Перемещения по направлениям · 2',
      exact: true,
    }),
  ).toBeVisible();
  // A trial flow of12 is diagnostic only: there is no partial SKIP14 line.
  const resultsQuery = page.getByRole('textbox', {
    name: 'Поиск по коду, артикулу, товару и маршруту',
    exact: true,
  });
  await resultsQuery.fill('SKIP14');
  await expect(
    page.getByRole('button', { name: /^Открыть перемещение / }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('checkbox', {
      name: 'Выбрать видимые предложения',
      exact: true,
    }),
  ).toBeDisabled();
  await resultsQuery.fill('');
  await skippedMetric
    .getByRole('button', { name: 'Показать список', exact: true })
    .click();
  const skipped = page.getByRole('region', {
    name: 'Нераспределённые артикулы',
    exact: true,
  });
  await expect(
    skipped.getByRole('heading', {
      name: 'Не распределено · 1 SKU',
      exact: true,
    }),
  ).toBeVisible();
  const skippedRow = skipped.getByRole('row').filter({ hasText: 'SKIP14' });
  await expect(skippedRow).toContainText('Нужно: 14');
  await expect(skippedRow).toContainText('Можно доставить: 12');
  await expect(skippedRow).toContainText('Не хватает: 2');
  await expect(skippedRow).toContainText('Недостаточно излишка сверх Max');
  await expect(skippedRow).toContainText('1 400,00');
  await skipped
    .getByRole('textbox', {
      name: 'Поиск нераспределённого товара',
      exact: true,
    })
    .fill('FULL1');
  await expect(skippedRow).toHaveCount(0);
  await skipped
    .getByRole('textbox', {
      name: 'Поиск нераспределённого товара',
      exact: true,
    })
    .fill('SKIP14');
  await skippedRow
    .getByRole('button', { name: 'Потребность подразделений · 2', exact: true })
    .click();
  const reason = page.getByRole('dialog', {
    name: 'Не распределено · Артикул SKIP14',
    exact: true,
  });
  await expect(
    reason.getByRole('row').filter({ hasText: 'Первый' }),
  ).toContainText('8');
  await expect(
    reason.getByRole('row').filter({ hasText: 'Второй' }),
  ).toContainText('6');
  await page.screenshot({
    path: testInfo.outputPath('21-skipped-whole-need.png'),
  });
  await page.keyboard.press('Escape');
  await skipped
    .getByRole('button', { name: 'К перемещениям', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Не распределено · 1 SKU', exact: true })
    .click();
  await expect(skipped).toBeVisible();
  await skipped
    .getByRole('button', { name: 'К перемещениям', exact: true })
    .click();

  const route = page.getByRole('button', {
    name: 'Открыть перемещение Донор А → Первый',
    exact: true,
  });
  await expect(route).toContainText('2 SKU');
  await expect(route).toContainText('16 шт');
  await route.click();
  const transfer = page.getByRole('dialog', {
    name: 'Состав перемещения',
    exact: true,
  });
  await expect(
    transfer.getByRole('row').filter({ hasText: 'SKIP14' }),
  ).toHaveCount(0);
  const fullRow = transfer.getByRole('row').filter({ hasText: 'FULL1' });
  await expect(fullRow).toContainText('18 → 10');
  await expect(fullRow).toContainText('0 → 8');
  await fullRow.getByRole('checkbox').check();
  await transfer
    .getByRole('button', {
      name: 'Принять выбранные в перемещении (1)',
      exact: true,
    })
    .click();
  const confirmation = page.getByRole('dialog', {
    name: 'Принять выбранные перемещения',
    exact: true,
  });
  await expect(confirmation).toContainText('Строк: 1');
  await expect(
    confirmation.getByRole('row').filter({ hasText: 'FULL1' }),
  ).toContainText('8 → 0');
  await confirmation
    .getByRole('button', { name: 'Отмена', exact: true })
    .click();
  await expect(fullRow).toContainText('Предложено');
  await transfer
    .getByRole('button', {
      name: 'Принять выбранные в перемещении (1)',
      exact: true,
    })
    .click();
  await confirmation
    .getByRole('button', { name: 'Принять перемещения', exact: true })
    .click();
  await expect(fullRow.getByText('Принято', { exact: true })).toBeVisible();
  await expect(
    transfer.getByRole('row').filter({ hasText: 'FULL2' }),
  ).toContainText('Предложено');
  const csvDownload = page.waitForEvent('download');
  await transfer
    .getByRole('button', {
      name: 'Скачать CSV принятых позиций (1)',
      exact: true,
    })
    .click();
  const csv = readFileSync((await (await csvDownload).path())!, 'utf8');
  expect(csv).toContain('FULL1;');
  expect(csv).toContain(';8;шт;100;800');
  expect(csv).not.toContain('FULL2;');
  expect(csv).not.toContain('SKIP14;');
  expect(csv.split('\r\n').filter(Boolean)).toHaveLength(2);
  await page.keyboard.press('Escape');
  await expect(
    coverageMetric(page, 'К перемещению').locator('.coverage-quantity'),
  ).toHaveText('20 шт');
  await expect(coverageMetric(page, 'Принято на сумму')).toContainText(
    '800,00',
  );
  await expect(skippedMetric.locator('.coverage-quantity')).toHaveText('14 шт');

  await page.getByRole('button', { name: 'Первый', exact: true }).click();
  await page
    .getByRole('checkbox', {
      name: 'Показать покрытые перемещениями',
      exact: true,
    })
    .check();
  const coveredRow = page.getByRole('row').filter({ hasText: 'FULL1' });
  await coveredRow
    .getByRole('button', { name: /Учтённые перемещения/ })
    .click();
  const popup = page.getByRole('dialog', {
    name: 'Учтённые перемещения',
    exact: true,
  });
  for (const [label, value] of [
    ['Без перемещений', '8'],
    ['Принятый вход', '8'],
    ['Текущая потребность', '0'],
  ]) {
    await expect(
      popup
        .getByText(label!, { exact: true })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText(value!);
  }
  await expect(popup).toContainText('Донор А → Первый');
  await expect(popup).not.toContainText('FULL2');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Заказы', exact: true }).click();
  const firstOrderColumn = await page
    .getByRole('columnheader', { name: 'Первый', exact: true })
    .evaluate((el) => Array.from(el.parentElement!.children).indexOf(el));
  const firstOrder = page
    .locator('table.matrix tbody tr')
    .filter({ hasText: 'ИП Баранов Роман Борисович' })
    .locator('td')
    .nth(firstOrderColumn - 1)
    .getByRole('button');
  await firstOrder.click();
  const order = page.getByRole('dialog');
  await expect(
    order.getByLabel('Количество FULL1', { exact: true }),
  ).toHaveCount(0);
  await expect(
    order.getByLabel('Количество FULL2', { exact: true }),
  ).toHaveValue('8');
  await expect(
    order.getByLabel('Количество SKIP14', { exact: true }),
  ).toHaveValue('8');
  await page.keyboard.press('Escape');

  await page
    .getByRole('button', { name: 'Ребалансировка', exact: true })
    .click();
  await expect(
    page.getByText('Сеанс сохранён на этом компьютере', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(coverageMetric(page, 'Принято на сумму')).toContainText(
    '800,00',
  );
  await expect(skippedMetric.locator('.coverage-quantity')).toHaveText('14 шт');
  await route.click();
  await expect(
    transfer.getByRole('row').filter({ hasText: 'FULL1' }),
  ).toContainText('Принято');
  await expect(
    transfer.getByRole('row').filter({ hasText: 'FULL2' }),
  ).toContainText('Предложено');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Маршруты', exact: true }).click();
  await page
    .getByRole('table', { name: 'Матрица маршрутов', exact: true })
    .getByRole('checkbox', { name: 'Участие Первый', exact: true })
    .first()
    .uncheck();
  await expect(
    page.getByText(/Предложения устарели после изменения условий/),
  ).toBeVisible();
  await expect(coverageMetric(page, 'Принято на сумму')).toContainText(
    '800,00',
  );
  await page.getByRole('button', { name: 'Первый', exact: true }).click();
  await page
    .getByRole('row')
    .filter({ hasText: 'FULL1' })
    .getByRole('button', { name: /Учтённые перемещения/ })
    .click();
  await expect(
    popup
      .getByText('Принятый вход', { exact: true })
      .locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('8');
  await expect(
    popup
      .getByText('Текущая потребность', { exact: true })
      .locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('0');
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Ребалансировка', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Результаты', exact: true }).click();
  await route.click();
  await expect(
    transfer.getByRole('row').filter({ hasText: 'FULL1' }),
  ).toContainText('Принято');
  await expect(
    transfer
      .getByRole('row')
      .filter({ hasText: 'FULL2' })
      .getByRole('checkbox'),
  ).toBeDisabled();
  const stillAcceptedDownload = page.waitForEvent('download');
  await transfer
    .getByRole('button', {
      name: 'Скачать CSV принятых позиций (1)',
      exact: true,
    })
    .click();
  expect(
    readFileSync((await (await stillAcceptedDownload).path())!, 'utf8'),
  ).toBe(csv);
  await transfer
    .getByRole('button', { name: /Отменить принятие FULL1/ })
    .click();
  const revoke = page.getByRole('dialog', {
    name: 'Отменить принятие перемещения',
    exact: true,
  });
  await expect(revoke).toBeVisible();
  await revoke
    .getByRole('button', { name: 'Отменить принятие', exact: true })
    .click();
  await expect(revoke).toHaveCount(0);
  await expect(
    transfer.getByRole('row').filter({ hasText: 'FULL1' }),
  ).toContainText('Предложено');
  await page.keyboard.press('Escape');
  await expect(coverageMetric(page, 'Принято на сумму')).toContainText('0,00');
  await page.getByRole('button', { name: 'Первый', exact: true }).click();
  await expect(
    page.getByRole('row').filter({ hasText: 'FULL1' }),
  ).toContainText('8');
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: 'FULL1' })
      .getByRole('button', { name: /Учтённые перемещения/ }),
  ).toHaveCount(0);
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.remoteRequests).toEqual([]);
});

test('E2E-12 extended registry preserves off-page mass routes and long names', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const evidence = observeRuntime(page);
  await page.setViewportSize({ width: 1280, height: 600 });
  const extra = 'Подразделение с очень длинным названием инженерного склада';
  await importFullCoverageFixture(page, [
    ...coverageBranches,
    'Склад 10',
    'Склад 11',
    extra,
  ]);
  const nav = page.getByRole('navigation', { name: 'Страницы матрицы' });
  await expect(nav).toBeVisible();
  await expectRouteFrameFits(page);
  await page
    .getByRole('button', {
      name: 'Настроить направления Донор А, строка',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Направления: Донор А',
    exact: true,
  });
  await expect(dialog).toContainText('Будет изменено пар: 11');
  await dialog
    .getByRole('radio', {
      name: 'Только отправляет: Донор А → остальные',
      exact: true,
    })
    .check();
  await dialog.getByRole('button', { name: 'Применить', exact: true }).click();
  const nextColumns = page.getByRole('button', { name: 'Следующие столбцы' });
  while (await nextColumns.isEnabled()) await nextColumns.click();
  const lastPair = page.getByRole('button', {
    name: new RegExp(`^Маршрут Донор А → ${extra}:`),
  });
  await expect(lastPair).toHaveText('→');
  await lastPair.click();
  const lastDialog = page.getByRole('dialog', {
    name: `Направление: Донор А ↔ ${extra}`,
    exact: true,
  });
  await expect(
    lastDialog.getByRole('radio', { name: `Донор А → ${extra}`, exact: true }),
  ).toBeChecked();
  await expectRouteDialogFits(page);
  await page.keyboard.press('Escape');
  await expect(lastPair).toBeFocused();
  const nextRows = page.getByRole('button', { name: 'Следующие строки' });
  while (await nextRows.isEnabled()) await nextRows.click();
  await expect(
    page.getByRole('button', {
      name: `Настроить направления ${extra}, строка`,
      exact: true,
    }),
  ).toBeVisible();
  await expectRouteFrameFits(page);
  await page.screenshot({
    path: testInfo.outputPath('routes-extended-long-names.png'),
  });
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.remoteRequests).toEqual([]);
});
