> **Окончательное уточнение03.11.2026: один денежный фильтр SKU×донор×получатель.** Последний раздел заменяет трактовку SKU×получатель; после денежного постфильтра разрешено частичное покрытие доMAX.

> **Правила29.10.2026 имеют приоритет:** полное покрытие SKU и маршруты по согласованной `2026-10-29-routes-full-coverage-design.md`. Частичное распределение и ручные приоритеты23–28.10 ниже — исторические и заменены уточнением в конце документа.

> **Rebalancing20.10.2026:** для изменённой функции действуют уточнения в конце этого документа и `docs/superpowers/specs/2026-10-20-rebalancing-order-integration-design.md`; исторические правила03.09 в конфликтующей части заменены. PR1 реализует только домен, остальная интеграция — PR2.

# ORDERS_AUTO — Derived Projections

Этот документ дополняет `DATA_CONTRACTS.md` вычисляемыми моделями. Они не являются отдельным источником данных и каждый раз строятся из normalized input + supplier resolution + session edits.

## 1. Priced demand

`DemandLine` содержит физическую потребность. Для UI денежных значений поверх него строится:

```ts
export interface PricedDemandLine extends DemandLine {
  selectedSupplier: string | null;
  supplierResolutionStatus: SupplierResolutionStatus;
  unit: string | null;
  unitPrice: number | null;
  priceSource: PriceSource;
  demandAmount: number | null;
  networkDemandAmount: number;
  networkMissingPriceCount: number;
}
```

### Price rule

Для каждой demand line:

1. Использовать валидную `Sku.referencePrice` из текущего MIN/MAX и источник `MIN_MAX`.
2. Для отсутствующей или некорректной цены установить `unitPrice: null` и `MISSING`. Потребность в количестве продолжает рассчитываться.
3. Основной поставщик определяется сохранённой связью. История закупок помогает определить единицу измерения и не участвует в цене.

```text
demandAmount = unitPrice == null ? null : deficitQty * unitPrice
```

Для каждого SKU:

```text
networkDemandAmount = сумма только известных demandAmount по подразделениям
networkMissingPriceCount = количество deficit lines с demandAmount=null
```

В UI сумма с неполным покрытием цен всегда сопровождается `networkMissingPriceCount`; нельзя выдавать её за полную сетевую сумму.

После ручного выбора другого основного та же потребность переходит к другому поставщику. Цена текущего MIN/MAX и количество позиции сохраняются. Суммы по поставщикам и прохождение порогов пересчитываются.

## 2. Unassigned demand

Рабочая проекция берёт SKU из текущего MIN/MAX и читает основной и дополнительные связи из `supplierAssignments`. Позиции без основного поставщика сохраняют закупочную потребность и ждут назначения. Сводки, заказы и выгрузки используют основного поставщика.

Дефицит не должен исчезать только потому, что поставщик не разрешён.

```ts
export interface UnassignedDemand {
  demand: PricedDemandLine;
  supplierResolution: SupplierResolution;
  blocker:
    | 'NO_SUPPLIER'
    | 'MULTIPLE_SUPPLIERS_REQUIRE_CHOICE'
    | 'STALE_SUPPLIER_OVERRIDE';
}

export interface OrderProjection {
  orders: Order[];
  unassigned: UnassignedDemand[];
}
```

Mapping:

- `UNRESOLVED` → `NO_SUPPLIER`;
- `MANUAL_REQUIRED` → `MULTIPLE_SUPPLIERS_REQUIRE_CHOICE`;
- `STALE_OVERRIDE` → `STALE_SUPPLIER_OVERRIDE`.

`unassigned` сохраняет потребность SKU до назначения основного поставщика. Карточка готовности импорта и фильтр «Без основного» помогают найти такие позиции.

## 3. Supplier summaries

```ts
export interface SupplierSummary {
  supplier: string;
  skuCount: number;
  branchCount: number;
  belowMinSkuCount: number;
  totalQty: number;
  totalAmount: number | null;
  missingPriceLineCount: number;
  belowThreshold: boolean;
}
```

Supplier summary строится из `OrderProjection.orders`. Если хотя бы одна положительная строка поставщика не имеет цены, `totalAmount=null`; рядом отображается `missingPriceLineCount`.

## 4. Network SKU summary

```ts
export interface NetworkSkuSummary {
  skuCode: string;
  article: string | null;
  name: string;
  worstStatus: StockStatus;
  deficitBranchCount: number;
  belowMinBranchCount: number;
  totalDeficitQty: number;
  totalDemandAmount: number;
  missingPriceCount: number;
  supplierResolutionStatus: SupplierResolutionStatus;
  selectedSupplier: string | null;
  branches: PricedDemandLine[];
}
```

Worst-status severity order:

```text
INVALID_NORM > BELOW_MIN > LIGHT_RED > ORANGE > YELLOW > OK > NO_NORM
```

## 5. Order status rule

Generated orders use only three effective states in MVP:

- `READY` — all positive lines have a selected supplier and price, and order passes configured threshold;
- `BLOCKED` — missing price or below threshold;
- `EXPORTED` — same order was successfully exported in the current session.

`DRAFT` remains reserved in the base type for future workflow but is not emitted by `buildOrderProjection()` in MVP.

## 6. Unit conflict rule

If supplier history for one `supplier + skuCode` contains more than one distinct non-empty unit after normalization:

- aggregated `unit=null`;
- do not invent a conversion;
- emit validation issue code `MIXED_UNITS` with severity `WARNING`;
- quantity/amount history remains usable;
- UI displays `—` for unit.

`MIXED_UNITS` extends the `ValidationIssue.code` union declared in `DATA_CONTRACTS.md` and must be included in the TypeScript implementation.


## Расширение20.10.2026: текущая потребность

buildPurchaseDemand(originalPricedDemand,accepted,branchRegistry) формирует PurchaseDemandLine. projectedStock=stock−acceptedOutgoingQty+acceptedIncomingQty; purchaseQty=max(0,Max−projectedStock) при валидном закупочном нормативе; purchaseAmount=null без цены. Исходные deficitQty/stock/status сохраняются; purchaseStatus считается по projectedStock. Общий buildOrderProjection использует purchaseQty для нового input и deficitQty для legacy input; calculatedQty, warnings, amounts, thresholds и unassigned должны использовать одну и ту же текущую базу. Сетевые purchase totals/missing-price counts отдельные от исходных networkDemandAmount. Без accepted поведение эквивалентно исходному.

### Проекция приоритетов ·23.10.2026

allocationPlan.buildDonorAllocationModel строит матрицу SKU/получатель из валидного снимка, текущего proposal и accepted ledger. Потребность: настроенная цель − физический остаток − весь принятый вход, с округлением вниз до шага. План других доноров показан отдельно и не скрывает доступных для явного выбора получателей. Признак priorityRequired относится к автоматической группе, когда её доступного излишка не хватает на остаточную потребность нескольких получателей после предложений других доноров. Принятие таких исходных строк блокируется на доменном уровне, UI-флажки выбора к принятию независимы от приоритетов. Редактирование плана не участвует в purchaseDemand; только последующее принятие меняет потребность, пересмотр заказов и экспорт.

Прогноз матрицы отражает полный proposal, включая ранее отклонённые предложения. Отклонённая часть своего/чужого плана раскрывается отдельно; отклонение предложения не отзывает физический излишек. Результаты и принятие по-прежнему исключают отклонённые source IDs. При цели ниже Max отдельно выводится потребность до настроенной цели и до Max.


### Три массовых приоритета донора ·28.10.2026

buildDonorPrioritySummary — единственная проекция групп/сумм/покрытия. Деньги через buildTransferDocuments/summarizeTransferDocuments, unknown остаётся null. Покрытие unique SKU проверяет исходный положительный Max-дефицит допустимых получателей и stock+acceptedIn−acceptedOut+неотклонённый pendingIn−pendingOut всей сети; принятые sources текущего run исключены из pending. Неустранимый остаток меньше шага не округляется в FULL. Scoped IDs разрешает donorAcceptanceIds из committed state без фильтра/selection.


### Полное покрытие и пропуски ·29.10.2026

Прежние проекции приоритетов и уровней больше не действуют. Чистый calculateRebalance строит один поток SKU по всей сети, проверяет каждого получателя до настроенной цели и публикует весь поток либо ноль. Недопустимые дробные остатки не считаются полным покрытием после округления вниз. Структурированный skippedSkus содержит диагностическую ёмкость; balances/uncoveredNeed строятся только из действительно опубликованных предложений и accepted.

`features/rebalancing/skippedRebalance.ts` — чистый владелец сводки pending и всей пропущенной потребности, справочных сумм и количества по единицам. Pending исключает rejected и sourceRunId×sourceLineId уже принятых строк, не зависит от поисковых фильтров. Количества разных единиц не объединяются; missing-price сумма остаётся null. Потребность14/максимум12 даёт «Не распределено14», missing2 только в подробностях. Заказовый pipeline продолжает получать только accepted, без trial/pending/skipped.


### Закупочные ограничения данных ·03.11.2026

collectPurchasingIssues(dataset,sourceIssues) индексирует дубли кодов/срезов и source errors. buildOrderProjection принимает необязательный пятый аргумент dataIssues; positive affected lines дают жёсткий blocker MIN/MAX. Пропущенные повреждённые строки представлены в projection.dataIssues, не заменяются нулевой потребностью и не добавляются в unassigned как выдуманные физические данные. buildAcceptedTransferStatePatch сохраняет тот же список ограничений при адресной инвалидации заказа.

Для старого нормализованного дубля calculateDemand оставляет одну provisional строку для просмотра, а issue блокирует её заказ; отдельная валидация accepted ledger сохраняется. Все источники unitPrice проверяются на конечность/неотрицательность, конфликтный fallback повторного SKU неизвестен. moneyProduct/moneySum используют общий domain/decimal, а moneyProductsLessThan сравнивает исходные qty×price до Number-conversion.


### Минимальная сумма SKU у получателя ·03.11.2026

По уточнению пользователя денежный skuAmountFilter сравнивает отдельно каждое подразделение-получатель: остаточная потребность до настроенной цели × referencePrice ≥ threshold. Равенство допускается. Получатели ниже порога исключаются до flow и не участвуют в проверке полного покрытия; общая сумма по сети не используется. Излишек распределяется только на прошедших получателей. Входы нескольких доноров одному получателю суммируются. Отдельный unitPriceFilter по-прежнему использует строгое сравнение цены единицы.

Принятие повторно проверяет сумму принятого SKU отдельно по run×recipient; отмена остаётся доступной и даёт адресное предупреждение ниже порога, включая для ранее сохранённых движений. Новая версия алгоритма требует пересчёта старых планов для новых добавлений; accepted/no-op/revoke и их влияние на закупку сохранены.


### Минимальная сумма SKU в перемещении ·03.11.2026

calculateRebalance сначала строит полностью покрывающие SKU потоки, затем исключает строки ниже getTransferAmountFilter(config).threshold отдельно по SKU×from×to. balances и uncoveredNeed рассчитываются по оставшимся transfers. skippedSkus описывает только исходную невозможность полного покрытия; денежные исключения находятся в exclusions с SKU и направлением. acceptTransfers проверяет сумму выбранного SKU вместе с уже принятыми строками того же run×SKU×from×to; другие SKU, направления и runs не помогают пройти порог. Новые принятые условия фиксируют transferAmountFilter, отмена ниже порога разрешена с адресной диагностикой. Purchasing по-прежнему учитывает только accepted.


### Реестр принятых и стабильная шапка ·03.11.2026

buildAcceptedDocuments использует существующую TransferDocument projection с proposal=null и полным committed ledger. filterAcceptedDocuments фильтрует целые документы по IDs отправителя/получателя и поиску кода/артикула/названия/направления; состав документа не обрезается. totals считаются только из принятых строк, неизвестная цена не заменяется0. CSV parent заново разрешает запрошенные IDs в полном accepted projection; rowsToCsv формирует один заголовок и from/to в каждой товарной строке.


### Массовая отмена принятия ·03.11.2026

Состав направления выводит разные checkbox-состояния для PROPOSED/sourceLineId и ACCEPTED/transferId. Массовая отмена состава разрешает только выбранные accepted IDs текущего локального поиска; другие SKU/скрытые строки не добавляются. Реестр направлений разрешает полный принятый состав отмеченных документов независимо от отображения фильтров, включая явно посчитанный скрытый выбор. Preview/commit повторно используют существующий accepted→purchaseDemand workflow.


### Справочник и историческая проекция · 11.11.2026

Потребность, заказы, выгрузки и сверка всегда читают `supplierAssignments` выбранного снимка. Они не обращаются к изменяемому справочнику. Каталог редактирования читает `AppState.catalog.products/assignments`, текущий MIN/MAX задаёт только присутствие и потребность. Новый MIN/MAX копирует актуальные назначения; явная правка каталога синхронизирует только изменённые коды в текущую рабочую копию, используя прежнюю адресную инвалидацию отметок заказов.
