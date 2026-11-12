import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { buildWorkbook } from '../fixtures/workbookBuilders';

test('E2E-33 accepted documents freeze fields while restored working weeks use the current catalog', async ({ page }, testInfo) => {
  const first = 'ИП Баранов Роман Борисович';
  const second = 'ИП Никишин Андрей Николаевич';
  let unit = 'шт', primary = first, revision = 1;
  await page.exposeFunction('testOpenAcceptedCatalog', () => ({ content: {
    kind: 'volmax-supplier-catalog', schemaVersion: 1, suppliers: [first, second],
    products: [{ code: 'SKU1', article: 'A1', name: 'Товар для перемещения', unit }],
    assignments: [{ skuCode: 'SKU1', primary, additional: [] }],
  }, document: { id: '79f5d9f7-6643-4bf2-911b-76b85e3d2177', title: 'Справочник', revision, canEdit: true } }));
  await page.addInitScript(() => Object.defineProperty(window, 'AppBoxFiles', { value: {
    open: () => (window as unknown as { testOpenAcceptedCatalog: () => Promise<unknown> }).testOpenAcceptedCatalog(),
    save: () => Promise.reject(Error('Публикация не запрашивалась')),
  } }));
  const errors: string[] = [], remote: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/i.test(request.url())) remote.push(request.url()); });
  await page.context().setOffline(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href);
  await page.getByRole('button', { name: 'Открыть из AppBox', exact: true }).click();
  await expect(page.getByText(/Общий справочник подключён/)).toBeVisible();
  const report = (name: string, price: number) => ({ name,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(buildWorkbook([
      ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток', 'Цена'],
      ['SKU1', 'A1', 'Товар для перемещения', null, null, null, price],
      [null, null, 'Донор А', 75, 20, 60, null],
      [null, null, 'Донор Б', 95, 20, 60, null],
      [null, null, 'Получатель', 10, 20, 60, null],
    ])),
  });
  await page.getByLabel('Выбрать файл Отчёт MIN/MAX').setInputFiles(report('accepted-week-1.xlsx', 100));
  await page.getByRole('button', { name: 'Перейти к потребности', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  await nav.getByRole('button', { name: 'Перемещения', exact: true }).click();
  await page.getByRole('tab', { name: 'Условия', exact: true }).click();
  // Keep the residual recipient eligible after the first transfer raises it above MIN.
  await page.getByLabel('Получатель', { exact: true }).selectOption('BELOW_MAX');
  await page.getByRole('button', { name: 'Рассчитать перемещения', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Состав перемещения', exact: true });
  const acceptA = async () => {
    await page.getByRole('button', { name: 'Открыть перемещение Донор А → Получатель', exact: true }).click();
    await drawer.getByRole('checkbox', { name: /Выбрать перемещение SKU1 Донор А/ }).click();
    await drawer.getByRole('button', { name: 'Принять выбранные в перемещении (1)', exact: true }).click();
    await page.getByRole('dialog', { name: 'Принять выбранные перемещения', exact: true })
      .getByRole('button', { name: 'Принять перемещения', exact: true }).click();
    await expect(drawer).toHaveCount(0);
  };
  await acceptA();
  unit = 'упак'; primary = second; revision++;
  await nav.getByRole('button', { name: 'Поставщики', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть / обновить из AppBox', exact: true }).click();
  await expect(page.getByText(/Общий справочник подключён/)).toBeVisible();
  await nav.getByRole('button', { name: 'Заказы', exact: true }).click();
  await expect(page.getByRole('button', { name: `Все заказы ${second}`, exact: true })).toContainText('3 500,00');
  await nav.getByRole('button', { name: 'Перемещения', exact: true }).click();
  await page.getByRole('button', { name: 'Рассчитать перемещения', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть перемещение Донор Б → Получатель', exact: true }).click();
  await expect(drawer).toContainText('упак');
  await drawer.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await nav.getByRole('button', { name: 'Обновить MIN/MAX', exact: true }).click();
  await page.getByLabel('Выбрать файл Отчёт MIN/MAX').setInputFiles(report('accepted-week-2.xlsx', 200));
  await page.getByRole('button', { name: 'Перейти к потребности', exact: true }).click();
  await nav.getByRole('button', { name: 'История сеансов', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'accepted-week-1.xlsx' }).getByRole('button', { name: 'Восстановить', exact: true }).click();
  await page.getByRole('button', { name: 'Восстановить копию', exact: true }).click();
  await nav.getByRole('button', { name: 'Заказы', exact: true }).click();
  await expect(page.getByRole('button', { name: `Все заказы ${second}`, exact: true })).toContainText('3 500,00');
  await nav.getByRole('button', { name: 'Перемещения', exact: true }).click();
  await page.getByRole('tab', { name: 'Принятые', exact: true }).click();
  const fixed = page.getByRole('dialog', { name: 'Принято: Донор А → Получатель', exact: true });
  const openFixed = () => page.getByRole('button', { name: 'Состав Донор А → Получатель', exact: true }).click();
  await openFixed();
  await expect(fixed).toContainText('Ед. изм.: шт');
  await expect(fixed).toContainText('1 500,00');
  await page.screenshot({ path: testInfo.outputPath('33-frozen-accepted.png') });
  await fixed.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const csvReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV Донор А → Получатель', exact: true }).click();
  const csv = await readFile((await (await csvReady).path())!, 'utf8');
  expect(csv).toContain(';шт;100;1500');
  const excelReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel Донор А → Получатель', exact: true }).click();
  const workbook = XLSX.read(await readFile((await (await excelReady).path())!), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[1]!]!, { header: 1 });
  expect(rows).toContainEqual(['SKU1', 'A1', 'Товар для перемещения', 15, 'шт', 100, 1500]);
  await page.reload();
  await openFixed();
  await expect(fixed).toContainText('Ед. изм.: шт');
  await fixed.getByRole('button', { name: 'Отменить принятие SKU1 Донор А → Получатель', exact: true }).click();
  const revoke = page.getByRole('dialog', { name: 'Отменить принятие перемещения', exact: true });
  await revoke.getByRole('button', { name: 'Отменить принятие', exact: true }).click();
  await expect(revoke).toHaveCount(0);
  await fixed.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(fixed).toHaveCount(0);
  await page.getByRole('button', { name: 'Рассчитать перемещения', exact: true }).click();
  await acceptA();
  await page.getByRole('tab', { name: 'Принятые', exact: true }).click();
  await openFixed();
  await expect(fixed).toContainText('Ед. изм.: упак');
  await page.screenshot({ path: testInfo.outputPath('33-reaccepted-current.png') });
  expect(errors).toEqual([]); expect(remote).toEqual([]);
});
