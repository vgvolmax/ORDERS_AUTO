# Rebalancing Integration Clarifications

**Date:** 2026-09-03  
**Status:** Approved clarification to `2026-09-03-rebalancing-module-design.md`  
**Scope:** Только уточнение интеграционных контрактов. Базовые правила ребалансировки, UI-концепция и offline-архитектура не меняются.

## Precedence

Этот документ читается **после** `docs/superpowers/specs/2026-09-03-rebalancing-module-design.md` и является нормативным уточнением к нему. Если формулировки расходятся, этот документ имеет приоритет только по вопросам, перечисленным ниже.

Базовый design spec считается утверждённым baseline для реализации; его устаревшая строка статуса про отсутствие implementation plan больше не является актуальным gate.

## 1. Ребалансировка остаётся отдельной feature boundary

Информационная архитектура не меняется:

```text
Все товары
Подразделения
Ребалансировка
Поставщики
Заказы
```

`Ребалансировка` — отдельный top-level workspace. Она не заменяет Demand, Suppliers или Orders и не переносит их бизнес-логику внутрь себя.

Единственная downstream-интеграция после явного approval:

```text
original PricedDemandLine[]
  ↓
approved transfer quantities
  ↓
PurchaseDemandLine[].residualPurchaseQty
  ↓
Suppliers / Orders / Export
```

Без approved plan поведение Suppliers/Orders обязано быть эквивалентно текущему приложению.

## 2. Suppliers полностью использует residual purchasing semantics

После approval источником ответа на вопрос «что ещё нужно купить у поставщика» является `PurchaseDemandLine.residualPurchaseQty`, а не исходный `PricedDemandLine.deficitQty`.

Это относится не только к totals, но ко **всей supplier-decision логике**:

- `neededSkuCodes` строится только из строк `residualPurchaseQty > 0`;
- список `Требуют решения` не включает SKU, полностью закрытый утверждёнными внутренними перемещениями во всех подразделениях;
- `problemDemand` и `problemAmount` считаются по residual purchase;
- supplier summary `SKU ниже MIN` учитывает только позиции, по которым после approval реально остаётся внешняя закупка;
- supplier totals и branch totals продолжают браться из residual order projection;
- исходный `deficitQty` остаётся доступен только как физический контекст Demand и не используется для решения «надо ли ещё выбирать поставщика».

Если хотя бы в одном подразделении SKU имеет `residualPurchaseQty > 0`, поставщик по этому SKU всё ещё может требовать разрешения, потому что supplier resolution остаётся SKU-level.

## 3. Approval invalidation сравнивает previous и next order projections

Изменение approved plan может не только изменить quantity существующей строки заказа, но и **удалить или вернуть** строку в заказ.

Поэтому targeted invalidation определяется в два шага:

```text
changedRecipientKeys = changed approved incoming by SKU × branch

affectedOrderIds =
  order IDs containing changedRecipientKeys in previous projection
  UNION
  order IDs containing changedRecipientKeys in next projection
```

Для `changedRecipientKeys`:

- ручные `OrderQtyEdit` сбрасываются;
- `reviewedOrderIds` и `exportedOrderIds` сбрасываются для `affectedOrderIds`;
- unrelated edits/review/export state сохраняются.

Нельзя определять `affectedOrderIds` только по projection, существовавшей до approval: это пропустит случай, когда residual quantity меняется `0 → positive` и строка появляется в заказе заново.

Нельзя определять их только по next projection: это пропустит случай `positive → 0`, когда строка исчезает.

## 4. Geography сохраняется при любом reset import snapshot

Разделение persistence остаётся жёстким:

### Persisted

- `geographySettings`.

### Session/snapshot only

- auto proposal;
- priority mode/draft edits, если они относятся к текущему snapshot;
- manual transfer exceptions;
- approved rebalance plan;
- review/export metadata, зависящие от текущей order projection.

Любой путь загрузки нового input snapshot, включая кнопку `Загрузить новые отчёты` и замену одного из исходных файлов, обязан:

```text
preserve geographySettings
reset rebalanceDraft
reset approvedRebalancePlan
reset affected review/export session state
```

`createInitialState()` или любой эквивалентный reset-helper не имеет права неявно возвращать geography к `[]`, если пользователь уже загрузил persisted settings.

## 5. Approved physical quantities frozen; money repriced from current supplier price

Approval фиксирует **физический план**, а не историческую цену:

```text
skuCode
fromBranch
toBranch
qty
source/relation needed to explain the approved route
```

После approval пользователь может изменить supplier resolution. В текущей модели это может изменить `PricedDemandLine.unitPrice` без изменения физической возможности перемещения.

Поэтому:

- approved transfer quantities не инвалидируются только из-за смены поставщика/цены;
- `residualPurchaseQty` продолжает рассчитываться из frozen approved quantities;
- текущий финансовый эффект approved plan **репрайсится** по актуальному `PricedDemandLine.unitPrice` получателя;
- KPI, route summaries и downstream context banners используют текущий repriced effect;
- отсутствие текущей цены переводит финансовый эффект этой transfer line в `unknown`, но не удаляет физическое перемещение;
- сохранённые snapshot-поля `unitPrice` / `purchaseReductionAmount` внутри transfer не являются authoritative для текущего денежного UI после изменения supplier resolution.

Для сравнения `Утверждено` / `Есть новый черновик` денежные поля не участвуют в equivalence. Сравнивается физическая/операционная семантика плана: mode и transfer identities/quantities/relations/sources по правилам реализации. Простое изменение текущей цены не должно само по себе создавать статус `Есть новый черновик`.

## 6. Навигация больше не является wizard из четырёх шагов

После появления отдельного top-level workspace числовые подписи вида:

```text
Шаг 1 из 4
Шаг 3 из 4
Шаг 4 из 4
```

становятся ложной моделью интерфейса. Пользователь может переходить между Demand, Rebalancing, Suppliers и Orders через sidebar, а Rebalancing является decision gate только по смыслу, не принудительным wizard-step.

Нужно удалить numeric step-count copy из затронутых экранов. Допустимы спокойные смысловые eyebrow labels без номера шага, например `Данные` для импорта и `Закупка` для Suppliers/Orders. Основные `h1` и существующая sidebar-навигация остаются authoritative.

## 7. Geography lookup индексируется один раз на расчёт

Geography settings хранятся как массив пар для persistence/UI, но automatic proposal не должен выполнять линейный `.find()` по этому массиву для каждого donor × recipient candidate.

Перед расчётом строится индекс:

```ts
ReadonlyMap<geographyPairKey, RebalanceRelation>
```

и все candidate lookups внутри одного proposal используют O(1)-lookup по этому индексу.

Это уточняет существующий performance contract: расчёт остаётся client-only/pure-domain и не вводит новый cache/store или runtime dependency.

## 8. Acceptance additions

К существующим acceptance invariants обязательны следующие regressions:

1. Fully covered SKU (`residualPurchaseQty = 0` во всех branches) исчезает из supplier decision problems.
2. Partially covered SKU остаётся в supplier decisions только если хотя бы одна branch имеет residual purchase.
3. Approval `residual 0 → positive` сбрасывает review/export order, в который строка появляется.
4. Approval `residual positive → 0` сбрасывает review/export order, из которого строка исчезает.
5. Unrelated manual edits/review/export markers переживают approval.
6. `Загрузить новые отчёты` и replacement любого input сохраняют persisted geography и очищают approved/draft plan.
7. Смена supplier price после approval не меняет approved quantities и residual qty, но обновляет `Сокращение закупки`.
8. Потеря цены после approval сохраняет transfer quantity и показывает неполный financial effect.
9. Price-only change не переводит физически идентичный approved plan в `Есть новый черновик`.
10. В runtime UI после внедрения Rebalancing нет устаревших `Шаг N из 4`.
11. Automatic proposal использует предварительно построенный geography index, а не повторный линейный lookup по settings.

## 9. Scope unchanged

Эти уточнения не добавляют:

- backend;
- server persistence;
- новый allocation engine;
- стоимость внутренней логистики;
- multi-hop routes;
- новый export-format;
- новую дизайн-систему или rebrand.

Flow-map остаётся единственным выразительным signature-element нового workspace; остальные экраны сохраняют текущий визуальный язык ORDERS_AUTO.