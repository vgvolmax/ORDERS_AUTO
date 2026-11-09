> **Окончательное уточнение03.11.2026: один денежный фильтр SKU×донор×получатель.** Последний раздел заменяет трактовку SKU×получатель; после денежного постфильтра разрешено частичное покрытие доMAX.

> **Правила29.10.2026 имеют приоритет:** полное покрытие SKU и маршруты по согласованной `2026-10-29-routes-full-coverage-design.md`. Частичное распределение и ручные приоритеты23–28.10 ниже — исторические и заменены уточнением в конце документа.

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

export interface SupplierAssignment {
  skuCode: string;
  primary: string | null;
  additional: string[];
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

export type PriceSource = 'MIN_MAX' | 'MISSING';

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
4. Повреждённая строка с той же идентичностью распознаётся по названию/алиасу сохранённого реестра, валидному вхождению подразделения в любой части текущего файла либо заполненным MIN/MAX. Она создаёт `INVALID_BRANCH_VALUES` с кодом SKU, подразделением и номером строки; название остаётся в `branches`, физический `BranchStock` не создаётся.
5. Если есть хотя бы одна валидная или распознанная повреждённая строка подразделения — создать `Sku`. Полностью повреждённый товарный блок не исчезает. Только блоки без таких строк считаются групповыми/служебными и игнорируются; неизвестная подпись без MIN/MAX не становится подразделением.

Если одна и та же пара `skuCode + branch` встречается повторно, это validation error; использовать последнюю строку нельзя молча.

### Control check

Если `reportedTotalStock` задан, сравнить его с суммой branch stocks. При расхождении >0.01 создать warning `TOTAL_STOCK_MISMATCH`, но расчёт вести по branch stocks.

## 4. Supplier parsing contract

Парсер и сохранённый `SupplierDataset` содержат полный исходный список, включая поставщиков вне рабочего пула. Ограничение32 поставщиков по `SPEC.md` применяется при построении рабочей проекции; он применяется при заполнении связей. Исходные названия сохраняются в отчёте, а связи используют канонические имена рабочего пула.

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


### Три массовых приоритета донора ·28.10.2026

В RebalanceProposal добавлено optional allocationPriorityLevels: Record<donorId,[string[],string[],string[]]>. PRIORITY-решения получают optional recipientLevels того же типа; recipientIds отражает первый уровень. Отсутствие recipientLevels сохраняет legacy exclusive-set. Наличие трёх пустых уровней означает явно настроенную группу остальных. SchemaVersion/IndexedDB неизменны; proposal сохраняется целиком. Команда валидирует активные ID, отсутствие donor/self и повторов; меняет решения атомарно и повышает allocationRevision один раз.

Состав recipientLevels определяется исходной допустимостью SKU/получателя и маршрутом, а не текущим положительным остатком потребности. Принятый вход другого донора может временно закрыть потребность, но не удаляет сохранённый приоритет. После отмены принятия следующий явный пересчёт использует тот же порядок уровней; индивидуальные исключения первого уровня сохраняются. Актуальная потребность проверяется при распределении количества.


### Полное покрытие ·29.10.2026

`RebalanceResult` получает optional `skippedSkus: SkippedRebalanceSku[]` и `participationFingerprint:string`. Каждая пропущенная запись содержит skuCode, neededQty (вся остаточная потребность), deliverableQty (диагностический максимум), missingQty (их разность), reason INSUFFICIENT_SURPLUS/ROUTE_LIMIT/QUANTITY_STEP и recipients[{branchId,neededQty,deliverableQty}]. Диагностический поток никогда не входит в transfers. `RebalanceSnapshot.validationIssues?:RebalanceIssue[]` сохраняет сведения об исключённых/неоднозначных строках адаптера: известная невалидная выбранная потребность не должна давать ложное полное покрытие. Невалидные physical rows не возвращаются в принятый журнал.

Валидные physical rows не удаляются из snapshot только из-за inactive. Участие проверяется отдельно для новых потоков/принятий; исторический ledger использует собственные сохранённые условия. Новые proposal имеют algorithmVersion `full-sku-network-flow-v3`, захватывают каноническую сигнатуру ID/active и не содержат allocation-полей. Старые optional allocation DTO читаются только как история; runtime setters/модели удалены. Старый tab priorities нормализуется в routes. Отсутствующая версия/сигнатура блокирует новые добавления, но не исторический no-op/revoke. SchemaVersion1 и IndexedDBv2 сохраняются.

`INVALID_BRANCH_VALUES` — source error для узнаваемого подразделения с нечисловым остатком/MIN/MAX в XLSX. Парсер сохраняет SKU/название подразделения/номер строки; адаптер передаёт её в validationIssues, чтобы отсутствующая невалидная строка не давала ложного full coverage. Служебные подписи не становятся подразделениями.

### Кодовые ячейки и автоматические политики ·30.10.2026

`readFirstSheetRows` сохраняет raw numbers для показателей, но числовые ячейки колонок Код/Код номенклатуры читает через их отображаемый Excel-формат. Оба импортёра получают одинаковую строку идентификатора, включая нули. Текстовые коды не приводятся к числу, join только по полному коду; raw numeric quantities/prices не меняются.

`DerivedState.quantityPolicies` — единый источник политик UI/расчёта/сводок. Новые SKU автоматически получают quantityStep1 и unit из однозначной истории или нейтральную метку. Старое поле rebalance.policies сохранено для совместимости, новые интерфейсы его не редактируют. Для принятых исторических дробных движений сохраняется пригодный старый шаг и diagnostic LEGACY_QUANTITY_POLICY блокирует новые предложения этого SKU до отмены принятия. Ledger, закупка и отмена остаются доступны.

Для числового кода маска только из нулей добавляет ведущие нули; General/научные/округляющие форматы не применяются к идентификатору, сохраняются все исходные числовые цифры. MIXED_UNITS в исходных diagnostics имеет приоритет над частичной историей и сохранённой меткой единицы: отображается нейтральное «ед.». Несовместимые старые дробные предложения требуют пересчёта; новые добавления блокируются также в app-команде принятия, исторический no-op и отмена доступны.


### Диагностика целостности ·03.11.2026

ValidationIssueCode дополнен DUPLICATE_SKU (ERROR), INVALID_REFERENCE_PRICE и INCOMPLETE_SUPPLIER_PRICE (WARNING). Отрицательная исходная цена импортируется как null с диагностикой; явный ноль остаётся0. Повторные родительские блоки сохраняются для диагностики, но их fallback-цена не выбирается по последнему блоку. Полные числовые history quantity/amount агрегируются десятично, неполнота хотя бы одной строки делает weightedUnitCost=null.

Опциональное OrderProjection.dataIssues:ValidationIssue[] сохраняет source errors и проблемы старых нормализованных данных, включая строки без расчётной физической потребности. Это derived DTO, схема IndexedDB/workspace не меняется. В старых сеансах утраченные при прежнем импорте исходные значения можно восстановить только повторным импортом отчёта; нулевую сохранённую цену нельзя произвольно объявить ошибочной.


### Порог SKU×получатель ·03.11.2026

Структура skuAmountFilter.enabled/threshold и схема workspace/IndexedDB сохраняются. RebalanceIssue кода SKU_AMOUNT_FILTER содержит branchId, sourceRow, quantity, amount и threshold для исключённого получателя. ACCEPTED_SKU_AMOUNT_BELOW_THRESHOLD/UNKNOWN также содержит branchId; группировка run×SKU×recipient×savedConfig. algorithmVersion нового плана — full-sku-recipient-amount-v4. Числовое равенство суммы порогу допустимо.


### Минимальная сумма SKU в перемещении ·03.11.2026

RebalanceConfig.transferAmountFilter?:MoneyFilter — явный минимум SKU×донор×получатель; skuAmountFilter/unitPriceFilter сохраняются как legacy-поля для чтения замороженных условий. Для текущего порога при отсутствии transferAmountFilter берутся enabled/threshold skuAmountFilter; unitPriceFilter игнорируется при новых расчётах/принятии. Новые acceptedConfig всегда содержат transferAmountFilter. Исторические acceptedConfig без него не изменяются и сохраняют прежние SKU×получатель diagnostics. Fingerprint старой структуры сохраняет прежний формат; при новом поле включает его enabled/threshold. algorithmVersion=full-sku-route-sku-amount-v5; старые планы требуют пересчёта, accepted/no-op/revoke доступны. Workspace/IndexedDB schema не меняется. RebalanceIssue получает optional fromBranchId/toBranchId; TRANSFER_AMOUNT_FILTER/UNKNOWN и ACCEPTED_TRANSFER_AMOUNT_BELOW_THRESHOLD/UNKNOWN содержат skuCode, направленную пару, amount и threshold.


### Реестр принятых и стабильная шапка ·03.11.2026

RebalanceWorkspace.tab дополнен accepted. Optional acceptedFilters:{query:string,fromBranchId:string,toBranchId:string} хранится отдельно от фильтров результатов. Отсутствие поля в legacy workspace означает пустые фильтры. Schema workspace/IndexedDB не меняется. Выбор направлений для CSV временный и не использует selectedLineIds бизнес-принятия. Принятые записи не изменяются экспортом.


### Массовая отмена принятия ·03.11.2026

Выбор принятых строк к отмене — временные transferId, отдельно от persisted proposal selectedLineIds/sourceLineId и от выбора направлений реестра. Новых полей workspace/IndexedDB не вводится. Команда массовой отмены передаёт deduplicated transferIds в существующий prepareAcceptedChange(kind=revoke), ревизия/снимок/сеанс проверяются существующим механизмом. Ошибка записи не меняет ledger/потребность, подтверждение и выбор сохраняются для повтора.


### Исключение по остатку ·06.11.2026

RebalanceConfig хранит необязательное `stockAmountException: { enabled: boolean, multiplier: 2 | 3 }`. Отсутствующее значение эквивалентно выключенному режиму ×2. При выключенном режиме отпечаток прежних условий сохраняется. Для принятых строк, допущенных по остатку, необязательное `amountExemptByStock: true` фиксирует право пропустить проверку суммы и предупреждения при последующей отмене или восстановлении сеанса. Поля сохраняются существующим DTO без миграции.

Совместный подбор доноров по SKU использует версию `full-sku-joint-donor-plan-v7`. Старые предложения требуют пересчёта. Принятые строки читаются по сохранённым условиям и остаются доступны для отмены. Если детерминированный бюджет поиска исчерпан, `RebalanceIssue` с кодом `TRANSFER_SEARCH_LIMIT` указывает SKU, для которого оптимальность не проверена до конца. Формат данных сеанса сохраняется.

## Постоянные связи поставщиков · 09.11.2026

Рабочий снимок хранит `supplierAssignments?: SupplierAssignment[]`, где строка имеет поля `skuCode: string`, `primary: string | null` и `additional: string[]`. Отсутствие коллекции означает, что стартовое сопоставление ещё не выполнено. Пустая коллекция означает, что первичный отчёт принят, но в нём нет связей с рабочим пулом. Значение `primary: null` хранит отсутствие основного поставщика.

Связи записываются в той же транзакции, что и рабочий снимок. Обновление MIN/MAX наследует их целиком. История сеансов сохраняет снимок связей для каждого периода. Контракт рассчитан на первичную настройку по отчёту поставщиков.

### Участие подразделений при обновлении MIN/MAX

Подразделение, которое участвовало в перемещениях и отсутствует в новом MIN/MAX, получает `active: false` и `suspendedByImport: true`. При возврате в отчёт участие восстанавливается с тем же ID и маршрутами. Явная смена участия убирает признак временного отключения.
