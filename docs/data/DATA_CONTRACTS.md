> **Rebalancing20.10.2026:** для изменённой функции действуют уточнения в конце этого документа и `docs/superpowers/specs/2026-10-20-rebalancing-order-integration-design.md`; исторические правила03.09 в конфликтующей части заменены. PR1 реализует только домен, остальная интеграция — PR2.

# ORDERS_AUTO — Data Contracts

## 1. Нормализация значений

Для всех импортов:

- строки trim + замена NBSP на обычный пробел + схлопывание повторных пробелов;
- коды 1С всегда строки, ведущие нули сохраняются;
- numeric parser понимает числа Excel и строки с пробелом-разделителем тысяч, запятой или точкой;
- пустая/пробельная ячейка количества остатка подразделения → `0`;
- пустые MIN/MAX/цена → `null`;
- отрицательная закупочная quantity допустима в истории как возврат, но `weightedUnitCost` рассчитывается только если агрегированное `purchaseQty > 0` и `purchaseAmount >= 0`;
- название подразделения сравнивается после нормализации регистра/пробелов, отображается в исходном читаемом виде.

## 2. Domain types

```ts
export type StockStatus =
  | 'NO_NORM'
  | 'OK'
  | 'YELLOW'
  | 'ORANGE'
  | 'LIGHT_RED'
  | 'BELOW_MIN'
  | 'INVALID_NORM';

export interface Sku {
  code: string;
  article: string | null;
  name: string;
  referencePrice: number | null;
  reportedTotalStock: number | null;
}

export interface BranchStock {
  skuCode: string;
  branch: string;
  stock: number;
  min: number | null;
  max: number | null;
}

export interface MinMaxDataset {
  skus: Sku[];
  branchStocks: BranchStock[];
  branches: string[];
}

export interface SupplierHistory {
  supplier: string;
  skuCode: string;
  skuName: string | null;
  unit: string | null;
  purchaseQty: number;
  purchaseAmount: number;
  weightedUnitCost: number | null;
}

export interface SupplierCandidate extends SupplierHistory {}

export interface SupplierOverride {
  skuCode: string;
  supplier: string;
  updatedAt: string;
}

export type SupplierResolutionStatus =
  | 'AUTO_SINGLE'
  | 'MANUAL_SELECTED'
  | 'MANUAL_REQUIRED'
  | 'STALE_OVERRIDE'
  | 'UNRESOLVED';

export interface SupplierResolution {
  skuCode: string;
  selectedSupplier: string | null;
  status: SupplierResolutionStatus;
  candidates: SupplierCandidate[];
  recommendedSupplier: string | null;
}

export type PriceSource = 'SUPPLIER_HISTORY' | 'MIN_MAX_FALLBACK' | 'MISSING';

export interface DemandLine {
  skuCode: string;
  article: string | null;
  name: string;
  branch: string;
  stock: number;
  min: number | null;
  max: number | null;
  status: StockStatus;
  deficitQty: number;
  deficitPct: number | null;
  networkDeficitQty: number;
  referencePrice: number | null;
}

export interface OrderQtyEdit {
  skuCode: string;
  branch: string;
  qty: number;
}

export type ThresholdMode = 'SUPPLIER_TOTAL' | 'BRANCH_SUPPLIER';

export interface OrderSettings {
  minimumOrderAmount: number;
  thresholdMode: ThresholdMode;
}

export interface OrderLine {
  skuCode: string;
  article: string | null;
  name: string;
  branch: string;
  supplier: string;
  calculatedQty: number;
  orderQty: number;
  unit: string | null;
  unitPrice: number | null;
  priceSource: PriceSource;
  amount: number | null;
  warnings: string[];
}

export type OrderStatus = 'DRAFT' | 'BLOCKED' | 'READY' | 'EXPORTED';

export interface Order {
  id: string;
  branch: string;
  supplier: string;
  lines: OrderLine[];
  totalQty: number;
  totalAmount: number | null;
  belowThreshold: boolean;
  status: OrderStatus;
  blockers: string[];
}
```

## 3. Min-Max parsing contract

### SKU block detection

1. Найти строку с непустым `Код`.
2. Собрать следующие строки до следующей строки с непустым `Код`.
3. Среди них найти branch rows: `Код` и `Артикул` пусты, `Номенклатура` непустая, а колонки количества/MIN/MAX соответствуют числовому/пустому формату.
4. Если branch rows нет — исходная строка считается групповой/служебной и игнорируется.
5. Если есть хотя бы одна branch row — создать `Sku` и `BranchStock[]`.

Если одна и та же пара `skuCode + branch` встречается повторно, это validation error; использовать последнюю строку нельзя молча.

### Control check

Если `reportedTotalStock` задан, сравнить его с суммой branch stocks. При расхождении >0.01 создать warning `TOTAL_STOCK_MISMATCH`, но расчёт вести по branch stocks.

## 4. Supplier parsing contract

Парсер и сохранённый `SupplierDataset` содержат полный исходный список, включая поставщиков вне рабочего пула. Ограничение32 поставщиков по `SPEC.md` применяется при построении рабочей проекции; оно не меняет parsing, SKU keys, названия в истории/назначениях и storage DTO.

Парсер должен сначала найти header row по alias-наборам, а не фиксированному номеру строки.

Минимально распознаваемые aliases:

```ts
const aliases = {
  supplier: ['контрагент', 'поставщик'],
  skuCode: ['код', 'код номенклатуры'],
  skuName: ['номенклатура', 'товар'],
  quantity: ['количество', 'кол-во'],
  amount: ['стоимость', 'сумма'],
  unit: ['ед. изм.', 'единица измерения', 'единица']
};
```

Поддержать:

- flat layout: supplier находится в каждой item row;
- grouped layout: строка с supplier и пустым skuCode задаёт `currentSupplier`, последующие item rows используют его до следующей supplier row.

Item row валидна, если есть `skuCode` и числовое quantity/amount хотя бы в одном из полей. Строки итогов (`Итого`, `Всего`) исключаются.

После parsing одинаковые `supplier + skuCode` агрегируются суммой quantity/amount.

## 5. ValidationIssue

```ts
export type ValidationSeverity = 'WARNING' | 'ERROR';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code:
    | 'MISSING_REQUIRED_COLUMN'
    | 'NO_SKU_BLOCKS'
    | 'NO_BRANCHES'
    | 'DUPLICATE_SKU_BRANCH'
    | 'INVALID_NORM'
    | 'TOTAL_STOCK_MISMATCH'
    | 'MISSING_REFERENCE_PRICE'
    | 'NO_SUPPLIER_HISTORY'
    | 'MULTIPLE_SUPPLIERS'
    | 'MISSING_ORDER_PRICE'
    | 'STALE_SUPPLIER_OVERRIDE';
  message: string;
  skuCode?: string;
  branch?: string;
  row?: number;
}
```

Fatal import означает только невозможность получить полезный dataset целиком. Ошибка одной строки не должна срывать весь импорт.


## Расширение20.10.2026: отдельные rebalancing-контракты

Контракты расположены в src/domain/rebalancing/types.ts: версия снимка, стабильный branch registry, политики unit/step, proposal и accepted identities. Код1С остаётся единственным SKU join key; branch IDs не являются названием. Pure RebalanceResult не содержит UUID/clock; RebalanceProposal добавляет app metadata. AcceptedTransfer хранит snapshotId/sourceRunId/sourceLineId/transferId, qty и копию условий. Legacy MinMaxDataset не получает вымышленные reserves/units/steps. PurchaseDemandLine расширяет PricedDemandLine, не меняя исходные stock/deficitQty. API и конкретные типы документируются в новом design и implementation plan; PR1 не меняет формат импортов/постоянное хранилище.


Уточнение21.10.2026: `AcceptedTransferChange.diagnostics` обязателен и содержит `RebalanceIssue[]` после accept/revoke, включая no-op. Предупреждения accepted economics содержат sourceRunId/configFingerprint/quantity/amount/threshold; они не меняют ledger и возвращаются также в RebalanceResult.exclusions. Группировка — sourceRunId×SKU×сохранённая конфигурация, а не общая сумма разных расчётов.

### Editable RebalanceProposal ·23.10.2026

Proposal.transfers — текущий конкретный план до принятия. Необязательные allocationRevision (монотонная ревизия правок), allocationModes: Record<branchId, PROPORTIONAL|EQUAL> и allocationDecisions: Array<{skuCode,fromBranchId,recipientIds,mode:PRIORITY|MANUAL,quantities?:Record<branchId,number>}> сохраняются внутри прежнего workspace schemaVersion1. Отсутствующие поля означают исходный автоматический план; миграция не нужна. Порядок решений задаёт порядок резервирования приоритетных групп. Сначала резервируются весь accepted ledger и ручные группы, затем приоритетные, затем остаток распределяет исходный Min-first flow для автоматических доноров. Исходная eligibleRecipientKeys и captured config неизменны. SourceLineId по-прежнему tuple SKU/from/to; принятый source текущего run неизменяем. Поля balances/uncoveredNeed пересобираются по accepted + pending без двойного учёта. inputFingerprint сохраняет исходные входы расчёта, allocationRevision обозначает последующие правки.
