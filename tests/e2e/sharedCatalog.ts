import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppBoxFilesBridge } from '../../src/appbox/supplierCatalogBridge';
import { buildWorkbook } from '../fixtures/workbookBuilders';

test('E2E-32 shared catalog bootstraps a clean workstation and protects drafts, reviews and archive units', async ({ page }, testInfo) => {
  const first = 'ИП Баранов Роман Борисович';
  const second = 'ООО "Терем"';
  const id = '39a9d74f-03be-41da-a23b-a09e0ba7bc64';
  let revision = 1;
  let published: { content: unknown; options: unknown } | undefined;
  let unit = 'шт';
  await page.exposeFunction('testOpenCatalog', () => ({
    content: {
      kind: 'volmax-supplier-catalog', schemaVersion: 1,
      suppliers: [first, second],
      products: [{ code: 'SKU1', article: 'A-1', name: 'Товар 1', unit }],
      assignments: [{ skuCode: 'SKU1', primary: first, additional: [] }],
    },
    document: { id, revision, title: 'Справочник', canEdit: true },
  }));
  await page.exposeFunction('testSaveCatalog', (content: unknown, options: unknown) => {
    published = { content, options };
    return { destination: 'appbox', document: { id, revision: revision + 1, title: 'Справочник', canEdit: true } };
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AppBoxFiles', { value: {
      open: () => (window as unknown as { testOpenCatalog: () => Promise<unknown> }).testOpenCatalog(),
      save: (content: unknown, options: Parameters<AppBoxFilesBridge['save']>[1]) =>
        (window as unknown as { testSaveCatalog: AppBoxFilesBridge['save'] }).testSaveCatalog(content, options),
    } });
  });
  const errors: string[] = [];
  const remote: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/i.test(request.url())) remote.push(request.url()); });
  await page.context().setOffline(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  const entry = pathToFileURL(resolve('dist/ORDERS_AUTO/index.html')).href;
  const wrapper = testInfo.outputPath('shared-catalog-frame.html');
  mkdirSync(dirname(wrapper), { recursive: true });
  writeFileSync(wrapper, `<!doctype html>
    <iframe sandbox="allow-scripts allow-same-origin allow-downloads" src="${entry}"
      style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>`);
  await page.goto(pathToFileURL(wrapper).href);
  const app = page.frameLocator('iframe');
  await app.getByRole('button', { name: 'Открыть из AppBox', exact: true }).click();
  await expect(app.getByText(/Общий справочник подключён/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('32-json-bootstrap.png'), fullPage: true });
  const nav = app.getByRole('navigation', { name: 'Основная навигация' });
  await expect(nav.getByRole('button', { name: 'Заказы', exact: true })).toHaveCount(0);
  const minMax = (name: string, price: number) => ({ name,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(buildWorkbook([
      ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток', 'Цена'],
      ['SKU1', 'A-1', 'Товар 1', null, null, null, price],
      [null, null, 'Ленина', 0, 1, 2, null],
    ])),
  });
  await app.getByLabel('Выбрать файл Отчёт MIN/MAX').setInputFiles(minMax('shared-week-1.xlsx', 100));
  await app.getByRole('button', { name: 'Перейти к потребности', exact: true }).click();
  await nav.getByRole('button', { name: 'Поставщики', exact: true }).click();
  await app.getByRole('button', { name: 'Связи SKU1', exact: true }).click();
  const links = app.getByRole('dialog', { name: 'Связи товара', exact: true });
  await links.getByRole('combobox', { name: 'Основной поставщик', exact: true }).selectOption(second);
  await links.getByRole('button', { name: 'Сделать основным', exact: true }).click();
  await expect(links.getByRole('region', { name: 'Текущий основной поставщик' })).toContainText(second);
  await links.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  await page.reload();
  await app.getByRole('button', { name: 'Управление справочником', exact: true }).click();
  await app.getByRole('button', { name: 'Открыть из AppBox', exact: true }).click();
  const confirmation = app.getByRole('dialog', { name: 'Подтвердить обновление справочника', exact: true });
  await expect(confirmation).toContainText('неопубликованные изменения');
  await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click();
  await app.getByRole('button', { name: 'Связи SKU1', exact: true }).click();
  await expect(links.getByRole('region', { name: 'Текущий основной поставщик' })).toContainText(second);
  await links.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  await app.getByRole('button', { name: 'Открыть из AppBox', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Заменить локальную копию', exact: true }).click();
  await expect(app.getByText(/Общий справочник подключён/)).toBeVisible();
  await nav.getByRole('button', { name: 'Заказы', exact: true }).click();
  await app.locator('.order-cell').click();
  const order = app.getByRole('dialog', { name: 'Состав заказа', exact: true });
  await order.getByRole('switch', { name: 'Заказ проверен', exact: true }).click();
  await expect(order.getByRole('switch', { name: 'Заказ проверен', exact: true })).toBeChecked();
  await order.getByRole('button', { name: 'Закрыть', exact: true }).click();
  unit = 'упак'; revision++;
  await nav.getByRole('button', { name: 'Поставщики', exact: true }).click();
  await app.getByRole('button', { name: 'Управление справочником', exact: true }).click();
  await app.getByRole('button', { name: 'Открыть / обновить из AppBox', exact: true }).click();
  await expect(confirmation).toContainText('единицы');
  await confirmation.getByRole('button', { name: 'Заменить локальную копию', exact: true }).click();
  await expect(app.getByText(/Общий справочник подключён/)).toBeVisible();
  await nav.getByRole('button', { name: 'Заказы', exact: true }).click();
  await app.locator('.order-cell').click();
  await expect(order.getByRole('switch', { name: 'Заказ проверен', exact: true })).not.toBeChecked();
  await expect(order).toContainText('упак');
  await order.getByRole('switch', { name: 'Заказ проверен', exact: true }).click();
  await expect(order.getByRole('switch', { name: 'Заказ проверен', exact: true })).toBeChecked();
  await order.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await nav.getByRole('button', { name: 'Обновить MIN/MAX', exact: true }).click();
  await app.getByLabel('Выбрать файл Отчёт MIN/MAX').setInputFiles(minMax('shared-week-2.xlsx', 110));
  await app.getByRole('button', { name: 'Перейти к потребности', exact: true }).click();
  await nav.getByRole('button', { name: 'Счета', exact: true }).click();
  const source = app.getByRole('combobox', { name: 'Рабочий сеанс', exact: true });
  const archiveId = await source.locator('option').filter({ hasText: 'shared-week-1.xlsx' }).getAttribute('value');
  expect(archiveId).toBeTruthy();
  await source.selectOption(archiveId!);
  await app.getByRole('checkbox', { name: `Выбрать заказ ${first} — Ленина`, exact: true }).check();
  await app.getByLabel('Файл счёта поставщика').setInputFiles({ name: 'invoice.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(buildWorkbook([
      ['Код 1С', 'Артикул', 'Наименование', 'Количество', 'Ед. измерения', 'Цена', 'Сумма'],
      ['SKU1', 'A-1', 'Товар 1', 2, 'упак', 100, 200],
    ])),
  });
  await app.getByRole('button', { name: 'Сравнить', exact: true }).click();
  const result = app.getByRole('region', { name: 'Результат сверки', exact: true });
  await expect(result.getByRole('row').filter({ hasText: 'Товар 1' })).not.toContainText('Единицы');
  const correction = app.getByRole('region', { name: 'Корректировка и экспорт в 1С', exact: true });
  await expect(correction.getByRole('button', { name: 'Excel для 1С', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('32-shared-catalog-archived-units.png'), fullPage: true });
  await nav.getByRole('button', { name: 'Поставщики', exact: true }).click();
  const bySupplier = app.getByRole('button', { name: 'По поставщикам', exact: true });
  await bySupplier.click();
  await app.getByRole('button', { name: 'Добавить поставщика', exact: true }).click();
  const add = app.getByRole('dialog', { name: 'Добавить поставщика', exact: true });
  const supplierName = add.getByRole('textbox', { name: 'Наименование поставщика' });
  await expect(supplierName).toBeFocused();
  await supplierName.fill('ооо «терем»');
  await supplierName.press('Enter');
  await expect(add.getByRole('alert')).toContainText('уже есть');
  const added = 'ООО "САБЛАЙН СЕРВИС"';
  await supplierName.fill(added);
  await add.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(add).toHaveCount(0);
  await app.getByRole('textbox', { name: 'Поиск поставщика' }).fill('ООО «Саблайн Сервис»');
  await expect(app.getByRole('table', { name: 'По поставщикам' })).toContainText(added);
  await app.getByRole('button', { name: 'Сохранить в AppBox', exact: true }).click();
  await expect(app.getByText('Общий справочник сохранён в AppBox.', { exact: true })).toBeVisible();
  expect(published).toMatchObject({
    content: { suppliers: [first, second, added], assignments: [{ skuCode: 'SKU1', primary: first, additional: [] }] },
    options: { document: { id, revision } },
  });
  await page.reload();
  await app.getByRole('button', { name: 'Связи SKU1', exact: true }).click();
  await expect(links.getByRole('combobox', { name: 'Основной поставщик', exact: true })).toContainText(added);
  await expect(links.getByRole('region', { name: 'Текущий основной поставщик' })).toContainText(first);
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});
