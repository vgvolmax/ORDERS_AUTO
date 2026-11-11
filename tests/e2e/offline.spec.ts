import { expect, test, type Locator, type Page } from '@playwright/test';
import { cpSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import axe from 'axe-core';

function supplierLinks(page: Page, skuCode: string) {
  return page.getByRole('button', { name: `Связи ${skuCode}`, exact: true });
}

async function assignPrimary(page: Page, skuCode: string, supplier: string) {
  await supplierLinks(page, skuCode).click();
  const dialog = page.getByRole('dialog', { name: 'Связи товара', exact: true });
  await dialog.getByRole('combobox', { name: 'Основной поставщик', exact: true })
    .selectOption(supplier);
  await dialog.getByRole('button', { name: 'Сделать основным', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Текущий основной поставщик' })).toContainText(supplier);
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  await expect(dialog).toHaveCount(0);
}

test('E2E-21 all import messages are reachable and a manual pool supplier without history survives reload and CSV', async ({
  page,
}, testInfo) => {
  const { buildWorkbook } = await import('../fixtures/workbookBuilders');
  const { readFile } = await import('node:fs/promises');
  const evidence = observeRuntime(page);
  const chosenSupplier = 'ООО ТД "БИОСЕПТИК"';
  await page.context().setOffline(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href);
  const min = buildWorkbook([
    ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток', 'Цена'],
    ...Array.from({ length: 130 }, (_, index) => {
      const code = `BAD-${String(index + 1).padStart(3, '0')}`;
      return [
        [code, code, `Товар ${code}`, null, null, null, 100],
        [null, null, 'Ленина', 'ошибка', 2, 10, null],
      ];
    }).flat(),
    ['NEW', 'NEW-ARTICLE', 'Товар без истории закупок', null, null, null, 42.5],
    [null, null, 'Ленина', 0, 2, 10, null],
    ...Array.from({ length: 65 }, (_, index) => [
      [`PENDING-${index + 1}`, null, `Нераспределённый товар ${index + 1}`, null, null, null, 100],
      [null, null, 'Ленина', 0, 2, 10, null],
    ]).flat(),
  ]);
  await page.getByLabel('Выбрать файл Отчёт MIN/MAX').setInputFiles({
    name: 'all-issues.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(min),
  });
  const issues = page.getByRole('region', { name: 'Сообщения проверки: Отчёт MIN/MAX', exact: true });
  await expect(issues.getByText('Показано: 130 из 130', { exact: true })).toBeVisible();
  const scroller = issues.getByLabel('Прокрутка таблицы');
  // Bring the card's scroll surface into view before moving its own scrollbar.
  await scroller.scrollIntoViewIfNeeded();
  const geometry = await scroller.evaluate((node) => ({ height: node.clientHeight, scroll: node.scrollHeight }));
  expect(geometry.height).toBeLessThanOrEqual(320);
  expect(geometry.scroll).toBeGreaterThan(geometry.height);
  await scroller.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect(issues.getByText('BAD-130', { exact: true })).toBeInViewport();
  await issues.getByRole('textbox', { name: 'Поиск сообщений: Отчёт MIN/MAX' }).fill('BAD-130');
  await expect(issues.getByText('Показано: 1 из 130', { exact: true })).toBeVisible();
  const severity = issues.getByRole('combobox', { name: 'Важность сообщений: Отчёт MIN/MAX' });
  await severity.selectOption('WARNING');
  await expect(issues.getByText('Нет сообщений по выбранным фильтрам.', { exact: true })).toBeVisible();
  await severity.selectOption('ALL');
  await issues.getByRole('button', { name: 'Очистить поиск', exact: true }).click();
  await expect(issues.getByRole('textbox')).toBeFocused();
  await page.setViewportSize({ width: 1024, height: 768 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('21-all-import-issues.png'), fullPage: true });
  await page.getByLabel('Выбрать файл Отчёт поставщиков').setInputFiles({
    name: 'other-products.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(buildWorkbook([
      ['Контрагент', 'Код', 'Номенклатура', 'Количество', 'Стоимость', 'Ед. изм.'],
      ['ИП Баранов Роман Борисович', 'OTHER', 'Другой товар', 10, 1000, 'шт'],
    ])),
  });
  await page.getByRole('button', { name: 'Перейти к потребности', exact: true }).click();
  await page.getByRole('button', { name: 'Поставщики', exact: true }).click();
  await page.getByRole('textbox', { name: 'Поиск товара', exact: true }).fill('NEW-ARTICLE');
  await assignPrimary(page, 'NEW', 'ООО "Терем"');
  await assignPrimary(page, 'NEW', chosenSupplier);
  await page.screenshot({ path: testInfo.outputPath('21-pool-supplier-select.png'), fullPage: true });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Поставщики', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Поиск товара', exact: true }).fill('NEW-ARTICLE');
  const product = page.getByRole('row').filter({ has: supplierLinks(page, 'NEW') });
  await expect(product).toContainText(chosenSupplier);
  await page.getByRole('button', { name: 'Все товары', exact: true }).click();
  const filter = page.getByRole('combobox', { name: 'Поставщик', exact: true });
  await filter.selectOption(chosenSupplier);
  await expect(page.getByText('Товар без истории закупок', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Заказы', exact: true }).click();
  await page.locator('.order-cell').filter({ hasText: '425,00' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('Цена MIN/MAX', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await drawer.getByRole('button', { name: 'Скачать CSV заказа', exact: true }).click();
  const csv = await readFile((await (await downloadPromise).path())!, 'utf8');
  expect(csv).toContain('NEW;NEW-ARTICLE;Товар без истории закупок;Ленина;');
  expect(csv).toContain('БИОСЕПТИК');
  expect(csv).toContain(';10;;42.5;425');
  expect(csv).not.toContain('OTHER');
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.remoteRequests).toEqual([]);
});

test('E2E-20 bulk revoke respects SKU search and direction filters, survives reload and restores purchasing', async ({
  page,
}, testInfo) => {
  const { buildWorkbook } = await import('../fixtures/workbookBuilders');
  const evidence = observeRuntime(page);
  const codes = ['CANCEL-A', 'CANCEL-B'];
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
      [code, `ART-${code}`, `Товар отмены ${code}`, 180, null, null, 100],
      [null, null, 'Донор А', 75, 20, 60, null],
      [null, null, 'Донор Б', 95, 20, 60, null],
      [null, null, 'Получатель', 10, 20, 60, null],
    ]),
  ]);
  const sup = buildWorkbook([
    [
      'Контрагент',
      'Код',
      'Номенклатура',
      'Количество',
      'Стоимость',
      'Ед. изм.',
    ],
    ...codes.map((code) => [
      'ИП Баранов Роман Борисович',
      code,
      `Товар отмены ${code}`,
      1,
      100,
      'шт',
    ]),
  ]);
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href);
  for (const [label, name, bytes] of [
    ['Выбрать файл Отчёт MIN/MAX', 'revoke-min.xlsx', min],
    ['Выбрать файл Отчёт поставщиков', 'revoke-sup.xlsx', sup],
  ] as const) {
    await page
      .getByLabel(label)
      .setInputFiles({
        name,
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from(bytes),
      });
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText('Обработка отчёта…', { exact: true }),
    ).toHaveCount(0);
  }
  await page
    .getByRole('button', { name: 'Перейти к потребности', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Перемещения', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Рассчитать перемещения', exact: true })
    .click();
  await page
    .getByRole('checkbox', { name: 'Выбрать видимые предложения', exact: true })
    .check();
  await page
    .getByRole('button', { name: 'Принять выбранные (4)', exact: true })
    .click();
  let confirmation = page.getByRole('dialog', {
    name: 'Принять выбранные перемещения',
    exact: true,
  });
  await confirmation
    .getByRole('button', { name: 'Принять перемещения', exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await page
    .getByRole('button', {
      name: 'Открыть перемещение Донор А → Получатель',
      exact: true,
    })
    .click();
  let drawer = page.getByRole('dialog', {
    name: 'Состав перемещения',
    exact: true,
  });
  await drawer
    .getByRole('checkbox', {
      name: 'Выбрать все принятые по поиску',
      exact: true,
    })
    .check();
  await drawer
    .getByLabel('Поиск по составу перемещения', { exact: true })
    .fill('CANCEL-A');
  await expect(
    drawer.getByText(/Скрыто поиском: 1; в отмену не попадут/),
  ).toBeVisible();
  await drawer
    .getByRole('button', {
      name: 'Отменить выбранные принятые (1)',
      exact: true,
    })
    .click();
  confirmation = page.getByRole('dialog', {
    name: 'Отменить принятие перемещения',
    exact: true,
  });
  await expect(confirmation).toContainText('Строк: 1.');
  await expect(
    confirmation.getByRole('group', { name: 'Изменение закупки', exact: true }),
  ).toContainText('1 500,00');
  await confirmation
    .getByRole('button', { name: 'Отменить принятие', exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await expect(drawer).toContainText('Принято строк: 1 из 2');
  await drawer
    .getByRole('button', { name: 'Закрыть карточку', exact: true })
    .click();
  await page.reload();
  await page.getByRole('tab', { name: 'Принятые', exact: true }).click();
  await page
    .getByLabel('Отправитель принятых', { exact: true })
    .selectOption({ label: 'Донор Б' });
  await page
    .getByRole('checkbox', {
      name: 'Выбрать все направления по фильтрам',
      exact: true,
    })
    .check();
  await page
    .getByRole('button', {
      name: 'Отменить принятие выбранных направлений (1)',
      exact: true,
    })
    .click();
  confirmation = page.getByRole('dialog', {
    name: 'Отменить принятие перемещений',
    exact: true,
  });
  await expect(confirmation).toContainText('Строк: 2.');
  await expect(confirmation).toContainText('Донор: Донор Б.');
  await confirmation
    .getByRole('button', { name: 'Отменить принятие', exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Сбросить фильтры принятых', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Принятые перемещения · 1',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'CSV Донор Б → Получатель', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Все товары', exact: true }).click();
  const indicator = page.getByRole('button', {
    name: 'Учтённые перемещения CANCEL-B',
    exact: true,
  });
  await expect(indicator).toBeVisible();
  const geometry = await indicator.evaluate((el) => {
    const cell = el.closest('[role="cell"]')!,
      rect = el.getBoundingClientRect();
    const count = el
      .querySelector('.movement-indicator-count')!
      .getBoundingClientRect();
    const label = el
      .querySelector('.movement-indicator-label')!
      .getBoundingClientRect();
    const outer = cell.getBoundingClientRect();
    return {
      fits: rect.left >= outer.left && rect.right <= outer.right,
      sameLine: Math.abs(count.top - label.top) <= 1,
    };
  });
  expect(geometry).toEqual({ fits: true, sameLine: true });
  await indicator.click();
  const movements = page.getByRole('dialog', {
    name: 'Учтённые перемещения',
    exact: true,
  });
  const totals = movements.locator('.movement-totals');
  await expect(totals).toContainText('Текущая потребность');
  await expect(totals).toContainText('35');
  await page.screenshot({
    path: testInfo.outputPath('20-restored-purchasing.png'),
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Перемещения', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Принятые', exact: true }).click();
  await page
    .getByRole('button', { name: 'Состав Донор А → Получатель', exact: true })
    .click();
  drawer = page.getByRole('dialog', {
    name: 'Принято: Донор А → Получатель',
    exact: true,
  });
  await drawer
    .getByRole('checkbox', {
      name: 'Выбрать все принятые по поиску',
      exact: true,
    })
    .check();
  await drawer
    .getByRole('button', {
      name: 'Отменить выбранные принятые (1)',
      exact: true,
    })
    .click();
  confirmation = page.getByRole('dialog', {
    name: 'Отменить принятие перемещения',
    exact: true,
  });
  await confirmation
    .getByRole('button', { name: 'Отменить принятие', exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await expect(drawer).toContainText('В этом направлении больше нет позиций.');
  await drawer
    .getByRole('button', { name: 'Закрыть карточку', exact: true })
    .click();
  await expect(
    page.getByText(
      'Принятых перемещений пока нет. Примите предложения на вкладке «Результаты».',
      { exact: true },
    ),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(
      'Принятых перемещений пока нет. Примите предложения на вкладке «Результаты».',
      { exact: true },
    ),
  ).toBeVisible();
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.remoteRequests).toEqual([]);
});

test('E2E-19 stable rebalancing chrome and accepted route register export full compositions offline', async ({
  page,
}, testInfo) => {
  const { buildWorkbook } = await import('../fixtures/workbookBuilders');
  const evidence = observeRuntime(page);
  const names = Array.from(
    { length: 12 },
    (_, i) => `Склад ${String(i + 1).padStart(2, '0')}`,
  );
  const codes = names.flatMap((_, i) => [
    `AC${String(i).padStart(2, '0')}A`,
    `AC${String(i).padStart(2, '0')}B`,
  ]);
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
    ...codes.flatMap((code, i) => [
      [code, `ART-${code}`, `Принятый товар ${code}`, 111, null, null, 1000],
      ...names.map((name, j) => [
        null,
        null,
        name,
        j === Math.floor(i / 2) ? 111 : 0,
        j === Math.floor(i / 2) ? 0 : 1,
        j === Math.floor(i / 2) ? 100 : 1,
        null,
      ]),
    ]),
  ]);
  const sup = buildWorkbook([
    [
      'Контрагент',
      'Код',
      'Номенклатура',
      'Количество',
      'Стоимость',
      'Ед. изм.',
    ],
    ...codes.map((code) => [
      'ИП Баранов Роман Борисович',
      code,
      `Принятый товар ${code}`,
      1,
      1000,
      'шт',
    ]),
  ]);
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href);
  for (const [label, name, bytes] of [
    ['Выбрать файл Отчёт MIN/MAX', 'accepted-min.xlsx', min],
    ['Выбрать файл Отчёт поставщиков', 'accepted-sup.xlsx', sup],
  ] as const) {
    await page.getByLabel(label).setInputFiles({
      name,
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(bytes),
    });
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText('Обработка отчёта…', { exact: true }),
    ).toHaveCount(0);
  }
  await page
    .getByRole('button', { name: 'Перейти к потребности', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Перемещения', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Рассчитать перемещения', exact: true })
    .click();
  await page
    .getByRole('checkbox', { name: 'Выбрать видимые предложения', exact: true })
    .check();
  await page
    .getByRole('button', { name: 'Принять выбранные (264)', exact: true })
    .click();
  const confirmation = page.getByRole('dialog', {
    name: 'Принять выбранные перемещения',
    exact: true,
  });
  await confirmation
    .getByRole('button', { name: 'Принять перемещения', exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  const frame = () =>
    page.evaluate(() =>
      [
        '.rebalancing-page > header',
        '.rebalancing-page > .coverage-metrics',
        '.rebalancing-page > .workspace-tabs',
      ].map((selector) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
  for (const height of [600, 720]) {
    await page.setViewportSize({ width: 1280, height });
    await page.getByRole('tab', { name: 'Маршруты', exact: true }).click();
    const reference = await frame();
    for (const label of ['Условия', 'Результаты', 'Принятые', 'Маршруты']) {
      await page.getByRole('tab', { name: label, exact: true }).click();
      await expect(
        page.getByRole('tab', { name: label, exact: true }),
      ).toHaveAttribute('aria-selected', 'true');
      await expect
        .poll(async () => {
          const actual = await frame();
          return actual.flatMap((box, i) =>
            (Object.keys(box) as Array<keyof typeof box>)
              .filter((key) => Math.abs(box[key] - reference[i]![key]) > 1)
              .map(
                (key) =>
                  `${label}: ${i}.${key}: ${box[key]} vs ${reference[i]![key]}`,
              ),
          );
        })
        .toEqual([]);
    }
    await page.getByRole('tab', { name: 'Принятые', exact: true }).click();
    await expect(
      page.getByRole('heading', {
        name: 'Принятые перемещения · 132',
        exact: true,
      }),
    ).toBeVisible();
    const scroll = page.locator('.accepted-table-frame .virtual-scroll');
    await expect
      .poll(() => scroll.evaluate((el) => el.scrollHeight > el.clientHeight))
      .toBe(true);
    await expect
      .poll(() => page.locator('.accepted-table-frame [role="row"]').count())
      .toBeLessThan(60);
    const box = await scroll.boundingBox();
    expect(box!.height).toBeGreaterThan(100);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(
      page.getByLabel('Выбрать Склад 12 → Склад 11', { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            Math.max(
              document.documentElement.scrollHeight,
              document.body.scrollHeight,
            ) - innerHeight,
        ),
      )
      .toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`19-accepted-${height}.png`),
      fullPage: true,
    });
  }
  await page
    .getByRole('checkbox', {
      name: 'Выбрать все направления по фильтрам',
      exact: true,
    })
    .check();
  await page
    .getByLabel('Поиск принятых перемещений', { exact: true })
    .fill('AC00A');
  await expect(
    page.getByText('Выбрано: 132 · Скрыто фильтрами: 121', { exact: true }),
  ).toBeVisible();
  const downloadAll = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'CSV выбранных (132)', exact: true })
    .click();
  const all = await downloadAll;
  const allCsv = readFileSync((await all.path())!, 'utf8');
  expect(allCsv.match(/Код;Артикул;/g)).toHaveLength(1);
  expect(allCsv.split('\r\n')).toHaveLength(266);
  expect(allCsv).toContain('AC11B;');
  await page
    .getByLabel('Получатель принятых', { exact: true })
    .selectOption({ label: 'Склад 02' });
  const downloadOne = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'CSV Склад 01 → Склад 02', exact: true })
    .click();
  const one = await downloadOne;
  expect(one.suggestedFilename()).toMatch(/^Перемещение__Склад 01__Склад 02__/);
  const oneCsv = readFileSync((await one.path())!, 'utf8');
  expect(oneCsv).toContain('AC00A;');
  expect(oneCsv).toContain('AC00B;');
  expect(oneCsv.split('\r\n')).toHaveLength(4);
  await page
    .getByRole('button', { name: 'Состав Склад 01 → Склад 02', exact: true })
    .click();
  const composition = page.getByRole('dialog', {
    name: 'Принято: Склад 01 → Склад 02',
    exact: true,
  });
  await expect(composition.getByText('AC00B', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(composition).toHaveCount(0);
  await page
    .getByText('Сохранение сеанса…', { exact: true })
    .waitFor({ state: 'hidden' });
  await page.reload();
  await expect(
    page.getByRole('tab', { name: 'Принятые', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByLabel('Поиск принятых перемещений', { exact: true }),
  ).toHaveValue('AC00A');
  await expect(
    page
      .getByLabel('Получатель принятых', { exact: true })
      .locator('option:checked'),
  ).toHaveText('Склад 02');
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.remoteRequests).toEqual([]);
});

test('E2E-18 one SKU per donor-recipient must meet the minimum; other SKUs and donors cannot subsidize it', async ({
  page,
}, testInfo) => {
  const { buildWorkbook } = await import('../fixtures/workbookBuilders');
  const { readFile } = await import('node:fs/promises');
  const evidence = observeRuntime(page);
  await page.context().setOffline(true);
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
    ['AMOUNT-A', 'A-1', 'Первый товар документа', 303, null, null, 1000],
    [null, null, 'Егорьевск', 203, 0, 100, null],
    [null, null, 'Ленина', 100, 0, 100, null],
    [null, null, 'ОреховоЗуево', 0, 3, 3, null],
    ['AMOUNT-B', 'B-1', 'Второй товар документа', 219, null, null, 339.3],
    [null, null, 'Егорьевск', 115, 0, 100, null],
    [null, null, 'Ленина', 104, 0, 100, null],
    [null, null, 'ОреховоЗуево', 0, 19, 19, null],
    ['AMOUNT-C', 'C-1', 'Равенство порогу', 210, null, null, 500],
    [null, null, 'Егорьевск', 110, 0, 100, null],
    [null, null, 'Ленина', 100, 0, 100, null],
    [null, null, 'ОреховоЗуево', 0, 10, 10, null],
  ]);
  const sup = buildWorkbook([
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
      'AMOUNT-A',
      'Первый товар документа',
      1,
      1000,
      'шт',
    ],
    [
      'ИП Баранов Роман Борисович',
      'AMOUNT-B',
      'Второй товар документа',
      1,
      339.3,
      'шт',
    ],
    [
      'ИП Баранов Роман Борисович',
      'AMOUNT-C',
      'Равенство порогу',
      1,
      500,
      'шт',
    ],
  ]);
  for (const [label, name, bytes] of [
    ['Выбрать файл Отчёт MIN/MAX', 'document-min.xlsx', min],
    ['Выбрать файл Отчёт поставщиков', 'document-sup.xlsx', sup],
  ] as const) {
    await page.getByLabel(label).setInputFiles({
      name,
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(bytes),
    });
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText('Обработка отчёта…', { exact: true }),
    ).toHaveCount(0);
  }
  await page
    .getByRole('button', { name: 'Перейти к потребности', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Перемещения', exact: true })
    .click();
  const stock = page.getByRole('checkbox', { name: 'Остаток', exact: true });
  const timesTwo = page.getByRole('radio', { name: '×2', exact: true });
  const timesThree = page.getByRole('radio', { name: '×3', exact: true });
  await expect(stock).not.toBeChecked();
  await expect(timesTwo).toBeChecked();
  await expect(timesTwo).toBeDisabled();
  await expect(timesThree).toBeDisabled();
  await expect(timesTwo.locator('..')).toHaveCSS('cursor', 'not-allowed');
  await page
    .getByRole('checkbox', {
      name: 'Минимальная сумма SKU в перемещении',
      exact: true,
    })
    .check();
  await page.getByLabel('Порог суммы SKU', { exact: true }).fill('5000');
  await expect(page.getByLabel('Порог цены', { exact: true })).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Рассчитать перемещения', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Перемещения по направлениям · 1',
      exact: true,
    }),
  ).toBeVisible();
  const route = page.getByRole('button', {
    name: 'Открыть перемещение Егорьевск → ОреховоЗуево',
    exact: true,
  });
  await expect(route).toContainText('10 089,50');
  await expect(route).toContainText('2 SKU');
  await expect(
    page.getByRole('button', {
      name: 'Открыть перемещение Ленина → ОреховоЗуево',
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByText(/Исключения и проверки данных/).click();
  await expect(
    page.getByText('Сумма SKU в перемещении ниже порога', { exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByText('Ленина → ОреховоЗуево', { exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Условия', exact: true }).click();
  await stock.check();
  await expect(timesTwo.locator('..')).toHaveCSS('cursor', 'pointer');
  await stock.focus();
  await page.keyboard.press('Tab');
  await expect(timesTwo).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(timesThree).toBeFocused();
  await expect(timesThree).toBeChecked();
  await expect(timesThree.locator('..')).toHaveCSS('outline-style', 'solid');
  await expect(timesTwo.locator('..')).not.toHaveCSS(
    'background-image', await timesThree.locator('..').evaluate((e) => getComputedStyle(e).backgroundImage),
  );
  await page.screenshot({ path: testInfo.outputPath('23-stock-multiplier-3.png') });
  const calculate = page.getByRole('button', { name: 'Рассчитать перемещения', exact: true });
  await calculate.click();
  await expect(route).toContainText('2 SKU');

  await page.getByRole('tab', { name: 'Условия', exact: true }).click();
  await timesTwo.locator('..').click();
  await expect(timesTwo).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('23-stock-multiplier-2.png') });
  await calculate.click();
  await expect(route).toContainText('13 089,50');
  await expect(route).toContainText('3 SKU');
  await page
    .getByRole('checkbox', { name: 'Выбрать видимые предложения', exact: true })
    .check();
  await page
    .getByRole('button', { name: 'Принять выбранные (3)', exact: true })
    .click();
  const confirmation = page.getByRole('dialog', {
    name: 'Принять выбранные перемещения',
    exact: true,
  });
  await confirmation
    .getByRole('button', { name: 'Принять перемещения', exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'Перемещения по направлениям · 1',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Условия', exact: true }).click();
  await expect(page.getByLabel('Порог суммы SKU', { exact: true })).toHaveValue(
    '5000',
  );
  await expect(
    page.getByRole('checkbox', {
      name: 'Минимальная сумма SKU в перемещении',
      exact: true,
    }),
  ).toBeChecked();
  await expect(stock).toBeChecked();
  await expect(timesTwo).toBeChecked();
  await page.getByRole('tab', { name: 'Результаты', exact: true }).click();
  await route.click();
  const downloaded = page.waitForEvent('download');
  await page
    .getByRole('dialog')
    .getByRole('button', {
      name: 'Скачать CSV принятых позиций (3)',
      exact: true,
    })
    .click();
  const download = await downloaded;
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('AMOUNT-A');
  expect(csv).toContain(';ОреховоЗуево;3;шт;1000;3000');
  expect(csv).toContain(';ОреховоЗуево;10;шт;500;5000');
  expect(csv).toContain(';ОреховоЗуево;15;шт;339.3;5089.5');
  expect(csv).not.toContain('Ленина');
  await page.screenshot({
    path: testInfo.outputPath('18-transfer-sku-amount.png'),
    fullPage: true,
  });
  expect(evidence.remoteRequests).toEqual([]);
  expect(evidence.pageErrors).toEqual([]);
});

test('E2E-17 calculation integrity survives import, export and reload offline', async ({
  page,
}, testInfo) => {
  const { buildWorkbook } = await import('../fixtures/workbookBuilders');
  const { readFile } = await import('node:fs/promises');
  const supplier = 'ИП Баранов Роман Борисович';
  const mh = [
    'Код',
    'Артикул',
    'Номенклатура',
    'Количество',
    'Минимальный остаток',
    'Максимальный остаток',
    'Цена',
  ];
  const sh = [
    'Контрагент',
    'Код',
    'Номенклатура',
    'Количество',
    'Стоимость',
    'Ед. изм.',
  ];
  const parent = (code: string, price: number | null = 100) => [
    code,
    code,
    'Товар ' + code,
    null,
    null,
    null,
    price,
  ];
  const stock = (branch: string, qty: unknown = 0, max = 1) => [
    null,
    null,
    branch,
    qty,
    Math.min(1, max),
    max,
    null,
  ];
  const hist = (code: string, amount: number | null, qty = 1) => [
    supplier,
    code,
    'Товар ' + code,
    qty,
    amount,
    'шт',
  ];
  const upload = async (min: unknown[][], sup?: unknown[][]) => {
    const files: [string, string, unknown[][]][] = [
      ['Выбрать файл Отчёт MIN/MAX', 'audit-min.xlsx', [mh, ...min]],
    ];
    if (sup) files.push(['Выбрать файл Отчёт поставщиков', 'audit-sup.xlsx', [sh, ...sup]]);
    for (const [label, name, rows] of files) {
      await page.getByLabel(label).setInputFiles({
        name,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from(buildWorkbook(rows)),
      });
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Обработка отчёта…', { exact: true })).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Перейти к потребности' }).click();
    await page.getByRole('button', { name: 'Заказы', exact: true }).click();
  };
  const evidence = observeRuntime(page);
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href);
  await upload(
    [
      parent('FALLBACK'),
      stock('Ленина'),
      parent('DEC1', 10.1),
      stock('Раменское'),
      parent('DEC2', 20.2),
      stock('Раменское'),
    ],
    [
      hist('FALLBACK', null, 10), hist('DEC1', 1), hist('DEC2', 2),
      hist('DUP', 100), hist('OMITTED', 100), hist('PRICE', 0, 0),
      hist('NEG', 0, 0), hist('GOOD', 100),
    ],
  );
  await page.getByLabel('Минимальная сумма закупки, ₽').fill('30.3');
  await expect(
    page.getByRole('button', { name: 'Скачать все (2)', exact: true }),
  ).toBeEnabled();
  const decimalCell = page.locator('.order-cell').filter({ hasText: '30,30' });
  await decimalCell.click();
  const order = page.getByRole('dialog');
  const downloaded = page.waitForEvent('download');
  await order
    .getByRole('button', { name: 'Скачать CSV заказа', exact: true })
    .click();
  const download = await downloaded;
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain(';10.1;10.1');
  expect(csv).toContain(';20.2;20.2');
  expect(csv).not.toContain('999999');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Скачать все (2)', exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel('Минимальная сумма закупки, ₽')).toHaveValue(
    '30.3',
  );
  await page.getByRole('button', { name: 'Обновить MIN/MAX', exact: true }).click();
  await expect(page.getByLabel('Выбрать файл Отчёт поставщиков')).toHaveCount(0);
  await upload([
    parent('DUP'),
    stock('Ленина', 0, 10),
    stock('Ленина', 8, 10),
    parent('OMITTED'),
    stock('Щурово', 'ошибка', 10),
    parent('PRICE', 100),
    stock('Ленина'),
    parent('PRICE', 200),
    stock('Ступино'),
    parent('NEG', -100),
    stock('Ленина'),
    parent('GOOD'),
    stock('Раменское'),
  ]);
  await expect(
    page.getByText('Расчёт неполный: есть ошибки в MIN/MAX'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Скачать все (1)', exact: true }),
  ).toBeEnabled();
  const blocked = page
    .locator('.order-cell')
    .filter({ hasText: 'Ошибка данных MIN/MAX: DUP' });
  await blocked.click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: 'Скачать CSV заказа', exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByText('Расчёт неполный: есть ошибки в MIN/MAX'),
  ).toBeVisible();
  await page.getByText(/Показать ошибки MIN\/MAX/).click();
  await expect(
    page.getByText(/Некорректные числовые данные.*OMITTED.*Щурово/),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('17-calculation-integrity.png'),
    fullPage: true,
  });
  expect(evidence.remoteRequests).toEqual([]);
  expect(evidence.pageErrors).toEqual([]);
});

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
  expect(
    await page.evaluate(async () => {
      await document.fonts.load('14px Inter', 'Привет ₽012345');
      return document.fonts.check('14px Inter', 'Привет ₽012345');
    }),
  ).toBe(true);
  expect(
    readFileSync(path.join(packageDirectory, 'FONT-LICENSE.txt'), 'utf8'),
  ).toContain('SIL OPEN FONT LICENSE');
  await expect(page.getByText('Отчёт MIN/MAX', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Отчёт поставщиков', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('«Волмакс Буст» запускается…', { exact: true }),
  ).toHaveCount(0);
  await expect(page).toHaveTitle('Волмакс Буст');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', './assets/volmax-mark.svg');

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
    page.getByText(/2 поставщиков в рабочем пуле/),
  ).toBeVisible();
  await expect(page.getByText(/Без основного поставщика/)).toContainText('2');
  await expect(page.getByText(/Из них с дополнительными/)).toContainText('1');
  await page.getByRole('button', { name: 'Перейти к потребности' }).click();
  const filter = page.getByRole('combobox', { name: 'Поставщик', exact: true });
  await expect(filter.locator('option')).toHaveText([
    'Все поставщики',
    'Не выбран поставщик',
    allowed,
    secondAllowed,
  ]);
  await page.getByRole('button', { name: 'Поставщики', exact: true }).click();
  await supplierLinks(page, 'SKU3').click();
  const choice = page.getByRole('dialog', { name: 'Связи товара', exact: true });
  const selector = choice.getByRole('combobox', { name: 'Основной поставщик', exact: true });
  await expect(selector.locator('option')).toHaveCount(33);
  await expect(selector.locator('option').filter({ hasText: hidden })).toHaveCount(0);
  const alternatives = choice.getByRole('region', { name: 'Текущие дополнительные поставщики' });
  await expect(alternatives.getByRole('listitem')).toHaveText([
    allowed + 'Удалить', secondAllowed + 'Удалить',
  ]);
  await choice.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  await assignPrimary(page, 'SKU3', secondAllowed);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Поставщики', exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ has: supplierLinks(page, 'SKU3') }))
    .toContainText(secondAllowed);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: testInfo.outputPath('11-approved-suppliers-narrow-1024.png'), fullPage: true });
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
    .getByRole('button', { name: 'Перемещения', exact: true })
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
  await expect(page.getByLabel('Шаг для ненастроенных SKU')).toHaveCount(0);
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
  await expect(transferDrawer).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Открыть перемещение Донор А → Получатель' })
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
  await page.getByRole('button', { name: 'Открыть перемещения' }).click();
  await expect(
    page.getByRole('heading', { name: 'Перемещения', exact: true }),
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
  await page.getByRole('button', { name: /Все заказы ИП Баранов/ }).click();
  const supplierQty = page.getByLabel('Количество SKU1 Получатель', {
    exact: true,
  });
  const supplierReview = page.getByRole('checkbox', {
    name: 'Проверен Получатель',
    exact: true,
  });
  await expect(supplierQty).toHaveValue('40');
  await expect(supplierReview).toBeChecked();
  await supplierQty.fill('41.5');
  await expect(supplierReview).not.toBeChecked();
  await supplierReview.click();
  await expect(supplierReview).toBeChecked();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath('03-supplier-matrix-1440.png'),
  });
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByRole('button', { name: /SKU · Готов/ })).toBeVisible();
  const xlsxDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel все' }).click();
  const xlsx = await xlsxDownload,
    workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readWorkbook((await xlsx.path())!));
  expect(workbook.getWorksheet('Получатель')!.getCell('D9').value).toBe(41.5);
  await expect(
    page.getByText('Сеанс сохранён на этом компьютере', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Заказы', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /SKU · Выгружен/ }).click();
  await expect(page.getByLabel('Количество SKU1', { exact: true })).toHaveValue(
    '41.5',
  );
  await expect(
    page.getByRole('checkbox', { name: 'Заказ проверен' }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page
    .getByRole('button', { name: 'Перемещения', exact: true })
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
  await page.getByRole('button', { name: 'Excel перемещений' }).click();
  const exported = await rebalanceDownload,
    report = new ExcelJS.Workbook();
  await report.xlsx.load(await readWorkbook((await exported.path())!));
  expect(report.getWorksheet('Принятые')!.getCell('D2').value).toBe(15);
  expect(report.getWorksheet('Предложения')!.getCell('D2').value).toBe(5);
  await page.getByRole('button', { name: 'Обновить MIN/MAX', exact: true }).click();
  await page.getByLabel('Выбрать файл Отчёт MIN/MAX').setInputFiles({
    name: 'week-2.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(min),
  });
  await expect(page.getByText('week-2.xlsx', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'История сеансов' }).click();
  const archived = page
    .getByRole('row')
    .filter({ hasText: 'min.xlsx' })
    .filter({ hasText: 'sup.xlsx' })
    .filter({ has: page.getByRole('button', { name: 'Восстановить', exact: true }) });
  // Each startup report may have created a partial snapshot. Restore the latest
  // complete pre-update snapshot, which contains the decisions made in the test.
  await archived.first()
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
  test(`E2E-09 transfer drawer ${count} rows uses one bounded scroll surface and exports accepted CSV`, async ({
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
      .getByRole('button', { name: 'Перемещения', exact: true })
      .click();
    await page.getByRole('tab', { name: 'Условия' }).click();
    await expect(page.getByLabel('Шаг для ненастроенных SKU')).toHaveCount(0);
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
    const expectContainedScroll = () =>
      expect
        .poll(() =>
          drawer.evaluate((root) => {
            const box = root.getBoundingClientRect();
            const outside =
              box.left < 0 ||
              box.top < 0 ||
              box.right > innerWidth ||
              box.bottom > innerHeight;
            const owners = [...root.querySelectorAll('*')].filter((node) => {
              const el = node as HTMLElement,
                style = getComputedStyle(el);
              return (
                (/auto|scroll/.test(style.overflowX) &&
                  el.scrollWidth > el.clientWidth + 1) ||
                (/auto|scroll/.test(style.overflowY) &&
                  el.scrollHeight > el.clientHeight + 1)
              );
            });
            return (
              !outside &&
              root.scrollHeight <= root.clientHeight + 1 &&
              root.scrollWidth <= root.clientWidth + 1 &&
              owners.every((el) => el.classList.contains('virtual-scroll'))
            );
          }),
        )
        .toBe(true);
    const expectFooter = async () => {
      await expectContainedScroll();
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height);
      // The notification may expire between drawer actions.
      const toastBox = await page.evaluate(() =>
        document.querySelector('.toast')?.getBoundingClientRect().toJSON(),
      );
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
      expect(owners).toBeLessThanOrEqual(1);
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
      expect(verticalOwners).toBe(1);
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
    await viewport.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
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
      await expectContainedScroll();
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
    await expect(confirm).toContainText('Донор: Егорьевск');
    const acceptanceFrame = await confirm
      .locator('.virtual-scroll')
      .boundingBox();
    const consequence = await confirm
      .getByRole('columnheader', { name: 'Было → станет', exact: true })
      .boundingBox();
    expect(consequence!.x).toBeGreaterThanOrEqual(acceptanceFrame!.x);
    expect(consequence!.x + consequence!.width).toBeLessThanOrEqual(
      acceptanceFrame!.x + acceptanceFrame!.width + 1,
    );
    await confirm
      .getByRole('button', { name: 'Принять перемещения', exact: true })
      .click();
    await expect(confirm).toHaveCount(0);
    await expect(drawer).toHaveCount(0);
    await cell.click();
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
  codes = ['FULL1', 'FULL2', 'SKIP14'],
  articleForCode = (code: string) => `Артикул ${code}`,
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
    ...codes.flatMap((code) => {
      const firstDonor = code === 'SKIP14' ? 16 : 18;
      return [
        [
          code,
          articleForCode(code),
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
    ...codes.map((code) => [
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
    .getByRole('button', { name: 'Перемещения', exact: true })
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
  await expect(page.getByLabel('Шаг для ненастроенных SKU')).toHaveCount(0);
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
    const activityTarget = await matrix
      .getByRole('checkbox', { name: 'Участие Донор А', exact: true })
      .first()
      .evaluate((input) => {
        const label = input.closest('label');
        if (!label) return null;
        const rect = label.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
    expect(activityTarget).not.toBeNull();
    expect(activityTarget!.width).toBeGreaterThanOrEqual(24);
    expect(activityTarget!.height).toBeGreaterThanOrEqual(24);
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

test('E2E-11 partial coverage preserves twelve units, two remain, and accepted subsets survive offline', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const evidence = observeRuntime(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await importFullCoverageFixture(page);
  await configureFullCoverage(page);
  await expect(
    coverageMetric(page, 'К перемещению').locator('.coverage-quantity'),
  ).toHaveText('40 шт');
  const skippedMetric = coverageMetric(page, 'Не распределено');
  await expect(skippedMetric.locator('.coverage-quantity')).toHaveText('2 шт');
  await expect(skippedMetric).toContainText('200,00');
  await expect(skippedMetric).toContainText('1 SKU');
  await expect(coverageMetric(page, 'Принято на сумму')).toContainText('0,00');
  await expect(
    page.getByRole('heading', {
      name: 'Перемещения по направлениям · 2',
      exact: true,
    }),
  ).toBeVisible();
  // An incomplete network is not a veto: both six-unit lines remain proposed.
  const resultsQuery = page.getByRole('textbox', {
    name: 'Поиск по коду, артикулу, товару и маршруту',
    exact: true,
  });
  await resultsQuery.fill('SKIP14');
  await expect(
    page.getByRole('button', { name: /^Открыть перемещение / }),
  ).toHaveCount(2);
  await expect(
    page.getByRole('checkbox', {
      name: 'Выбрать видимые предложения',
      exact: true,
    }),
  ).toBeEnabled();
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
  await expect(skippedRow).toContainText('Предложено: 12');
  await expect(skippedRow).toContainText('Осталось: 2');
  await expect(skippedRow).toContainText('Недостаточно излишка сверх Max');
  await expect(skippedRow).toContainText('200,00');
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
    path: testInfo.outputPath('21-skipped-partial-need.png'),
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
  await expect(route).toContainText('3 SKU');
  await expect(route).toContainText('22 шт');
  await route.click();
  const transfer = page.getByRole('dialog', {
    name: 'Состав перемещения',
    exact: true,
  });
  await expect(
    transfer.getByRole('row').filter({ hasText: 'SKIP14' }),
  ).toContainText('Предложено');
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
  await expect(transfer).toHaveCount(0);
  await route.click();
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
  ).toHaveText('32 шт');
  await expect(coverageMetric(page, 'Принято на сумму')).toContainText(
    '800,00',
  );
  await expect(skippedMetric.locator('.coverage-quantity')).toHaveText('2 шт');

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
    .getByRole('button', { name: 'Перемещения', exact: true })
    .click();
  await expect(
    page.getByText('Сеанс сохранён на этом компьютере', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(coverageMetric(page, 'Принято на сумму')).toContainText(
    '800,00',
  );
  await expect(skippedMetric.locator('.coverage-quantity')).toHaveText('2 шт');
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
    .getByRole('button', { name: 'Перемещения', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Результаты', exact: true }).click();
  await route.click();
  await expect(
    transfer.getByRole('row').filter({ hasText: 'FULL1' }),
  ).toContainText('Принято');
  const unacceptedRow = transfer.getByRole('row').filter({ hasText: 'FULL2' });
  await unacceptedRow.scrollIntoViewIfNeeded();
  await expect(unacceptedRow.getByRole('checkbox')).toBeDisabled();

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

test('E2E-13 monetary threshold rolls back after an offline storage failure and survives retry/reload', async ({
  page,
}) => {
  const { buildMinMaxFixture, buildSupplierFixture } = await import(
    '../fixtures/workbookBuilders'
  );
  const evidence = observeRuntime(page);
  await expectOfflineApp(page, resolve('dist/ORDERS_AUTO'));
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const [label, name, bytes] of [
    ['Выбрать файл Отчёт MIN/MAX', 'min.xlsx', buildMinMaxFixture()],
    ['Выбрать файл Отчёт поставщиков', 'sup.xlsx', buildSupplierFixture()],
  ] as const) {
    await page.getByLabel(label).setInputFiles({
      name,
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(bytes),
    });
  }
  await page
    .getByRole('button', { name: 'Перемещения', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Условия', exact: true }).click();
  const threshold = page.getByLabel('Порог суммы SKU', { exact: true });
  await expect(threshold).toHaveValue('10000');
  await expect(
    page.getByRole('button', { name: 'Рассчитать перемещения', exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (this.name === 'workspaces') {
        IDBObjectStore.prototype.put = put;
        throw new DOMException('Test quota failure', 'QuotaExceededError');
      }
      return put.apply(this, args);
    };
  });
  await threshold.fill('5000');
  await expect(
    page.getByText('Порог не сохранён. Повторите ввод.', { exact: true }),
  ).toBeVisible();
  await expect(threshold).toHaveValue('10000');
  await threshold.fill('5000');
  await expect(threshold).toHaveAttribute('aria-busy', 'false');
  await expect(
    page.getByText('Порог не сохранён. Повторите ввод.', { exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole('tab', { name: 'Условия', exact: true }).click();
  await expect(page.getByLabel('Порог суммы SKU', { exact: true })).toHaveValue(
    '5000',
  );
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.remoteRequests).toEqual([]);
});

test('E2E-14 formatted codes, supplier identity and opaque transfer matrix work together offline', async ({
  page,
}, testInfo) => {
  const XLSX = await import('xlsx');
  const evidence = observeRuntime(page);
  await expectOfflineApp(page, resolve('dist/ORDERS_AUTO'));
  await page.setViewportSize({ width: 1280, height: 720 });
  function report(rows: unknown[][], cell: string) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet[cell]!.z = '000000';
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Report');
    return Buffer.from(XLSX.write(book, { type: 'array', bookType: 'xlsx' }));
  }
  const allowed = 'ИП Баранов Роман Борисович',
    second = 'ИП Никишин Андрей Николаевич';
  const min = report(
    [
      [
        'Код',
        'Артикул',
        'Номенклатура',
        'Количество',
        'Минимальный остаток',
        'Максимальный остаток',
        'Цена',
      ],
      [123, 'ART-ZERO', 'Товар с полным кодом', 100, null, null, 100],
      [null, null, 'Донор', 100, 10, 10, null],
      ...Array.from({ length: 8 }, (_, i) => [
        null,
        null,
        `Склад ${i + 1}`,
        0,
        1,
        10,
        null,
      ]),
    ],
    'A2',
  );
  const sup = report(
    [
      [
        'Контрагент',
        'Код',
        'Номенклатура',
        'Количество',
        'Стоимость',
        'Ед. изм.',
      ],
      [allowed, 123, 'Товар с полным кодом', 10, 1000, 'шт'],
      [second, '000123', 'Товар с полным кодом', 1, 100, 'шт'],
    ],
    'B2',
  );
  for (const [label, name, buffer] of [
    ['Выбрать файл Отчёт MIN/MAX', 'min.xlsx', min],
    ['Выбрать файл Отчёт поставщиков', 'sup.xlsx', sup],
  ] as const)
    await page.getByLabel(label).setInputFiles({
      name,
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    });
  await page.getByRole('button', { name: 'Поставщики', exact: true }).click();
  const product = page.getByRole('row').filter({ has: supplierLinks(page, '000123') });
  await expect(product).toContainText('ART-ZERO');
  await expect(product).toContainText('Товар с полным кодом');
  await assignPrimary(page, '000123', allowed);
  await page
    .getByRole('button', { name: 'Перемещения', exact: true })
    .click();
  await expect(page.getByLabel('Шаг для ненастроенных SKU')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Рассчитать перемещения', exact: true })
    .click();
  const matrix = page.locator('.transfer-matrix .virtual-scroll');
  await expect
    .poll(() => matrix.evaluate((el) => el.scrollWidth > el.clientWidth))
    .toBe(true);
  const identity = page.locator(
    '.transfer-matrix .virtual-row .transfer-identity',
  );
  await identity.scrollIntoViewIfNeeded();
  await matrix.evaluate((el) => {
    el.scrollLeft = 600;
  });
  await expect
    .poll(() =>
      identity.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const row = el.closest('.virtual-row')!.getBoundingClientRect();
        if (Math.abs(r.height - row.height) > 1) return false;
        return [r.top + 4, r.top + r.height / 2, r.bottom - 4].every((y) =>
          el.contains(document.elementFromPoint(r.right - 8, y)),
        );
      }),
    )
    .toBe(true);
  await expect(identity).toHaveCSS('background-color', 'rgb(237, 244, 250)');
  await page.screenshot({
    path: testInfo.outputPath('operator-sticky-column-1280.png'),
  });
  await page
    .getByRole('button', {
      name: 'Открыть перемещение Донор → Склад 1',
      exact: true,
    })
    .click();
  const drawer = page.getByRole('dialog', { name: 'Состав перемещения' });
  await expect(
    drawer
      .getByRole('columnheader')
      .filter({ hasText: /^(Код|Артикул|Наименование)$/ }),
  ).toHaveText(['Код', 'Артикул', 'Наименование']);
  await expect(drawer.getByText('000123', { exact: true })).toBeVisible();
  await drawer
    .getByRole('checkbox', { name: /Выбрать перемещение 000123/ })
    .check();
  await drawer
    .getByRole('button', {
      name: 'Принять выбранные в перемещении (1)',
      exact: true,
    })
    .click();
  await page
    .getByRole('dialog', { name: 'Принять выбранные перемещения' })
    .getByRole('button', { name: 'Принять перемещения', exact: true })
    .click();
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Перемещения приняты');
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.remoteRequests).toEqual([]);
});

test('E2E-15 page context, frozen product identity and accessible saved table controls work offline', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await importFullCoverageFixture(
    page,
    coverageBranches,
    Array.from({ length: 30 }, (_, i) => `ITEM${i}`),
  );
  const nav = page.locator('.sidebar');
  await nav.getByRole('button', { name: 'Все товары', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.locator('.virtual-table').scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
  const position = await page.evaluate(() => window.scrollY);
  await nav.getByRole('button', { name: 'Заказы', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await nav.getByRole('button', { name: 'Все товары', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeCloseTo(position, 0);
  const scroll = page.locator('.virtual-scroll');
  await scroll.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const code = page.getByRole('cell', { name: 'ITEM0', exact: true });
  const frozen = await code.boundingBox();
  const viewport = await scroll.boundingBox();
  expect(frozen!.x).toBeGreaterThanOrEqual(viewport!.x - 1);
  expect(frozen!.x + frozen!.width).toBeLessThan(viewport!.x + viewport!.width);
  await page.getByRole('button', { name: 'Столбцы', exact: true }).click();
  await page
    .getByRole('checkbox', { name: 'Показать столбец Статус', exact: true })
    .uncheck();
  await page
    .getByRole('button', { name: 'Закрыть настройки столбцов', exact: true })
    .click();
  await scroll.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await page
    .getByRole('button', { name: 'Сортировать: Потребность', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Сортировать: Потребность', exact: true })
    .click();
  await page
    .getByText('Сохранение сеанса…', { exact: true })
    .waitFor({ state: 'hidden' });
  await page.reload();
  await expect(
    page.getByRole('columnheader', { name: 'Статус', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('columnheader', { name: 'Потребность', exact: true }),
  ).toHaveAttribute('aria-sort', 'descending');
  const a11y = async () => {
    await page.addScriptTag({ content: axe.source });
    return page.evaluate(async () => {
      const api = (window as unknown as { axe: typeof axe }).axe;
      // OA is the decorative logo mark: text forming a logo is exempt from1.4.3.
      const result = await api.run(
        { exclude: [['.brand > span[aria-hidden="true"]']] },
        {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'],
          },
        },
      );
      return result.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      }));
    });
  };
  expect(await a11y()).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('30-demand-saved-columns.png'),
  });
  await nav
    .getByRole('button', { name: 'Перемещения', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Маршруты', exact: true }).click();
  expect(await a11y()).toEqual([]);
});

test('E2E-16 sorting a long list keeps expanded product rows adjacent without overlap', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const codes = Array.from(
    { length: 130 },
    (_, i) => `SKU${String(i).padStart(3, '0')}`,
  );
  await importFullCoverageFixture(
    page,
    coverageBranches,
    codes,
    (code) =>
      `A${code === 'SKU000' ? '001' : code === 'SKU001' ? '000' : code.slice(3)}`,
  );
  await page
    .locator('.sidebar')
    .getByRole('button', { name: 'Все товары', exact: true })
    .click();
  const first = page.getByRole('button', {
    name: 'Товар полного покрытия SKU000 Показать подразделения',
    exact: true,
  });
  await first.click();
  const shells = page.locator('.virtual-row-shell');
  await expect
    .poll(async () => {
      const heights = await shells.evaluateAll((rows) =>
        rows.slice(0, 2).map((row) => row.getBoundingClientRect().height),
      );
      return heights[0]! - heights[1]!;
    })
    .toBeGreaterThan(20);
  await page
    .getByRole('button', { name: 'Сортировать: Артикул', exact: true })
    .click();
  await expect
    .poll(() =>
      shells.evaluateAll((rows) =>
        rows
          .slice(0, 3)
          .map((row) => row.querySelector('[role="cell"]')?.textContent),
      ),
    )
    .toEqual(['SKU001', 'SKU000', 'SKU002']);
  await expect
    .poll(() =>
      shells.evaluateAll((rows) => {
        const boxes = rows
          .slice(0, 3)
          .map((row) => row.getBoundingClientRect());
        return Math.max(
          ...boxes
            .slice(1)
            .map((box, i) => Math.abs(box.top - boxes[i]!.bottom)),
        );
      }),
    )
    .toBeLessThanOrEqual(1);
  await expect(
    page.getByRole('button', {
      name: 'Товар полного покрытия SKU000 Скрыть подразделения',
      exact: true,
    }),
  ).toBeVisible();
});

test('E2E-22 Volmax workspace ships local artwork and distinct native control states', async ({
  page,
}, testInfo) => {
  const { buildWorkbook } = await import('../fixtures/workbookBuilders');
  const evidence = observeRuntime(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href);

  const brand = page.getByRole('img', { name: 'Волмакс Буст' });
  await expect(brand).toBeVisible();
  expect(await brand.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
  const continueButton = page.getByRole('button', { name: 'Перейти к потребности', exact: true });
  await expect(continueButton).toBeDisabled();
  await expect(continueButton).toHaveCSS('cursor', 'not-allowed');

  const expectPointerStates = async (control: Locator, name: string) => {
    const background = () =>
      control.evaluate((element) => {
        const { backgroundColor, backgroundImage } = getComputedStyle(element);
        return [backgroundColor, backgroundImage];
      });
    await page.mouse.move(4, 4);
    const normal = await background();
    await control.hover();
    const hover = await background();
    await page.mouse.down();
    const pressed = await background();
    await page.mouse.move(4, 4);
    await page.mouse.up();
    expect.soft(hover, `${name}: hover`).not.toEqual(normal);
    expect.soft(pressed, `${name}: pressed`).not.toEqual(hover);
  };

  await expectPointerStates(
    page.locator('label.button').filter({
      has: page.getByLabel('Выбрать файл Отчёт MIN/MAX'),
    }),
    'Загрузка файла',
  );

  const products = [
    ['310701', 'Смеситель кухонный, чёрный', 1140],
    ['39459', 'Коллектор PPR RTP, 5 контуров', 450],
    ['40075', 'Кран шаровой 1/2″ ГОСТ', 400],
    ['40714', 'Набор для подключения радиатора', 600],
    ['39462', 'Коллектор PPR RTP, 8 контуров', 580],
    ['40727', 'Герметик резьбовой Sanfix', 270],
    ['39511', 'Смеситель кухонный, серый', 1180],
    ['40750', 'Лента ФУМ 19 × 15 × 0,2 мм', 62],
    ['51916', 'Фиксатор резьбы Sanfix', 285],
    ['310801', 'Смеситель с гибким изливом', 1260],
  ] as const;
  const branches = ['Ленина', 'Егорьевск', 'Коломна', 'Раменское', 'Ступино', 'Воскресенск', 'Зарайск', 'Наро-Фоминск', 'Кашира'];
  const min = buildWorkbook([
    ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток', 'Цена'],
    ...products.flatMap(([sku, name, price], index) => [
      [sku.padStart(10, '0'), sku, name, null, null, null, price],
      ...branches.map((branch, i) => {
        const stock = i === (index % 4) * 2 + 1 ? 112 : i % 2 === 0 ? 4 + index % 4 : 24;
        return [null, null, branch, stock, 10, 24, null];
      }),
    ]),
  ]);
  const suppliers = buildWorkbook([
    ['Контрагент', 'Код', 'Номенклатура', 'Количество', 'Стоимость', 'Ед. изм.'],
    ...products.map(([sku, name, price]) => ['ИП Баранов Роман Борисович', sku.padStart(10, '0'), name, 1, price, 'шт']),
  ]);
  for (const [label, name, data] of [
    ['Выбрать файл Отчёт MIN/MAX', 'MIN-MAX_05-11-2026.xlsx', min],
    ['Выбрать файл Отчёт поставщиков', 'Поставщики_05-11-2026.xlsx', suppliers],
  ] as const) {
    await page.getByLabel(label).setInputFiles({
      name,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(data),
    });
  }

  await expect(continueButton).toBeEnabled();
  await expect(continueButton).toHaveCSS('cursor', 'pointer');
  await expectPointerStates(continueButton, 'Основная кнопка');
  await continueButton.click();
  await expect(page.getByRole('heading', { name: 'Потребность всей сети' })).toBeVisible();
  await expectPointerStates(
    page.locator('.sidebar button[aria-current="page"]'),
    'Активный пункт меню',
  );
  await expectPointerStates(
    page.locator('.workspace-shortcuts button[aria-current="page"]'),
    'Активный верхний переход',
  );
  const search = page.locator('main .search-control input').first();
  await expect(search).toHaveCSS('cursor', 'text');
  await page.keyboard.press('Tab');
  await search.focus();
  await expect(search).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(search).toHaveCSS('border-top-color', 'rgb(8, 124, 170)');
  await search.blur();
  await page.mouse.move(1580, 16);
  await expect(page.getByText('Потребность рассчитана.', { exact: true })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('01-demand.png') });

  await page.getByRole('button', { name: 'Раздел: Перемещения', exact: true }).click();
  await page.getByRole('tab', { name: 'Условия', exact: true }).click();
  await expectPointerStates(
    page.getByRole('tab', { name: 'Условия', selected: true }),
    'Выбранная вкладка',
  );
  const threshold = page.getByRole('spinbutton', { name: 'Порог суммы SKU' });
  await threshold.fill('-1');
  await threshold.blur();
  await expect(threshold).toHaveAttribute('aria-invalid', 'true');
  await expect(threshold).toHaveCSS('border-top-color', 'rgb(163, 38, 54)');
  await threshold.hover();
  await expect.soft(threshold, 'Рамка ошибки при наведении').toHaveCSS(
    'border-top-color',
    'rgb(163, 38, 54)',
    { timeout: 500 },
  );
  await threshold.fill('0');
  await threshold.blur();
  await expect(threshold).toHaveAttribute('aria-invalid', 'false');
  const calculate = page.getByRole('button', {
    name: 'Рассчитать перемещения',
    exact: true,
  });
  const busyCursor = await calculate.evaluateHandle((button) => {
    const result = { value: '' };
    const observer = new MutationObserver(() => {
      if (button.getAttribute('aria-busy') !== 'true') return;
      result.value = getComputedStyle(button).cursor;
      observer.disconnect();
    });
    observer.observe(button, { attributeFilter: ['aria-busy'] });
    return result;
  });
  await calculate.click();
  await expect.soft
    .poll(() => busyCursor.evaluate((state) => state.value), {
      message: 'Курсор во время расчёта',
      timeout: 1000,
    })
    .toBe('progress');
  await busyCursor.dispose();
  await expect(page.getByRole('tab', { name: 'Результаты', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: /^Открыть перемещение / }).first().click();
  const composition = page.getByRole('dialog');
  await composition.getByRole('checkbox', { name: 'Выбрать все предложения по поиску' }).check();
  await composition.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.locator('.order-cell.has-selection').first()).toBeVisible();
  await page.mouse.move(1580, 16);
  await page.screenshot({ path: testInfo.outputPath('02-rebalancing-results.png') });
  expect(evidence.fileRequests.some((url) => url.endsWith('/masthead-wave.webp'))).toBe(true);
  expect(evidence.fileRequests.some((url) => url.endsWith('/rail-wave.webp'))).toBe(true);
  expect(evidence.remoteRequests).toEqual([]);
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
});

test('E2E-23 weekly MIN/MAX carries supplier links and blocks stale and unpriced exports', async ({ page }) => {
  const { buildWorkbook } = await import('../fixtures/workbookBuilders');
  const { readFile } = await import('node:fs/promises');
  const supplierA = 'ИП Баранов Роман Борисович';
  const supplierB = 'ИП Никишин Андрей Николаевич';
  const input = 'Выбрать файл Отчёт MIN/MAX';
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const entry = pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href;
  const minMax = (name: string, rows: [string, number | null][]) => ({
    name,
    mimeType,
    buffer: Buffer.from(buildWorkbook([
      ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток', 'Цена'],
      ...rows.flatMap(([code, price]) => [
        [code, code, 'Товар ' + code, null, null, null, price],
        [null, null, 'Ленина', 0, 5, 20, null],
      ]),
    ])),
  });
  const refresh = async (tab: Page, name: string, rows: [string, number | null][]) => {
    await tab.getByRole('button', { name: 'Обновить MIN/MAX', exact: true }).click();
    await expect(tab.getByLabel('Выбрать файл Отчёт поставщиков')).toHaveCount(0);
    await tab.getByLabel(input).setInputFiles(minMax(name, rows));
    await expect(tab.getByText(name, { exact: true }).first()).toBeVisible();
    await tab.getByRole('button', { name: 'Перейти к потребности', exact: true }).click();
    await tab.getByRole('button', { name: 'Заказы', exact: true }).click();
  };

  await page.context().setOffline(true);
  await page.goto(entry);
  // Supplier file can be read first and is used for links only.
  await page.getByLabel('Выбрать файл Отчёт поставщиков').setInputFiles({
    name: 'suppliers-once.xlsx',
    mimeType,
    buffer: Buffer.from(buildWorkbook([
      ['Контрагент', 'Код', 'Номенклатура', 'Количество', 'Стоимость', 'Ед. изм.'],
      [supplierA, '0001', 'Товар 0001', 10, 800, 'шт'],
      [supplierB, '0001', 'Товар 0001', 10, 900, 'шт'],
      [supplierA, '1', 'Товар 1', 10, 800, 'шт'],
    ])),
  });
  const firstWeek = minMax('week-1.xlsx', [['0001', 100], ['1', 100]]);
  await page.getByLabel(input).setInputFiles(firstWeek);
  await page.getByRole('button', { name: 'Перейти к потребности', exact: true }).click();
  await page.getByRole('button', { name: 'Поставщики', exact: true }).click();
  await assignPrimary(page, '0001', supplierB);
  await page.getByRole('button', { name: 'Заказы', exact: true }).click();
  await expect(page.getByRole('button', { name: `Все заказы ${supplierB}`, exact: true })).toContainText('2 000,00');

  const browsing = await page.context().newPage();
  await browsing.goto(entry);
  await browsing.getByRole('navigation', { name: 'Основная навигация' })
    .getByRole('button', { name: 'Поставщики', exact: true }).click();
  await expect(browsing.getByRole('heading', { name: 'Поставщики', exact: true })).toBeVisible();
  const readyZip = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать все (2)', exact: true }).click();
  expect((await readyZip).suggestedFilename()).toMatch(/\.zip$/);
  await browsing.close();

  await page.getByRole('button', { name: 'Обновить MIN/MAX', exact: true }).click();
  await page.getByLabel(input).setInputFiles(firstWeek);
  await expect(page.getByText(/Этот отчёт MIN\/MAX уже загружен/)).toBeVisible();
  await page.getByRole('button', { name: 'Перейти к потребности', exact: true }).click();
  await page.getByRole('button', { name: 'Заказы', exact: true }).click();
  await expect(page.locator('.order-cell').filter({ hasText: 'Выгружен' })).toHaveCount(2);

  const stale = await page.context().newPage();
  await stale.goto(entry);
  await expect(stale.getByRole('heading', { name: 'Заказы', exact: true })).toBeVisible();
  await refresh(page, 'week-2.xlsx', [['0001', 115], ['NEW', 100]]);
  await expect(page.getByRole('button', { name: `Все заказы ${supplierB}`, exact: true })).toContainText('2 300,00');
  await expect(page.getByRole('button', { name: `Все заказы ${supplierA}`, exact: true })).toHaveCount(0);
  await stale.locator('.order-cell').first().click();
  const staleDownloads: string[] = [];
  stale.on('download', (download) => staleDownloads.push(download.suggestedFilename()));
  await stale.getByRole('button', { name: 'Скачать CSV ещё раз', exact: true }).click();
  await expect(stale.getByRole('alert').filter({ hasText: 'Рабочий сеанс изменился' }).first()).toBeVisible();
  expect(staleDownloads).toEqual([]);
  await stale.close();

  await page.locator('.order-cell').first().click();
  const downloadReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать CSV заказа', exact: true }).click();
  const download = await downloadReady;
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('0001;');
  expect(csv).toContain(';20;шт;115;2300');

  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await refresh(page, 'week-3.xlsx', [['0001', null], ['1', 110], ['NEW', 100]]);
  await expect(page.getByRole('button', { name: `Все заказы ${supplierA}`, exact: true })).toContainText('2 200,00');
  await expect(page.locator('.order-cell').filter({ hasText: 'Не хватает цены' })).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.order-cell').filter({ hasText: 'Не хватает цены' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Скачать все (1)', exact: true })).toBeEnabled();
});

test('E2E-24 reconciles a supplier invoice against reviewed orders and an archived week offline', async ({ page }, testInfo) => {
  const { buildWorkbook } = await import('../fixtures/workbookBuilders');
  const { readFile } = await import('node:fs/promises');
  const xlsx = await import('xlsx');
  const supplier = 'ИП Баранов Роман Борисович';
  const entry = pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href;
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const workbook = (name: string, rows: unknown[][]) => ({
    name, mimeType, buffer: Buffer.from(buildWorkbook(rows)),
  });
  const minMax = (name: string, price: number) => workbook(name, [
    ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток', 'Цена'],
    ['0001', 'VM-1', 'Товар 1', null, null, null, price],
    [null, null, 'Ленина', 0, 2, 10, null],
    [null, null, 'Ступино', 0, 2, 10, null],
  ]);
  const evidence = observeRuntime(page);
  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  await page.context().setOffline(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(entry);
  await page.getByLabel('Выбрать файл Отчёт MIN/MAX').setInputFiles(minMax('неделя-1.xlsx', 100));
  await page.getByLabel('Выбрать файл Отчёт поставщиков').setInputFiles(workbook('поставщики.xlsx', [
    ['Контрагент', 'Код', 'Номенклатура', 'Количество', 'Стоимость', 'Ед. изм.'],
    [supplier, '0001', 'Товар 1', 1, 10, 'шт'],
  ]));
  await page.getByRole('button', { name: 'Перейти к потребности' }).click();
  expect((await nav.getByRole('button').allTextContents()).slice(0, 5).map((label) => label.trim()))
    .toEqual(['Все товары', 'Поставщики', 'Перемещения', 'Заказы', 'Счета']);

  await nav.getByRole('button', { name: 'Заказы', exact: true }).click();
  await page.locator('.order-cell').first().click();
  const drawer = page.getByRole('dialog', { name: 'Состав заказа' });
  await drawer.getByRole('spinbutton', { name: 'Количество 0001' }).fill('7');
  await expect(drawer.getByRole('spinbutton', { name: 'Количество 0001' })).toHaveAttribute('aria-busy', 'false');
  await drawer.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: `Все заказы ${supplier}`, exact: true }).click();
  const supplierOrders = page.getByRole('dialog', { name: `Все заказы ${supplier}` });
  await supplierOrders.getByRole('button', { name: 'Отметить все проверенными' }).click();
  await supplierOrders.getByRole('button', { name: 'Сверить счёт' }).click();

  await expect(page.getByRole('heading', { name: 'Сверка счетов', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: `Выбрать заказ ${supplier} — Ленина` })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: `Выбрать заказ ${supplier} — Ступино` })).toBeChecked();
  await page.getByLabel('Файл счёта поставщика').setInputFiles({
    name: 'битый.xlsx', mimeType, buffer: Buffer.from('not an invoice'),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сравнить', exact: true })).toBeDisabled();
  await page.getByLabel('Файл счёта поставщика').setInputFiles(workbook('счёт.xlsx', [
    ['Код 1С', 'Артикул', 'Наименование', 'Кол-во', 'Ед.', 'Цена без скидки', 'Цена со скидкой', 'Сумма со скидкой'],
    ['0001', 'VM-1', 'Товар 1', 15, 'шт', 120, 115, 1724.99],
    ['', 'EXTRA', 'Лишний товар', 2, 'шт', 70, 60, 120],
  ]));
  await page.getByRole('button', { name: 'Сравнить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Результат сверки', exact: true })).toBeVisible();
  await expect(page.getByText('Дороже', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('24-invoice-reconciliation.png'), fullPage: true });
  const exportReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel для 1С', exact: true }).click();
  const file = await exportReady;
  const output = xlsx.read(await readFile((await file.path())!), { type: 'buffer' });
  const rows = xlsx.utils.sheet_to_json(output.Sheets[output.SheetNames[0]!]!, { header: 1 });
  expect(rows).toEqual([
    ['Артикул', 'Номенклатура', 'Количество', 'Ед.', 'Цена', 'Сумма'],
    ['VM-1', 'Товар 1', 15, 'шт', 115, 1724.99],
  ]);

  await page.setViewportSize({ width: 1024, height: 768 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Excel для 1С', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 1280, height: 900 });
  const draftQty = page.getByRole('textbox', { name: /Количество.*VM-1/ });
  await draftQty.fill('14');
  await nav.getByRole('button', { name: 'Обновить MIN/MAX' }).click();
  const leave = page.getByRole('dialog', { name: 'Выйти из сверки счёта?' });
  await leave.getByRole('button', { name: 'Остаться' }).click();
  await expect(draftQty).toHaveValue('14');
  await nav.getByRole('button', { name: 'Обновить MIN/MAX' }).click();
  await leave.getByRole('button', { name: 'Выйти из сверки' }).click();
  await page.getByLabel('Выбрать файл Отчёт MIN/MAX').setInputFiles(minMax('неделя-2.xlsx', 130));
  await expect(page.getByText('неделя-2.xlsx', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Перейти к потребности' }).click();
  await nav.getByRole('button', { name: 'Счета', exact: true }).click();
  const source = page.getByRole('combobox', { name: 'Рабочий сеанс', exact: true });
  const weekOne = source.locator('option').filter({ hasText: 'неделя-1.xlsx' });
  await expect(weekOne).toHaveCount(1);
  await source.selectOption(await weekOne.getAttribute('value') ?? '');
  await expect(page.getByRole('checkbox', { name: `Выбрать заказ ${supplier} — Ленина` })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: `Выбрать заказ ${supplier} — Ступино` })).toBeVisible();
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.remoteRequests).toEqual([]);
});

test('E2E-25 virtualizes a long order and saves a quantity at the end of the list', async ({ page }) => {
  const { buildWorkbook } = await import('../fixtures/workbookBuilders');
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const skus = Array.from({ length: 150 }, (_, i) => 'L-' + String(i + 1).padStart(3, '0'));
  const supplier = 'ИП Баранов Роман Борисович';
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href);
  await page.getByLabel('Выбрать файл Отчёт MIN/MAX').setInputFiles({
    name: 'long-order.xlsx', mimeType,
    buffer: Buffer.from(buildWorkbook([
      ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток', 'Цена'],
      ...skus.flatMap((sku) => [
        [sku, sku, 'Товар ' + sku, null, null, null, 10],
        [null, null, 'Ленина', 0, 2, 10, null],
      ]),
    ])),
  });
  await page.getByLabel('Выбрать файл Отчёт поставщиков').setInputFiles({
    name: 'long-order-suppliers.xlsx', mimeType,
    buffer: Buffer.from(buildWorkbook([
      ['Контрагент', 'Код', 'Номенклатура', 'Количество', 'Стоимость', 'Ед. изм.'],
      ...skus.map((sku) => [supplier, sku, 'Товар ' + sku, 1, 10, 'шт']),
    ])),
  });
  await page.getByRole('button', { name: 'Перейти к потребности', exact: true }).click();
  await page.getByRole('button', { name: 'Заказы', exact: true }).click();

  const openOrder = async () => {
    await page.locator('.order-cell').first().click();
    const drawer = page.getByRole('dialog', { name: 'Состав заказа' });
    await expect(drawer.getByRole('table')).toHaveAttribute('aria-rowcount', '151');
    expect(await drawer.getByRole('spinbutton').count()).toBeLessThan(60);
    await drawer.getByLabel('Прокрутка таблицы').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    return drawer.getByRole('spinbutton', { name: 'Количество L-150', exact: true });
  };

  const quantity = await openOrder();
  await quantity.fill('6');
  await expect(quantity).toHaveAttribute('aria-busy', 'false');
  await page.reload();
  const restoredQuantity = await openOrder();
  await expect(restoredQuantity).toHaveValue('6');
});

test('E2E-26 manual transfer quantity, route context and accepted Excel survive offline reload', async ({
  page,
}) => {
  const { buildWorkbook } = await import('../fixtures/workbookBuilders');
  const { default: ExcelJS } = await import('exceljs');
  const evidence = observeRuntime(page);
  const sku = '00026';
  const name = 'Товар для ручного перемещения';
  const min = buildWorkbook([
    [
      'Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток',
      'Максимальный остаток', 'Цена',
    ],
    [sku, 'ART-26', name, 180, null, null, 420.5],
    [null, null, 'Донор А', 75, 20, 60, null],
    [null, null, 'Донор Б', 95, 20, 60, null],
    [null, null, 'Получатель', 10, 20, 60, null],
  ]);
  const suppliers = buildWorkbook([
    ['Контрагент', 'Код', 'Номенклатура', 'Количество', 'Стоимость', 'Ед. изм.'],
    ['ИП Баранов Роман Борисович', sku, name, 1, 420.5, 'шт'],
  ]);
  await page.context().setOffline(true);
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href);
  for (const [label, filename, bytes] of [
    ['Выбрать файл Отчёт MIN/MAX', 'manual-min.xlsx', min],
    ['Выбрать файл Отчёт поставщиков', 'manual-suppliers.xlsx', suppliers],
  ] as const) {
    await page.getByLabel(label).setInputFiles({
      name: filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(bytes),
    });
    await expect(page.getByText(filename, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Обработка отчёта…', { exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Перейти к потребности', exact: true }).click();
  await page.getByRole('button', { name: 'Перемещения', exact: true }).click();
  await page.getByRole('button', { name: 'Рассчитать перемещения', exact: true }).click();
  const query = page.getByRole('textbox', { name: 'Поиск по коду, артикулу, товару и маршруту' });
  const routeA = page.getByRole('button', { name: 'Открыть перемещение Донор А → Получатель', exact: true });
  const routeB = page.getByRole('button', { name: 'Открыть перемещение Донор Б → Получатель', exact: true });
  await query.fill('Донор А');
  await expect(routeB).toHaveCount(0);
  await routeA.click();
  const drawer = page.getByRole('dialog', { name: 'Состав перемещения', exact: true });
  const quantity = drawer.getByRole('spinbutton', { name: `Количество ${sku}`, exact: true });
  const directions = drawer.getByRole('button', { name: `Направления 2 для ${sku}`, exact: true });
  const popup = drawer.getByRole('dialog', { name: `Направления товара ${sku}`, exact: true });
  await expect(quantity).toHaveValue('15');
  await expect(popup).toHaveCount(0);
  await directions.focus();
  await page.keyboard.press('Enter');
  await expect(popup).toContainText('Донор Б → Получатель');
  await expect(popup).toContainText('35 шт');
  await expect(popup.locator('[aria-current="true"]')).toContainText('Донор А → Получатель');
  const popupBox = (await popup.boundingBox())!;
  const drawerBox = (await drawer.boundingBox())!;
  expect(popupBox.x).toBeGreaterThanOrEqual(drawerBox.x);
  expect(popupBox.y).toBeGreaterThanOrEqual(drawerBox.y);
  expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(drawerBox.x + drawerBox.width);
  expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(drawerBox.y + drawerBox.height);
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(directions).toBeFocused();

  const save = drawer.getByRole('button', { name: `Сохранить количество ${sku}`, exact: true });
  await quantity.fill('76');
  await expect(save).toBeDisabled();
  await expect(drawer.getByRole('alert')).toContainText('Максимум для этого направления: 75 шт');
  await quantity.fill('16');
  await expect(drawer.getByText(/Остаток получателя выше MAX/)).toBeVisible();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(save).toHaveCount(0);
  await expect(drawer.getByText('Вручную · расчёт 15', { exact: true })).toBeVisible();
  await page.reload();
  await routeA.click();
  await expect(quantity).toHaveValue('16');
  await expect(drawer.getByText('Вручную · расчёт 15', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: 'Закрыть карточку', exact: true }).click();
  await query.fill('');
  await expect(routeB).toContainText('35 шт');
  await page.getByRole('checkbox', { name: 'Выбрать видимые предложения', exact: true }).check();
  await page.getByRole('button', { name: 'Принять выбранные (2)', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Принять выбранные перемещения', exact: true });
  await confirmation.getByRole('button', { name: 'Принять перемещения', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await page.mouse.move(1, 1);
  await expect(routeA).toHaveCSS('background-color', 'rgb(238, 249, 242)');
  await expect(routeB).toHaveCSS('background-color', 'rgb(238, 249, 242)');

  await page.getByRole('tab', { name: 'Принятые', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Выбрать все направления по фильтрам', exact: true }).check();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel выбранных (2)', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^Принятые_перемещения__.*\.xlsx$/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await file.path())!);
  expect(workbook.worksheets).toHaveLength(3);
  expect(workbook.worksheets[0]?.name).toBe('Сводка');
  const donorSheet = workbook.worksheets.find((sheet) => sheet.getCell('A3').value === 'Донор А → Получатель')!;
  expect(donorSheet.getCell('A6').value).toBe(sku);
  expect(donorSheet.getCell('D6').value).toBe(16);
  expect(donorSheet.getCell('F6').value).toBe(420.5);
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.remoteRequests).toEqual([]);
});
