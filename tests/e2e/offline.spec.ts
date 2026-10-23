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

test('E2E-10 donor priorities split, manual limits, acceptance, CSV and reload offline', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const { buildWorkbook } = await import('../fixtures/workbookBuilders');
  const evidence = observeRuntime(page);
  await page.context().setOffline(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href);
  const codes = Array.from(
    { length: 12 },
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
        code,
        `Товар с длинным названием для проверки приоритетов ${code}`,
        66,
        1,
        60,
        100,
      ],
      [null, null, 'Донор', 66, 1, 60, null],
      [null, null, 'Первый', 0, 1, 8, null],
      [null, null, 'Второй', 0, 1, 4, null],
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
    ['Выбрать файл Отчёт MIN/MAX', 'priority-min.xlsx', min],
    ['Выбрать файл Отчёт поставщиков', 'priority-sup.xlsx', suppliers],
  ] as const)
    await page
      .getByLabel(label)
      .setInputFiles({
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
    .getByRole('button', { name: 'Назначить ненастроенным (12)' })
    .click();
  await page.getByRole('button', { name: 'Рассчитать перемещения' }).click();
  await expect(
    page.getByRole('checkbox', {
      name: 'Выбрать видимые предложения',
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByRole('tab', { name: 'Приоритеты', exact: true }).click();
  await page
    .getByRole('button', { name: 'Приоритеты Донор', exact: true })
    .click();
  const drawer = page.getByRole('dialog', {
    name: 'Приоритеты донора Донор',
    exact: true,
  });
  const first = drawer.getByLabel('Переместить SKU0001 Первый', {
    exact: true,
  });
  const second = drawer.getByLabel('Переместить SKU0001 Второй', {
    exact: true,
  });
  await drawer
    .getByRole('checkbox', { name: 'Приоритет SKU0001 Первый', exact: true })
    .check();
  await expect(first).toHaveValue('6');
  await drawer
    .getByRole('checkbox', { name: 'Приоритет SKU0001 Второй', exact: true })
    .check();
  await expect(first).toHaveValue('4');
  await expect(second).toHaveValue('2');
  await drawer
    .getByLabel('Распределение между выбранными')
    .selectOption('EQUAL');
  await expect(first).toHaveValue('3');
  await expect(second).toHaveValue('3');
  await second.fill('4');
  await expect(
    drawer.getByRole('alert').filter({ hasText: 'MAX' }),
  ).toBeVisible();
  await expect(second).toHaveValue('3');
  await second.fill('2');
  await expect(drawer.getByText('Вручную', { exact: true })).toBeVisible();
  await drawer
    .getByLabel('Распределение между выбранными')
    .selectOption('PROPORTIONAL');
  await expect(first).toHaveValue('3');
  await expect(second).toHaveValue('2');
  const expectFits = async () => {
    await expect
      .poll(() =>
        drawer.evaluate((root) =>
          [root, ...root.querySelectorAll('*')].every((node) => {
            const el = node as HTMLElement,
              css = getComputedStyle(el);
            return !(
              (/auto|scroll/.test(css.overflowX) &&
                el.clientWidth > 0 &&
                el.scrollWidth > el.clientWidth + 1) ||
              (/auto|scroll/.test(css.overflowY) &&
                el.clientHeight > 0 &&
                el.scrollHeight > el.clientHeight + 1)
            );
          }),
        ),
      )
      .toBe(true);
    const box = await drawer
      .getByRole('button', { name: 'К принятию перемещений', exact: true })
      .boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
  };
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 1280, height: 600 },
  ]) {
    await page.setViewportSize(size);
    await expectFits();
    await page.screenshot({
      path: testInfo.outputPath(
        `20-priorities-${size.width}-${size.height}.png`,
      ),
    });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await drawer
    .getByRole('button', { name: 'Следующие товары', exact: true })
    .click();
  await expect(drawer.getByText('SKU0001', { exact: true })).toHaveCount(0);
  await drawer
    .getByRole('button', { name: 'Предыдущие товары', exact: true })
    .click();
  await expect(second).toHaveValue('2');
  await drawer
    .getByRole('button', { name: 'К принятию перемещений', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Открыть перемещение Донор → Второй',
      exact: true,
    })
    .click();
  const transfer = page.getByRole('dialog', {
    name: 'Состав перемещения',
    exact: true,
  });
  await transfer
    .getByRole('checkbox', {
      name: 'Выбрать перемещение SKU0001 Донор → Второй',
      exact: true,
    })
    .check();
  await transfer
    .getByRole('button', {
      name: 'Принять выбранные в перемещении (1)',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', { name: 'Принять перемещения', exact: true })
    .click();
  const downloaded = page.waitForEvent('download');
  await transfer
    .getByRole('button', {
      name: 'Скачать CSV принятых позиций (1)',
      exact: true,
    })
    .click();
  const csv = readFileSync((await (await downloaded).path())!, 'utf8');
  expect(csv).toContain(';2;шт;');
  expect(csv).not.toContain('SKU0002;');
  await transfer
    .getByRole('button', { name: 'Закрыть карточку', exact: true })
    .click();
  await page.getByRole('button', { name: 'Второй', exact: true }).click();
  await expect(
    page.getByRole('row').filter({ hasText: 'SKU0001' }),
  ).toContainText('2');
  await page
    .getByRole('button', { name: 'Ребалансировка', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Приоритеты', exact: true }).click();
  await expect(
    page.getByText('Сеанс сохранён на этом компьютере', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole('button', { name: 'Приоритеты Донор', exact: true })
    .click();
  await expect(drawer.getByLabel('Распределение между выбранными')).toHaveValue(
    'PROPORTIONAL',
  );
  await expect(first).toHaveValue('3');
  await expect(drawer).toContainText('Принято: 2 шт · зафиксировано');
  await drawer.getByRole('button', { name: 'Готово', exact: true }).click();
  await page
    .getByRole('button', { name: 'Рассчитать перемещения', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Пересчитать перемещения?', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Сохранить текущий план', exact: true })
    .click();
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.remoteRequests).toEqual([]);
});

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
