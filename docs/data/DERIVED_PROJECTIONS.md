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

If supplier history for one `supplier + skuCode` contains more than one distinct non-empty unit after normalization, set aggregated `unit=null`. Do not invent a conversion. The quantity/amount history remains usable, and UI displays `—` for unit.
