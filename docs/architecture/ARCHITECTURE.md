> **Окончательное уточнение03.11.2026: один денежный фильтр SKU×донор×получатель.** Последний раздел заменяет трактовку SKU×получатель; после денежного постфильтра разрешено частичное покрытие доMAX.

> **Правила29.10.2026 имеют приоритет:** полное покрытие SKU и маршруты по согласованной `2026-10-29-routes-full-coverage-design.md`. Частичное распределение и ручные приоритеты23–28.10 ниже — исторические и заменены уточнением в конце документа.

> **Rebalancing20.10.2026:** для изменённой функции действуют уточнения в конце этого документа и `docs/superpowers/specs/2026-10-20-rebalancing-order-integration-design.md`; исторические правила03.09 в конфликтующей части заменены. PR1 реализует только домен, остальная интеграция — PR2.

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


## Расширение20.10.2026: feature boundary

src/domain/rebalancing/index.ts — публичный вход чистого домена; adapter src/import/rebalanceSnapshot.ts не меняет старый parser. Pure snapshot→proposal/accepted→purchaseDemand→existing orders, без React/storage/network в домене. PR1 оставляет selectors/UI/persistence на legacy input. PR2 подключает полное локальное сохранение raw+normalized reports и всего рабочего сеанса аддитивной миграцией; положение выше «только настройки» сохраняется как описание текущей поставки, не целевого rebalancing workflow. Runtime file:// и portable offline package остаются обязательными.


Уточнение21.10.2026: flow.ts использует min-cost maximum flow с точными BigInt-весами фактически закрываемого Min. Число шагов остаётся целым; полный и частичный вклад последнего шага различаются. economics.ts — единый владелец диагностики оставшихся принятых сумм для команд и нового расчёта; предупреждения не отменяют и не принимают движения.


## Реализация PR2

`app/workspaceSession.ts` сериализует команды и публикует состояние после успешного сохранения. В IndexedDB v4 `persistence/workspaces.ts` сохраняет деловую ревизию, ссылки на исходные файлы и изменившиеся данные отчётов одной CAS-транзакцией. Разобранные отчёты лежат в `workspaceSources` и не перезаписываются при изменении заказа. При чтении адаптер собирает прежний DTO `domain/workspace.ts`. Навигация и фильтры хранятся в `workspaceViews`. Изменения настроек объединяются по полям и не повышают деловую ревизию. Новый отчёт сохраняет прежний workspace и создаёт новый snapshot без переноса accepted/edits. Восстановление истории создаёт копию с прежним snapshotId и сохранёнными решениями.

`app/rebalanceActions.ts` связывает команды домена с общей purchase projection и адресной инвалидацией `domain/rebalanceWorkflow.ts`. `selectors` выдаёт originalDemand/purchaseDemand; Demand/Suppliers/Orders используют одну текущую основу. `movementSummary` агрегирует только принятые IDs с явными единицами; React пояснение не меняет бизнес-состояние. Allocation запускается только явной командой расчёта. Экспорт markers проверяет соответствие фактически выгруженному CSV payload и тому же снимку перед фиксацией.

UI ownership и миграция существующих controls описаны в `UX-CONTRACT.md`; автономные runtime ограничения не изменены.

При повторном открытии из хранилища App сначала инвалидирует прежний session owner, затем назначает новый и увеличивает importEpoch. Отложенные команды и публикации привязаны к owner; transient callbacks дополнительно ограничены поколением импорта. Старое чтение не может заменить новые данные либо снять флаг загрузки в восстановленном сеансе. Необязательный `rebalance.resultScope` хранит точный SKU и стабильный branchId; старые сохранения без поля открываются без ограничения.


### Просмотр документа перемещения22.10.2026

`features/rebalancing/transferDocuments.ts` — чистая проекция proposal/accepted в документы по стабильной направленной паре branch IDs. Метаданные присоединяются только по Коду1С; индексы снимка и accepted totals строятся один раз. Принятая sourceRunId×sourceLineId исключается из предложений без повторного учёта. Проекция вычисляет отдельно физический/учтённый остаток и условный результат принятия одной строки, справочные суммы и количества по единицам; не меняет доменные входы. `ResultsTable` отображает матрицу, `TransferDrawer` — виртуализированный состав без редактирования количества. Используются существующие команды принятия/отмены и общий modal owner. IDB и рабочий DTO не меняются; уже сохранённые сеансы совместимы.


### Три массовых приоритета донора ·28.10.2026

Уровни остаются в чистом allocationPlan, money/coverage в предметной UI-проекции, durable команды в rebalanceActions. Массовый setter материализует решения и вызывает один replan. Очерёдность резервов: accepted/manual, explicit решения в сохранённом порядке, затем автоматический flow. Существующие решения обновляются на месте, новые — в стабильном порядке SKU. Нет новых зависимостей, backend или runtime HTTP.


### Автоматическое полное покрытие ·29.10.2026

Границы остаются pure domain → app CAS commands → derived purchase → existing orders. `calculate.ts` использует прежний `flow.ts` для проверки сети и отбрасывает неполные пробные потоки SKU. `types.ts` определяет структурированные пропуски; `constraints.ts` — сигнатуру участия; `acceptedTransfers.ts` отклоняет старый алгоритм/изменённое участие для новых добавлений. Физические строки inactive сохраняются отдельно от новых разрешённых направлений. Прежние allocationPlan/allocationSplit/donorPriorityLevels и ручные команды удалены, legacy DTO сохраняют совместимость истории.

`routeEditing.ts` владеет чистой атомарной настройкой пары/массового подразделения относительно stable IDs. RoutesMatrix использует общий Dialog и callback в прежнюю durable queue; не держит отдельное business storage. SkippedRebalanceList читает результат, не запускает решатель в React. Нормализация oldtab в initialState применяется к load/restore; ни один из них не запускает скрытый пересчёт/удаление accepted. Подключения, backend и зависимости не добавляются.


### Минимальная сумма SKU в перемещении ·03.11.2026

Чистый domain/rebalancing/transferAmounts.ts владеет чтением совместимых текущих условий и группировкой денежных произведений по SKU×донор×получатель; calculate, acceptance и saved diagnostics используют общий расчёт. Денежный постфильтр не вмешивается в flow и не меняет сохранённый ledger. UI и XLSX отображают SKU и обе стороны исключённой строки. Совместимость аддитивная: optional новый фильтр, неизменная schema workspace, отдельная диагностика legacy acceptedConfig. Старый фильтр цены единицы не применяется к новым действиям.


### Реестр принятых и стабильная шапка ·03.11.2026

AcceptedTransfersView — read-only UI, acceptedTransfersViewModel переиспользует существующую projection и фильтрует документы целиком. transferCsv.ts разделяет сериализатор одиночной/массовой выгрузки, download.ts владеет Blob/именами и скачиванием. Новых доменных правил, storage layer или зависимостей нет. Общие компактные стили шапки принадлежат .rebalancing-page; отдельная accepted viewport-компоновка ограничивает только реестр и не клиппирует Conditions.


### Массовая отмена принятия ·03.11.2026

TransferDrawer является общим владельцем состава из результатов и реестра принятых. Optional bulk revoke callbacks маршрутизируют temporary accepted selection в существующий RebalancingPage confirmation/commit. Дублирующий composition Dialog реестра заменён этим владельцем. Исчезновение последнего принятого направления сохраняет пустую оболочку drawer до закрытия подтверждения; вложенные useModalLayer продолжают соблюдать inert/focus. Нового undo-движка и копии доменной логики нет.


### Явный поставщик без истории ·03.11.2026

SupplierOverride.allowWithoutHistory — opt-in разрешение ручного назначения из существующего supplierPool. Разрешение принадлежит pure resolveSuppliers, цена по-прежнему принадлежит priceDemand. SuppliersPage проверяет текущие кандидаты внутри queued commit; выбор из устаревшего исторического списка не создаёт разрешение без истории. Persistence сохраняет optional поле без миграции. ImportIssues принадлежит feature import и представляет исходные ValidationIssue через канонические SearchInput/Select/VirtualTable; не влияет на нормализацию и расчёты.


### Независимый справочник · 11.11.2026

`domain/supplierCatalog.ts` владеет объединением идентичностей и изменениями связей; `app/catalogSession.ts` связывает справочник с текущим/новым снимком. `persistence/supplierCatalog.ts` загружает и мигрирует отдельную запись; общий `recoverSupplierCatalog` восстанавливает identities из истории при запуске, завершении legacy-настройки и восстановлении legacy-снимка; `saveWorkspace` атомарно сохраняет её вместе со снимком с проверкой ревизии. `workspaceSession` остаётся сериализатором команд и публикует результат только после записи. App подключает загрузку; бизнес-правила каталога не размещены в composition root. Исторические snapshots сохраняют назначения и данные отчётов; live catalog в них не сериализуется.
