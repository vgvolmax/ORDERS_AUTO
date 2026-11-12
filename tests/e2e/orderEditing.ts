import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWorkbook } from '../fixtures/workbookBuilders';

test('E2E-31 order quantities stay in their cells and matrix metadata never moves the rows', async ({ page }, testInfo) => {
  const supplier = 'ИП Баранов Роман Борисович';
  const branches = ['Ленина', 'Наро-Фоминск', 'ОреховоЗуево'];
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const errors: string[] = [];
  const remote: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/i.test(request.url())) remote.push(request.url()); });
  await page.context().setOffline(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href);
  await page.getByLabel('Выбрать файл Отчёт MIN/MAX').setInputFiles({ name: 'drawer-layout.xlsx', mimeType, buffer: Buffer.from(buildWorkbook([
    ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток', 'Цена'],
    ['A', 'ART-A', 'Первый товар', null, null, null, 2716.16],
    ...branches.map(branch => [null, null, branch, 0, 1, 1, null]),
    ['B', 'ART-B', 'Второй товар', null, null, null, 402],
    ...branches.map(branch => [null, null, branch, 0, 1, 4, null]),
  ])) });
  await page.getByLabel('Выбрать файл Отчёт поставщиков').setInputFiles({ name: 'suppliers.xlsx', mimeType, buffer: Buffer.from(buildWorkbook([
    ['Контрагент', 'Код', 'Номенклатура', 'Количество', 'Стоимость', 'Ед. изм.'],
    [supplier, 'A', 'Первый товар', 1, 2716.16, 'шт'],
    [supplier, 'B', 'Второй товар', 1, 402, 'шт'],
  ])) });
  await page.getByRole('button', { name: 'Перейти к потребности', exact: true }).click();
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Заказы', exact: true }).click();
  await page.locator('.order-cell').first().click();
  const drawer = page.getByRole('dialog', { name: 'Состав заказа', exact: true });
  const quantity = drawer.getByRole('spinbutton', { name: 'Количество A', exact: true });
  const row = drawer.getByRole('row').filter({ has: quantity });
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 720 });
    await quantity.scrollIntoViewIfNeeded();
    const input = (await quantity.boundingBox())!;
    const cell = (await row.getByRole('cell').nth(7).boundingBox())!;
    const price = (await row.getByRole('cell').nth(8).boundingBox())!;
    expect(input.x).toBeGreaterThanOrEqual(cell.x);
    expect(input.x + input.width).toBeLessThanOrEqual(cell.x + cell.width);
    expect(input.x + input.width).toBeLessThanOrEqual(price.x);
    await expect(quantity).toHaveValue('1');
    await expect(row.getByRole('cell').nth(8)).toContainText('2 716,16');
    await page.screenshot({ path: testInfo.outputPath(`31-order-quantity-${width}.png`) });
  }
  await drawer.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: `Все заказы ${supplier}`, exact: true }).click();
  const matrix = page.getByRole('dialog', { name: `Все заказы ${supplier}`, exact: true });
  // Include the narrowest supported saved branch width, where service flags used to wrap.
  const resizer = matrix.getByRole('button', { name: 'Изменить ширину столбца Ленина', exact: true });
  for (let i = 0; i < 5; i++) await resizer.press('ArrowLeft');
  const header = matrix.locator('thead');
  const firstRow = matrix.locator('tbody tr').first();
  const before = { header: (await header.boundingBox())!, row: (await firstRow.boundingBox())! };
  const qtyA = matrix.getByRole('spinbutton', { name: 'Количество A Ленина', exact: true });
  const qtyB = matrix.getByRole('spinbutton', { name: 'Количество B Ленина', exact: true });
  const expectStable = async () => {
    expect((await header.boundingBox())!.height).toBeCloseTo(before.header.height, 0);
    expect((await firstRow.boundingBox())!.y).toBeCloseTo(before.row.y, 0);
  };
  await qtyA.fill('2');
  await expect(qtyA).toHaveAttribute('aria-busy', 'false');
  await expectStable();
  await qtyA.fill('0');
  await qtyB.fill('0');
  await expect(qtyB).toHaveAttribute('aria-busy', 'false');
  const why = matrix.getByRole('button', { name: 'Почему заблокирован заказ Ленина', exact: true });
  await expect(why).toBeVisible();
  await expectStable();
  await why.click();
  const reason = page.getByRole('dialog', { name: 'Почему заказ заблокирован — Ленина', exact: true });
  await expect(reason).toContainText('Нет позиций с количеством больше нуля');
  await expect(reason).toContainText('Пустой заказ выгружать не нужно');
  await page.screenshot({ path: testInfo.outputPath('31-empty-order-explained.png') });
  await reason.press('Escape');
  await expect(why).toBeFocused();
  await qtyA.fill('1');
  await expect(why).toBeHidden();
  await expectStable();
  await page.screenshot({ path: testInfo.outputPath('31-stable-matrix-after-edit.png') });
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});
