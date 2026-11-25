import { expect, test, type Locator } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWorkbook } from '../fixtures/workbookBuilders';

async function fitsHorizontally(surface: Locator) {
  await expect.poll(() => surface.evaluate((node) =>
    node.scrollWidth - node.clientWidth,
  )).toBeLessThanOrEqual(1);
}

async function buttonsFit(toolbar: Locator) {
  await expect.poll(() => toolbar.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const buttons = Array.from(node.querySelectorAll('button')).map((button) => button.getBoundingClientRect())
      .filter((box) => box.width && box.height);
    return buttons.every((box, index) =>
      box.left >= bounds.left - 1 && box.right <= bounds.right + 1 &&
      box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1 &&
      buttons.slice(index + 1).every((other) =>
        box.right <= other.left || other.right <= box.left ||
        box.bottom <= other.top || other.bottom <= box.top,
      ),
    );
  })).toBe(true);
}

test('E2E-35 order, transfer and invoice layouts fit with long identifiers', async ({ page }, testInfo) => {
  const supplier = 'ИП Баранов Роман Борисович';
  const code = 'VLMX-0000000000000000000000000008';
  const article = 'VOLMAX-SERIES-12000201202044';
  const name = 'Коллекторная группа с расходомерами для контура тёплого пола';
  const branch = 'Распределительный центр Волмакс';
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const file = (name: string, rows: unknown[][]) => ({ name, mimeType, buffer: Buffer.from(buildWorkbook(rows)) });
  await page.context().setOffline(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href);
  await page.getByLabel('Выбрать файл Отчёт MIN/MAX').setInputFiles(file('wide-test.xlsx', [
    ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток', 'Цена'],
    [code, article, name, null, null, null, 9500],
    [null, null, branch, 35, 4, 8, null],
    [null, null, 'Наро-Фоминск', 0, 4, 8, null],
    [null, null, 'Орехово-Зуево', 0, 4, 8, null],
    ['002', 'T-2', 'Труба гофрированная с оплёткой', null, null, null, 100],
    [null, null, branch, 0, 4, 8, null],
    [null, null, 'Наро-Фоминск', 0, 4, 8, null],
    [null, null, 'Орехово-Зуево', 0, 4, 8, null],
  ]));
  await page.getByLabel('Выбрать файл Отчёт поставщиков').setInputFiles(file('suppliers.xlsx', [
    ['Контрагент', 'Код', 'Номенклатура', 'Количество', 'Стоимость', 'Ед. изм.'],
    [supplier, code, name, 1, 9500, 'шт'],
    [supplier, '002', 'Труба гофрированная с оплёткой', 1, 100, 'м'],
  ]));
  const menu = page.getByRole('navigation', { name: 'Основная навигация' });
  await page.getByRole('button', { name: 'Перейти к потребности' }).click();
  await menu.getByRole('button', { name: 'Заказы', exact: true }).click();

  await page.getByRole('button', { name: `Все заказы ${supplier}`, exact: true }).click();
  const matrix = page.getByRole('dialog', { name: `Все заказы ${supplier}` });
  const viewportSizes = [[1280, 600], [1440, 900], [1024, 768]] as const;
  for (const [width, height] of viewportSizes) {
    await page.setViewportSize({ width, height });
    await fitsHorizontally(matrix.locator('.supplier-matrix-wrap'));
    await buttonsFit(matrix.locator('.supplier-review-actions'));
  }
  await page.screenshot({ path: testInfo.outputPath('35-orders-supplier-1024.png') });
  const codeHeader = matrix.getByRole('columnheader').first();
  const originalCodeWidth = (await codeHeader.boundingBox())!.width;
  const codeResize = matrix.getByRole('button', { name: 'Изменить ширину столбца Код', exact: true });
  await codeResize.focus();
  await codeResize.press('ArrowRight');
  await expect.poll(async () => (await codeHeader.boundingBox())!.width).toBeCloseTo(originalCodeWidth + 12, 0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => (await codeHeader.boundingBox())!.width).toBeCloseTo(originalCodeWidth + 12, 0);
  await matrix.getByRole('button', { name: 'Сбросить ширину столбцов' }).click();
  await fitsHorizontally(matrix.locator('.supplier-matrix-wrap'));
  await page.keyboard.press('Escape');

  await page.locator('.order-cell').filter({ hasText: /2 SKU · Готов/ }).first().click();
  const order = page.getByRole('dialog', { name: 'Состав заказа' });
  for (const [width, height] of viewportSizes) {
    await page.setViewportSize({ width, height });
    await fitsHorizontally(order.locator('.virtual-scroll'));
    await buttonsFit(order.locator('.order-drawer-actions'));
  }
  await expect(order.getByText(code, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('35-order-1024.png') });
  await order.getByRole('switch', { name: 'Заказ проверен' }).click();
  await expect(order.getByRole('switch', { name: 'Заказ проверен' })).toBeChecked();
  await order.getByRole('button', { name: 'Сверить счёт' }).click();
  await page.getByLabel('Файл счёта поставщика').setInputFiles(file('счёт.xlsx', [
    ['Код 1С', 'Артикул', 'Наименование', 'Количество', 'Ед. измерения', 'Цена', 'Сумма'],
    [code, article, name, 8, 'шт', 9520, 76160],
    ['002', 'T-2', 'Труба гофрированная с оплёткой', 8, 'м', 100, 800],
    [null, null, 'К оплате', null, null, null, 78000],
  ]));
  await page.getByRole('button', { name: 'Сравнить', exact: true }).click();
  const result = page.getByRole('region', { name: 'Результат сверки' });
  await expect(result.getByRole('columnheader', { name: 'Дефицит сейчас' })).toBeVisible();
  await fitsHorizontally(result.locator('.virtual-scroll'));
  const correction = page.getByRole('region', { name: 'Корректировка и экспорт в 1С' });
  await fitsHorizontally(correction.locator('.virtual-scroll'));
  await buttonsFit(correction.locator('.invoice-export-actions'));

  await menu.getByRole('button', { name: 'Перемещения', exact: true }).click();
  await page.getByRole('button', { name: 'Рассчитать перемещения', exact: true }).click();
  await page.getByRole('button', { name: /^Открыть перемещение / }).first().click();
  const transfer = page.getByRole('dialog', { name: 'Состав перемещения' });
  for (const [width, height] of viewportSizes) {
    await page.setViewportSize({ width, height });
    await fitsHorizontally(transfer.locator('.virtual-scroll'));
    await buttonsFit(transfer.locator('.transfer-action-buttons'));
    const rect = (await transfer.boundingBox())!;
    expect(Math.abs(rect.x - (width - rect.x - rect.width))).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: testInfo.outputPath('35-transfer-1024.png') });
  await transfer.getByRole('checkbox', { name: 'Выбрать все предложения по поиску' }).check();
  await transfer.getByRole('button', { name: /^Принять выбранные в перемещении/ }).click();
  await page.getByRole('button', { name: 'Принять перемещения', exact: true }).click();
  await menu.getByRole('button', { name: 'Все товары', exact: true }).click();
  await page.getByRole('button', { name: /Учтённые перемещения/ }).first().click();
  const included = page.getByRole('dialog', { name: 'Учтённые перемещения' });
  await fitsHorizontally(included.locator('.virtual-scroll'));
  await buttonsFit(included.locator('.modal-actions'));
  await expect(included.getByText(code, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('35-accepted-impact-1024.png') });
});
