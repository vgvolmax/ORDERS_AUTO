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

1. Если SKU имеет `selectedSupplier` и для пары `selectedSupplier + skuCode` есть `weightedUnitCost`, использовать его и `SUPPLIER_HISTORY`.
2. Иначе, если `Sku.referencePrice != null`, использовать её и `MIN_MAX_FALLBACK`.
3. Иначе `unitPrice=null`, `priceSource=MISSING`, `demandAmount=null`.

```text
demandAmount = unitPrice == null ? null : deficitQty * unitPrice
```

Для каждого SKU:

```text
networkDemandAmount = сумма только известных demandAmount по подразделениям
networkMissingPriceCount = количество deficit lines с demandAmount=null
```

В UI сумма с неполным покрытием цен всегда сопровождается `networkMissingPriceCount`; нельзя выдавать её за полную сетевую сумму.

После ручного выбора другого поставщика priced projection пересчитывается, поэтому денежная потребность может измениться при неизменном количестве.

## 2. Unassigned demand

Рабочая supplier resolution строится только из истории поставщиков рабочего пула (`supplierPool.ts`), с прежними overrides и полным набором SKU из MIN/MAX. То же ограничение действует для проверки готовности импорта. Поэтому история только скрытого поставщика даёт `UNRESOLVED`, а сохранённый выбор скрытого поставщика — `STALE_OVERRIDE`; такие SKU сохраняют закупочную потребность, но не создают supplier order. Сводки/цены/выгрузки используют единую отфильтрованную проекцию.

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

`unassigned` показывается на экране поставщиков и учитывается в KPI «требуют решения», но не входит ни в один supplier order до разрешения поставщика.

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
