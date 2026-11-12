import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWorkbook } from '../fixtures/workbookBuilders';

test('E2E-32 shared catalog bootstraps a clean workstation and protects drafts, reviews and archive units', async ({ page }, testInfo) => {
  const first = 'ИП Баранов Роман Борисович';
  const second = 'ООО "Терем"';
  let revision = 1;
  let unit = 'шт';
  await page.exposeFunction('testOpenCatalog', () => ({
    content: {
      kind: 'volmax-supplier-catalog', schemaVersion: 1,
      suppliers: [first, second],
      products: [{ code: 'SKU1', article: 'A-1', name: 'Товар 1', unit }],
      assignments: [{ skuCode: 'SKU1', primary: first, additional: [] }],
    },
    document: { id: '39a9d74f-03be-41da-a23b-a09e0ba7bc64', revision, title: 'Справочник', canEdit: true },
  }));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AppBoxFiles', { value: {
      open: () => (window as unknown as { testOpenCatalog: () => Promise<unknown> }).testOpenCatalog(),
      save: () => Promise.reject(new Error('Публикация не запрашивалась')),
    } });
  });
  const errors: string[] = [];
  const remote: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/i.test(request.url())) remote.push(request.url()); });
  await page.context().setOffline(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href);
  await page.getByRole('button', { name: 'Открыть из AppBox', exact: true }).click();
  await expect(page.getByText(/Общий справочник подключён/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('32-json-bootstrap.png'), fullPage: true });
  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  await expect(nav.getByRole('button', { name: 'Заказы', exact: true })).toHaveCount(0);
  const minMax = (name: string, price: number) => ({ name,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(buildWorkbook([
      ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток', 'Цена'],
      ['SKU1', 'A-1', 'Товар 1', null, null, null, price],
      [null, null, 'Ленина', 0, 1, 2, null],
    ])),
  });
  await page.getByLabel('Выбрать файл Отчёт MIN/MAX').setInputFiles(minMax('shared-week-1.xlsx', 100));
  await page.getByRole('button', { name: 'Перейти к потребности', exact: true }).click();
  await nav.getByRole('button', { name: 'Поставщики', exact: true }).click();
  await page.getByRole('button', { name: 'Связи SKU1', exact: true }).click();
  const links = page.getByRole('dialog', { name: 'Связи товара', exact: true });
  await links.getByRole('combobox', { name: 'Основной поставщик', exact: true }).selectOption(second);
  await links.getByRole('button', { name: 'Сделать основным', exact: true }).click();
  await expect(links.getByRole('region', { name: 'Текущий основной поставщик' })).toContainText(second);
  await links.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  await page.reload();
  await page.getByRole('button', { name: 'Открыть из AppBox', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Подтвердить обновление справочника', exact: true });
  await expect(confirmation).toContainText('неопубликованные изменения');
  await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Связи SKU1', exact: true }).click();
  await expect(links.getByRole('region', { name: 'Текущий основной поставщик' })).toContainText(second);
  await links.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  await page.getByRole('button', { name: 'Открыть из AppBox', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.getByText(/Общий справочник подключён/)).toBeVisible();
  await nav.getByRole('button', { name: 'Заказы', exact: true }).click();
  await page.locator('.order-cell').click();
  const order = page.getByRole('dialog', { name: 'Состав заказа', exact: true });
  await order.getByRole('checkbox', { name: 'Заказ проверен', exact: true }).click();
  await expect(order.getByRole('checkbox', { name: 'Заказ проверен', exact: true })).toBeChecked();
  await order.getByRole('button', { name: 'Закрыть', exact: true }).click();
  unit = 'упак'; revision++;
  await nav.getByRole('button', { name: 'Поставщики', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть / обновить из AppBox', exact: true }).click();
  await expect(confirmation).toContainText('единицы');
  await confirmation.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.getByText(/Общий справочник подключён/)).toBeVisible();
  await nav.getByRole('button', { name: 'Заказы', exact: true }).click();
  await page.locator('.order-cell').click();
  await expect(order.getByRole('checkbox', { name: 'Заказ проверен', exact: true })).not.toBeChecked();
  await expect(order).toContainText('упак');
  await order.getByRole('checkbox', { name: 'Заказ проверен', exact: true }).click();
  await expect(order.getByRole('checkbox', { name: 'Заказ проверен', exact: true })).toBeChecked();
  await order.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await nav.getByRole('button', { name: 'Обновить MIN/MAX', exact: true }).click();
  await page.getByLabel('Выбрать файл Отчёт MIN/MAX').setInputFiles(minMax('shared-week-2.xlsx', 110));
  await page.getByRole('button', { name: 'Перейти к потребности', exact: true }).click();
  await nav.getByRole('button', { name: 'Счета', exact: true }).click();
  const source = page.getByRole('combobox', { name: 'Рабочий сеанс', exact: true });
  const archiveId = await source.locator('option').filter({ hasText: 'shared-week-1.xlsx' }).getAttribute('value');
  expect(archiveId).toBeTruthy();
  await source.selectOption(archiveId!);
  await page.getByRole('checkbox', { name: `Выбрать заказ ${first} — Ленина`, exact: true }).check();
  await page.getByLabel('Файл счёта поставщика').setInputFiles({ name: 'invoice.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(buildWorkbook([
      ['Код 1С', 'Артикул', 'Наименование', 'Количество', 'Ед. измерения', 'Цена', 'Сумма'],
      ['SKU1', 'A-1', 'Товар 1', 2, 'упак', 100, 200],
    ])),
  });
  await page.getByRole('button', { name: 'Сравнить', exact: true }).click();
  const result = page.getByRole('region', { name: 'Результат сверки', exact: true });
  await expect(result.getByRole('row').filter({ hasText: 'Товар 1' })).not.toContainText('Единицы');
  await expect(result.getByRole('button', { name: 'Excel для 1С', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('32-shared-catalog-archived-units.png') });
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});
