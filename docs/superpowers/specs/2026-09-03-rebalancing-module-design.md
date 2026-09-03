# ORDERS_AUTO — Rebalancing Module Design Specification

**Date:** 2026-09-03  
**Status:** Draft for user review — implementation plan is intentionally not written yet  
**Primary JTBD:** До формирования закупки понять, какие дефициты `SKU × подразделение` можно закрыть внутренними перемещениями **только из настоящего излишка сверх MAX**, собрать удобный план перемещений, оценить сокращение закупки и трудозатраты, утвердить его и только после этого пересчитать остаточную закупку поставщикам.

## 1. Why this module exists

Текущий flow ORDERS_AUTO строит потребность до MAX и затем напрямую превращает её в supplier/order projection. Это завышает внешнюю закупку в ситуации, когда тот же SKU уже лежит в другом подразделении **сверх его MAX**.

Новая цепочка решений:

```text
Импорт
  ↓
Исходная потребность до MAX
  ↓
Ребалансировка сети
  ↓
Утверждённые внутренние перемещения
  ↓
Остаточная закупка
  ↓
Поставщики
  ↓
Заказы
```

Ребалансировка не меняет исходные остатки файла и не подменяет MIN/MAX. Она является отдельной derived projection между физической потребностью и закупочным заказом.

## 2. Non-negotiable business invariants

### 2.1 Донор отдаёт только излишек сверх MAX

Для валидной пары `SKU × donorBranch`:

```text
donorSurplusQty = max(0, stock - MAX)
```

Автоматическое или ручное перемещение не может уменьшить расчётный остаток донора ниже его MAX.

```text
stockAfterOutgoing >= MAX
```

Нижний предел донора — **MAX**, не MIN.

### 2.2 Получатель закрывается не выше MAX

Для валидной пары `SKU × recipientBranch`:

```text
recipientGapQty = max(0, MAX - stock)
```

Суммарное входящее перемещение не может превышать этот gap:

```text
approvedIncomingQty <= recipientGapQty
```

### 2.3 Строки без валидного MAX не участвуют

`NO_NORM` и `INVALID_NORM` не могут быть автоматическими донорами или получателями, потому что невозможно доказать инвариант MAX. Ручное географическое исключение также **не** разрешает обход этого правила: сначала нужно исправить норматив.

### 2.4 Запас SKU в сети сохраняется

Для каждого SKU ребалансировка только меняет расположение товара:

```text
Σ stockBefore == Σ stockAfter
```

### 2.5 Географический запрет не равен бизнес-инварианту

Маршрут с отношением `Только вручную` можно создать вручную после явного предупреждения, но даже тогда нельзя:

- опустить донора ниже MAX;
- отправить получателю больше gap до MAX;
- использовать строку без валидного MAX;
- создать отрицательное количество.

## 3. Geography model

Связь между подразделениями **симметрична**. Настройка пары `A ↔ B` действует одинаково в обе стороны.

Три пользовательских значения:

| Relation | Автомат | Ручное перемещение | Смысл |
|---|---|---|---|
| `Приоритетно` | Да, первым | Да | Основной внутренний маршрут |
| `Допустимо` | Да, после приоритетных | Да | Рабочий запасной маршрут |
| `Только вручную` | Нет | Да, с явным предупреждением | Автомат никогда сам не предлагает эту пару |

Domain naming:

```ts
export type RebalanceRelation =
  | 'PRIORITY'
  | 'ALLOWED'
  | 'MANUAL_ONLY';
```

Настройка хранится один раз на unordered pair подразделений. Канонический ключ пары строится стабильной нормализацией двух branch names независимо от направления.

### Safety default

Для новой или ещё не настроенной пары подразделений значение по умолчанию — `MANUAL_ONLY`. Это предотвращает появление автоматических перемещений по неизвестной логистической связке. В настройках пользователь может массово перевести выбранные пары в `Допустимо` или `Приоритетно`.

Сохранённые связи отсутствующих в новой загрузке подразделений игнорируются, но могут оставаться в локальном persistence. Для вновь обнаруженных пар снова применяется safety default.

## 4. Priority modes

Пользователь выбирает один из двух прозрачных режимов. Никаких скрытых коэффициентов `критичность × деньги × география` и общего score не вводить.

```ts
export type RebalancePriorityMode =
  | 'CRITICALITY_FIRST'
  | 'GEOGRAPHY_FIRST';
```

### 4.1 «Критичные»

Лексикографический приоритет:

```text
1. Класс критичности получателя
2. Финансовый эффект конкретного feasible transfer
3. Географическая связь
4. Консолидация трудозатрат / deterministic tie-break
```

Severity получателя:

```text
BELOW_MIN > LIGHT_RED > ORANGE > YELLOW
```

Внутри одинакового класса выше позиция с большим известным сокращением закупки.

### 4.2 «По географии»

Лексикографический приоритет:

```text
1. PRIORITY relation
2. ALLOWED relation
3. Класс критичности получателя
4. Финансовый эффект
5. Консолидация трудозатрат / deterministic tie-break
```

`MANUAL_ONLY` вообще не является автоматическим кандидатом.

### 4.3 Deterministic tie-break

Если основные критерии равны, автомат предпочитает:

1. уже используемую в текущем proposal пару `донор ↔ получатель`, чтобы не создавать дополнительный физический маршрут без причины;
2. больший transferable quantity;
3. стабильный порядок branch pair + `skuCode`.

Консолидация является только tie-break и не переопределяет выбранный пользователем главный режим.

## 5. Base unit of optimization

Основная decision-unit — **`SKU × подразделение-получатель`**, потому что закупка формируется отдельно для каждого подразделения.

Один SKU, нужный трём подразделениям, представляет три независимых потребности:

```text
49301 × Рязань
49301 × Коломна
49301 × Москва
```

При этом UI дополнительно умеет агрегировать финансовый эффект **по SKU**, но это только аналитический способ просмотра. Он не запускает другой алгоритм и не меняет автоматический plan.

## 6. Proposed domain model

Названия ниже являются целевым design contract для implementation plan.

```ts
export interface GeographyPairSetting {
  branchA: string;
  branchB: string;
  relation: RebalanceRelation;
}

export type RebalanceTransferSource = 'AUTO' | 'MANUAL';

export interface RebalanceTransfer {
  skuCode: string;
  article: string | null;
  name: string;
  fromBranch: string;
  toBranch: string;
  qty: number;
  relation: RebalanceRelation;
  source: RebalanceTransferSource;
  recipientStatus: StockStatus;
  unitPrice: number | null;
  purchaseReductionAmount: number | null;
}

export interface RebalanceSummary {
  transferCount: number;      // SKU-line count
  routeCount: number;         // unique fromBranch + toBranch
  skuCount: number;
  recipientLineCount: number; // unique skuCode + toBranch
  totalQty: number;
  knownPurchaseReductionAmount: number;
  missingPriceTransferCount: number;
  residualKnownPurchaseAmount: number;
  residualMissingPriceLineCount: number;
}

export interface RebalancePlan {
  mode: RebalancePriorityMode;
  transfers: RebalanceTransfer[];
  summary: RebalanceSummary;
}
```

`RebalanceTransfer` — derived decision record, а не новый источник остатков.

## 7. Automatic allocation algorithm

### 7.1 Candidate construction

Для каждого SKU:

1. построить donors с `stock > MAX` и `donorSurplusQty > 0`;
2. построить recipients с `stock < MAX` и `recipientGapQty > 0`;
3. исключить строки `NO_NORM` / `INVALID_NORM`;
4. построить допустимые `donor × recipient` candidates только для `PRIORITY` и `ALLOWED` relations;
5. `fromBranch === toBranch` невозможен.

Для candidate:

```text
transferableQty = min(remainingDonorSurplus, remainingRecipientGap)
```

Если цена известна:

```text
purchaseReductionAmount = transferableQty * resolvedUnitPrice
```

Цена берётся из уже существующей priced demand projection получателя; география не меняет supplier price.

### 7.2 Iteration

Пока существует candidate с `transferableQty > 0`:

1. пересчитать feasible candidate quantities на текущих remaining surplus/gap;
2. отсортировать candidates по выбранному lexicographic priority mode;
3. взять первый candidate;
4. создать transfer на весь текущий `min(surplus, gap)`;
5. уменьшить remaining surplus и remaining gap;
6. повторить.

Каждая итерация исчерпывает как минимум одного донора или одного получателя по SKU, поэтому алгоритм детерминирован и не требует оптимизационного solver/backend.

### 7.3 Missing price

SKU с неизвестной ценой можно физически ребалансировать. Его денежный эффект равен `null`, отображается как `Эффект неизвестен` и сортируется после известных денежных эффектов **внутри одинаковых старших критериев**.

Такие строки не должны исчезать из quantity plan.

## 8. Financial semantics

В интерфейсе использовать термин **«Сокращение закупки»**, а не «Экономия».

Причина: модуль пока не знает стоимость внутренней логистики и поэтому не может честно утверждать, что вся убранная внешняя закупка является чистой экономией.

Основные KPI текущего preview/approved scenario:

```text
Закупка до
Сокращение закупки
Остаточная закупка
```

Не показывать одновременно `После ребалансировки` и `Остаточный gap`: это один смысл.

При отсутствующих ценах суммы всегда сопровождаются количеством строк с неизвестной ценой, как в текущей priced-demand модели.

## 9. Labor / operational effort semantics

Не создавать искусственный score трудозатрат без фактических временных/стоимостных данных.

Показывать три прозрачные величины:

1. **Маршруты** — количество уникальных `fromBranch ↔ toBranch`, которые реально используются сценарием;
2. **SKU-линии** — количество отдельных transfer lines;
3. **Единицы** — суммарное перемещаемое количество.

Пример сравнения:

```text
Сценарий 90%
−102 000 ₽ закупки
3 маршрута · 4 SKU-линии · 47 шт.

Весь потенциал
−113 000 ₽ закупки
11 маршрутов · 30 SKU-линий · 214 шт.
```

Это позволяет пользователю самому оценить, стоит ли дополнительный финансовый эффект дополнительной физической работы.

## 10. Pareto scenarios

Pareto — центральный decision instrument, а не скрытая сортировка.

Быстрые цели:

```text
80% | 90% | 95% | 100%
```

### 10.1 Default: по строкам закупки

Default grouping — `SKU × получатель`.

Для полного feasible proposal агрегировать `purchaseReductionAmount` по каждой такой decision-unit, отсортировать по убыванию и выбрать минимальное количество units, которое достигает целевой доли известного финансового эффекта.

UI формулировка:

```text
3 из 42 потребностей дают 90% известного финансового эффекта
3 маршрута · 4 SKU-линии · 47 шт.
```

### 10.2 Аналитический переключатель «По SKU»

Переключатель:

```text
Группировать эффект: [Строки закупки] [SKU]
```

`SKU` агрегирует уже рассчитанные `SKU × получатель` и отвечает на вопрос «сколько уникальных товаров дают основной эффект».

Этот переключатель **не меняет allocation algorithm** и не создаёт второй вид business logic.

### 10.3 Unknown-price effect

Если есть transfer lines без цены, Pareto percentage рассчитывается только по известному денежному эффекту и интерфейс обязан писать **«90% известного финансового эффекта»** плюс показывать количество строк `Эффект неизвестен`.

## 11. Plan lifecycle

Нужны три понятных уровня:

```text
Автопредложение → Текущий сценарий/черновик → Утверждённый план
```

### 11.1 Автопредложение

Чисто derived full-potential result для текущих imports + geography settings + priority mode. Само по себе заказы не меняет.

### 11.2 Текущий сценарий

Пользователь может:

- выбрать Pareto 80/90/95/100;
- исключить маршрут;
- исключить SKU-line;
- изменить quantity в допустимых границах;
- добавить ручное перемещение;
- вернуть автоматический quantity.

Любое изменение остаётся preview/draft и **не** влияет на orders до commit.

### 11.3 Утверждённый план

Только действие `Утвердить перемещения` делает текущий scenario источником residual purchase projection.

Если пользователь после approval меняет mode, geography или draft quantities, существующий approved plan продолжает действовать для заказов, пока новый scenario не утверждён. UI явно различает `Утверждено` и `Есть новый черновик`.

## 12. Residual demand and order integration

Исходный `DemandLine.deficitQty` остаётся физическим gap исходного import snapshot и **не мутируется**.

Для downstream purchasing строится отдельная residual projection:

```text
approvedIncomingQty(sku, branch)
  = Σ approved transfer.qty where transfer.toBranch == branch

residualPurchaseQty
  = max(0, deficitQty - approvedIncomingQty)

residualPurchaseAmount
  = unitPrice == null
      ? null
      : residualPurchaseQty * unitPrice
```

Только residual projection передаётся в supplier/order projection.

Следствия:

- Demand UI может продолжать объяснять исходный gap до MAX;
- после approval рядом появляется понятный контекст `Осталось заказать`;
- Suppliers и Orders используют уже residual quantities;
- без approved plan поведение полностью совпадает с текущим приложением.

### 12.1 Order-edit/review invalidation

Approval нового/изменённого rebalance plan меняет calculated purchase quantities. Поэтому старые workflow-метаданные не могут считаться автоматически валидными.

Design rule:

- если существуют manual order quantity edits, перед approval показать app-owned confirmation с их количеством и объяснить, что affected edits будут сброшены;
- affected order quantity edits сбрасываются;
- review/export markers для пересчитанной order projection сбрасываются;
- сам approved rebalance plan после commit становится новым расчётным baseline.

Не использовать browser `confirm()` для этого нового workflow.

## 13. Persistence and invalidation

### Persist between sessions/imports

Хранить локально:

- symmetric geography pair settings.

### Current import/session only

Не переносить автоматически на новый Min-Max snapshot:

- full auto proposal;
- current Pareto/draft scenario;
- manual transfer exceptions;
- approved rebalance plan.

Новая загрузка отчётов сбрасывает plan state, потому что исходные остатки изменились. Geography settings сохраняются.

Manual transfer по `MANUAL_ONLY` relation не меняет глобальную настройку пары — это исключение только текущего scenario.

## 14. Navigation and information architecture

После импорта top-level workflow становится:

```text
Все товары
Подразделения
Ребалансировка
Поставщики
Заказы
```

`Ребалансировка` располагается после demand context и до supplier/order decisions.

Это отдельный top-level workspace, а не drawer внутри Demand и не скрытый режим Orders.

## 15. Rebalancing workspace UX

Основная композиция desktop-first:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ РЕБАЛАНСИРОВКА                         [Настройка географии]              │
│ Только излишек сверх MAX                                                 │
│                                                                          │
│ Приоритет: [Критичные] [По географии]    Сценарий: [90% ▾]               │
│                         [Не утверждено / Утверждено]                     │
│                                                                          │
│ Закупка до       Сокращение закупки      Остаточная закупка              │
│ 428 000 ₽        113 000 ₽ · 26%         315 000 ₽                       │
│                                                                          │
│ 2 SKU / 3 потребности дают 90% эффекта                                  │
│ 3 маршрута · 4 SKU-линии · 47 шт.                                       │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│                         FLOW MAP                                         │
│                                                                          │
│  DONORS / MIXED                ROUTES                 RECIPIENTS          │
│                                                                          │
│  Егорьевск ───── 2 SKU · 30 шт · −71 400 ₽ ───────→ Рязань             │
│  +38 сверх MAX             Приоритетно                −42 до MAX          │
│        └─────── 1 SKU · 12 шт · −18 600 ₽ ───────→ Коломна             │
│                             Допустимо                  −12 до MAX          │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ Выбранный маршрут: Егорьевск → Рязань                                   │
│ 2 SKU · 30 шт · −71 400 ₽                                                │
│ 49301 ...   20 шт   −48 000 ₽    [quantity editor]                      │
│ 49317 ...   10 шт   −23 400 ₽    [quantity editor]                      │
└──────────────────────────────────────────────────────────────────────────┘
```

## 16. Flow-map design contract

Карта — signature element модуля, но остаётся рабочим data tool.

### 16.1 Topology, not literal geography

Не пытаться рисовать филиалы на географической карте России. Географическая пригодность уже выражена relation matrix.

Размещение nodes показывает роль в текущем plan:

- преимущественные доноры — слева;
- преимущественные получатели — справа;
- подразделения, которые по разным SKU одновременно отдают и получают, — в центральной зоне.

### 16.2 Route aggregation

На карте один edge = одна уникальная пара подразделений, агрегированная по всем SKU текущего scenario.

Edge label минимум содержит:

```text
N SKU · Q шт. · −X ₽ закупки
```

При неизвестных ценах:

```text
−X ₽ + K строк без цены
```

### 16.3 Relation visualization

- `Приоритетно` — основной solid connector + текст label;
- `Допустимо` — визуально вторичный connector (например, dashed) + label;
- `Только вручную` не появляется в auto proposal;
- ручной route по `MANUAL_ONLY` получает warning marker + явную подпись `Только вручную`.

Нельзя кодировать relation только цветом.

### 16.4 Financial emphasis

Текстовая сумма является authoritative. Допустимо использовать ограниченную шкалу толщины edge для известного финансового эффекта, но она не заменяет label и не должна делать большие дешёвые quantity visually dominant.

### 16.5 Interaction

- click/focus route → открыть route inspector;
- click/focus branch → подсветить связанные routes и приглушить остальные;
- `Добавить перемещение` → доступный non-drag builder;
- drag может быть progressive enhancement только при наличии эквивалентного button/form path;
- Escape снимает transient selection/закрывает верхний dismissible layer по общему UX contract.

### 16.6 Accessible fallback

Flow-map никогда не является единственным представлением plan. Рядом/ниже существует keyboard-accessible `Список маршрутов`, содержащий те же route summaries и действия.

## 17. Route inspector

Выбранный route показывает:

```text
Откуда → куда
Relation
Количество SKU
Количество единиц
Сокращение закупки
```

Ниже — SKU-lines:

```text
Код | Артикул | Номенклатура | До MAX получателю | Доступно у донора | Переместить | Сокращение закупки
```

Quantity editable напрямую. В каждой строке интерфейс показывает before/after validation:

```text
Донор после перемещения: 20 / MAX 20 ✓
Получатель после перемещения: 16 / MAX 16 ✓
```

Ошибочное quantity не коммитится молча; текст объясняет допустимый диапазон.

Доступные действия:

- убрать SKU-line из scenario;
- вернуть рекомендованное quantity;
- убрать весь route;
- добавить manual transfer.

## 18. Manual transfer builder

Пользователь выбирает:

```text
SKU → Донор → Получатель → Количество
```

Destination options должны учитывать физические ограничения текущего scenario. Для relation `MANUAL_ONLY` перед добавлением показать inline/app-owned warning:

> Эта связь исключена из автоматической ребалансировки. Добавить конкретное перемещение вручную?

Подтверждение не меняет geography setting.

Manual transfer не может обходить MAX invariants из §2.

## 19. Geography settings workspace

Отдельная симметричная matrix:

```text
              Егорьевск    Коломна       Рязань       Москва
Егорьевск         —        Приоритетно   Допустимо    Только вручную
Коломна      Приоритетно        —         Допустимо    Приоритетно
Рязань       Допустимо     Допустимо         —         Приоритетно
Москва       Только вручную Приоритетно   Приоритетно      —
```

Полная mirrored matrix удобнее для визуального чтения. Изменение любой зеркальной cell обновляет одну underlying unordered pair.

Нужны:

- legend трёх relations;
- multi-select пар;
- bulk `Сделать приоритетными` / `Допустимо` / `Только вручную`;
- понятный selected count;
- явные `Сохранить` / `Отмена`;
- unsaved-changes guard внутри приложения.

Изменения geography сохраняются в локальное persistence и перестраивают **proposal**, но не заменяют действующий approved plan без отдельного `Утвердить перемещения`.

## 20. Filters and analysis controls

Минимальный обязательный набор:

- поиск по `Коду 1С`, артикулу, номенклатуре;
- сокращение закупки ₽ `от / до`;
- Pareto target `80 / 90 / 95 / 100`;
- grouping `Строки закупки / SKU`;
- донор;
- получатель;
- relation `Приоритетно / Допустимо / Только вручную`;
- status получателя;
- `Только полностью закрывающие gap`.

Фильтры **не пересчитывают allocation**. Они меняют видимость/фокус внутри уже рассчитанного proposal/scenario. Business recalculation запускают только domain inputs: imports, geography settings, priority mode и plan edits.

Активные filters должны быть явно видимы; `Сбросить фильтры` возвращает полный текущий scenario.

## 21. State and feedback

Пользователь всегда видит состояние текущего workspace:

- `Автопредложение`;
- `Не утверждено`;
- `Утверждено`;
- `Есть новый черновик`.

KPI относятся к отображаемому scenario, а при draft содержат подпись, что Orders изменятся только после approval.

После успешного approval показать shared toast/status и обновить downstream supplier/order projections без перезагрузки страницы.

Если plan стал невозможен из-за нового import snapshot — он не «чинится» автоматически; новый import его сбрасывает и строит новый proposal.

## 22. Downstream transparency

После approved rebalance:

- Demand сохраняет исходный физический gap и может показывать дополнительное `Осталось заказать`;
- Suppliers строится по residual purchase;
- Orders строится по residual purchase;
- Orders header/summary показывает, что учтён approved rebalance plan, и даёт путь назад в `Ребалансировка`.

Пользователь не должен видеть разные суммы между модулями без объяснения источника различия.

## 23. Error and empty states

### Нет донорского излишка

Показать честный empty state:

> В сети нет остатков выше MAX, доступных для автоматической ребалансировки.

Не предлагать опускать филиал-донор ниже MAX.

### Есть излишек, но geography запрещает все routes

Показать количество потенциальных SKU и действие `Открыть настройку географии`.

### Нет цены

Quantity plan остаётся доступным. Финансовые KPI/route labels показывают неполноту данных.

### NO_NORM / INVALID_NORM

Показывать диагностический count и объяснять, что строки исключены из ребалансировки до исправления MAX.

### Manual-only route

Никогда не создавать автоматически, даже если без него можно было бы закрыть gap полностью.

## 24. Performance and implementation constraints

- Runtime остаётся client-only/offline `file://` application.
- Никакого backend/solver/network API.
- Расчёты ребалансировки — pure domain functions без React.
- Индексы строить по `skuCode` и branch pair; избегать repeated `Array.find` в полном наборе.
- Большие route/SKU lists виртуализировать по существующим правилам.
- Для текущего масштаба подразделений сложный graph-layout engine не нужен; topology может рассчитываться детерминированно в UI.
- Не добавлять remote map/font/chart assets.

## 25. Accessibility and interaction requirements

- WCAG 2.2 AA baseline.
- Все действия доступны клавиатурой.
- Любой drag имеет non-drag alternative.
- Цвет не является единственным носителем relation/status.
- Flow-map имеет эквивалентный accessible route list.
- Focus-visible не перекрывается sticky panels.
- Settings matrix cells имеют доступное имя вида `Егорьевск ↔ Рязань: Допустимо`.
- Manual-only warning и approval consequences доступны текстом, не tooltip-only.
- `prefers-reduced-motion` убирает декоративные transitions без потери состояния.

## 26. Testing strategy / acceptance invariants

Domain tests должны доказать минимум:

1. донор после auto transfer никогда не ниже MAX;
2. manual transfer тоже не может нарушить MAX;
3. получатель не получает больше gap до MAX;
4. network stock по SKU сохраняется;
5. `NO_NORM` / `INVALID_NORM` исключены;
6. `MANUAL_ONLY` отсутствует в automatic proposal;
7. manual `MANUAL_ONLY` разрешается только явным action и не меняет geography setting;
8. geography pair симметрична;
9. `CRITICALITY_FIRST` соблюдает `status → money → geography`;
10. `GEOGRAPHY_FIRST` соблюдает `geography → status → money`;
11. deterministic input даёт deterministic plan;
12. draft/proposal не влияет на order projection;
13. approved incoming корректно уменьшает residualPurchaseQty;
14. исходный deficitQty не мутируется;
15. approved plan сбрасывается на новый import;
16. geography settings сохраняются между imports;
17. Pareto по `SKU × recipient` выбирает минимальное число decision-units для заданной доли известного эффекта;
18. grouping `SKU` не меняет allocation result;
19. unknown-price transfers остаются в quantity plan и не делают Pareto percentage ложным;
20. summary route/SKU-line/unit counts совпадают с plan lines.

UI/integration tests должны покрыть минимум:

- navigation в новый workspace;
- mode switch;
- Pareto 90% scenario;
- route selection → inspector;
- edit quantity → мгновенный KPI/summary preview;
- manual-only explicit warning path;
- geography symmetric edit + bulk action + save/cancel;
- approval и downstream residual order change;
- approval guard при существующих manual order edits;
- accessible list fallback;
- keyboard focus states;
- empty/no-route/missing-price/invalid-norm states;
- production `file://` E2E.

## 27. Scope exclusions for first implementation

Не включать без отдельного решения:

- стоимость внутренней доставки/топлива/часов персонала;
- искусственный labor score;
- реальные километры/GPS/geocoding;
- vehicle capacity / коробки / вес / объём;
- multi-hop routes `A → B → C` для одного и того же SKU;
- прогноз будущих продаж и динамический MAX;
- исполнение перемещений через API 1С;
- трекинг фактического статуса перевозки;
- автоматическое использование `Только вручную` как последнего fallback;
- отдельный optimization engine «по SKU» — это только analytical grouping;
- server persistence / multi-user collaboration.

Структурированный approved plan должен быть пригоден для будущего CSV/XLSX export, но сам новый export-format не является обязательной частью первой реализации.

## 28. Documentation ownership after approval

Этот файл является proposal design spec. После пользовательского approval implementation plan должен включить синхронизацию authoritative docs:

- `docs/product/SPEC.md` — новый business flow и residual purchase semantics;
- `docs/data/DATA_CONTRACTS.md` — new persisted/session domain types;
- `docs/data/DERIVED_PROJECTIONS.md` — proposal/approved/residual projections;
- `docs/architecture/ARCHITECTURE.md` — new domain boundary and data flow;
- `docs/ux/UX_AND_EXPORT.md` — navigation, map, geography settings, approval UX;
- `docs/testing/ACCEPTANCE_CRITERIA.md` — domain/UI/E2E acceptance;
- `AGENTS.md` — reading order only if new authoritative docs require it.

Runtime implementation does not start until this design is approved and a separate Superpowers implementation plan is written.

## 29. Locked decisions from design discussion

The following requirements are considered decided for this spec:

1. donor lower bound = MAX;
2. geography is symmetric;
3. relations = `Приоритетно / Допустимо / Только вручную`;
4. `Только вручную` is forbidden for automatic rebalance but may be used by explicit manual transfer;
5. modes = `Критичные / По географии`;
6. critical mode order = criticality → financial effect → geography;
7. base optimization unit = `SKU × recipient`;
8. `SKU` view is analytical grouping only;
9. only approved transfers reduce external purchase;
10. financial term = `Сокращение закупки`, not net savings;
11. workload is expressed by routes + SKU-lines + units;
12. Pareto must answer how little operational work captures most financial effect;
13. flow-map is the main visual decision surface;
14. duplicate KPI `После / остаточный gap` is replaced by one `Остаточная закупка` metric.

No blocking product questions remain before writing the implementation plan **after user approval of this document**.
