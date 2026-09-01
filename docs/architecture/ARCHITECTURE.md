# ORDERS_AUTO — Technical Architecture

## 1. Deployment model

**ORDERS_AUTO — автономное локальное статическое приложение, поставляемое как папка/архив. Пользовательская точка входа — `index.html`, который должен запускаться напрямую через `file://` в актуальном Chrome/Edge без web server и доступа в интернет. Количество файлов внутри production-пакета не ограничено. Все runtime-ресурсы должны находиться внутри пакета и подключаться переносимыми относительными путями.**

Production artifact — автономная статическая папка приложения. Точная структура `assets/` и количество JS/CSS/прочих файлов не являются архитектурным контрактом.

Рекомендуемый stack:

- React + TypeScript + Vite;
- `xlsx` (SheetJS CE) — чтение `.xls` и `.xlsx` в браузере;
- `exceljs` — формирование оформленного `.xlsx` поставщику;
- `jszip` — пакетная выгрузка CSV;
- `idb` — тонкая обёртка над IndexedDB;
- `@tanstack/react-table` + `@tanstack/react-virtual` — большие таблицы;
- Vitest + React Testing Library + jsdom — тесты.

Не использовать backend, server-side rendering, Electron, локальный web server и локальную БД. Runtime HTTP/HTTPS requests, CDN, внешние API, telemetry и analytics запрещены. Пользовательский компьютер не требует Node.js/npm/Python или установки зависимостей.

## 2. Source layout

```text
src/
  app/
    App.tsx
    appStore.ts
    selectors.ts
  domain/
    types.ts
    demand.ts
    suppliers.ts
    orders.ts
    validation.ts
  import/
    workbook.ts
    minMaxParser.ts
    supplierParser.ts
  persistence/
    db.ts
    supplierOverrides.ts
    settings.ts
  export/
    csv.ts
    supplierWorkbook.ts
    filenames.ts
  features/
    import/ImportPage.tsx
    demand/DemandPage.tsx
    suppliers/SuppliersPage.tsx
    orders/OrdersPage.tsx
    orders/OrderDrawer.tsx
  components/
    StatusBadge.tsx
    VirtualTable.tsx
    FiltersBar.tsx
    KpiCard.tsx
  styles/
    app.css
  main.tsx

tests/
  fixtures/
    workbookBuilders.ts
  domain/
  import/
  export/
  ui/
```

Каждый доменный файл содержит чистые функции и не импортирует React.

## 3. Data flow

```text
File inputs
  ↓
workbook adapters (ArrayBuffer → rows)
  ↓
MinMax parser + Supplier parser
  ↓
normalized domain records + validation issues
  ↓
supplier resolution + demand calculation
  ↓
order projection
  ↓
React selectors / tables
  ↓
CSV / supplier XLSX
```

Исходные workbook rows после нормализации не должны использоваться UI напрямую.

## 4. State model

В памяти текущей сессии:

- metadata загруженных файлов;
- normalized SKU/branch stocks;
- supplier history;
- validation issues;
- derived demand/order state;
- ручные изменения `orderQty`;
- отметка `EXPORTED`.

В IndexedDB между сессиями:

- ручной mapping `skuCode → supplier`;
- `minimumOrderAmount`;
- threshold mode;
- last UI filter preferences.

Сырые Excel-файлы и полный импорт не сохраняются в IndexedDB в MVP.

## 5. Derivation, not mutation

`DemandLine`, supplier summaries и orders строятся как derived projections из normalized input + persisted mappings + session edits. Не дублировать вычисляемые суммы в нескольких stores.

Рекомендуемые чистые API:

```ts
parseMinMaxWorkbook(input: ArrayBuffer): ParseResult<MinMaxDataset>
parseSupplierWorkbook(input: ArrayBuffer): ParseResult<SupplierDataset>
calculateDemand(dataset: MinMaxDataset): DemandLine[]
resolveSuppliers(history: SupplierHistory[], overrides: SupplierOverride[]): SupplierResolution[]
buildOrders(demand: DemandLine[], resolutions: SupplierResolution[], edits: OrderQtyEdit[], settings: OrderSettings): Order[]
```

## 6. Performance

Текущий Min-Max порядка 30k строк после разворачивания. Это небольшой объём для браузера, но UI не должен рендерить тысячи DOM-строк одновременно.

- parsing и расчёты допускаются в main thread;
- таблицы >200 строк виртуализируются;
- derived maps индексируются по `skuCode`/`branch` один раз на расчёт;
- избегать вложенного `Array.find` в циклах по всем строкам;
- Web Worker в MVP не нужен.

## 7. Offline static build

Build acceptance:

- build создаёт автономную production-папку с `index.html`;
- `index.html` запускается напрямую через `file://` в актуальном Chrome/Edge;
- все runtime JS/CSS/assets находятся внутри production-папки и подключаются относительными путями;
- нет runtime HTTP/HTTPS requests, внешних API, CDN, remote fonts/scripts, telemetry или analytics;
- приложение не требует web server или установленного runtime;
- копирование или перемещение всей папки не ломает приложение;
- количество production-файлов не ограничено.

`npm run build` компилирует React/TypeScript в classic IIFE bundle, сохраняет JS и CSS отдельными локальными файлами и формирует `dist/ORDERS_AUTO/index.html`. Затем `scripts/assert-offline-package.mjs` проверяет entry, переносимые ссылки и полноту package. Generated `dist/` не коммитится; application bundle нельзя встраивать обратно в HTML.

## 8. Error boundaries

Ошибки делятся на:

- `fatal import error` — файл нельзя разобрать / нет требуемой структуры; пользователь остаётся на экране импорта;
- `row warning` — конкретная позиция неполная/невалидная, остальной dataset продолжает работать;
- `order blocker` — заказ виден, но не `READY`;
- `export error` — не меняет расчётные данные, пользователь получает понятное сообщение и может повторить экспорт.

Технические stack traces не показывать пользователю.
