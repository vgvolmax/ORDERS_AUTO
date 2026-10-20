# Ребалансировщик ORDERS_AUTO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Делегирование — только если пользователь отдельно выберет такой способ исполнения.

**Goal:** Оператор принимает конкретные предложенные перемещения; только принятые движения сразу меняют рабочую потребность и закупочные заказы, а поп-ап объясняет изменение и показывает исходную потребность.

**Architecture:** Исходный снимок отчётов сохраняется неизменным для аудита. Отдельный набор принятых перемещений формирует текущую потребность, которая служит единым входом поставщиков, заказов и выгрузок. Предложения и галочки выбора не влияют на закупку; полный рабочий сеанс сохраняется локально и восстанавливается после перезапуска.

**Tech Stack:** Текущие React, TypeScript strict, Vite, idb, xlsx, exceljs, jszip, TanStack Virtual, Vitest/RTL, Playwright; Node22 из `.nvmrc`. Новые runtime-зависимости и backend не требуются.

**Spec:** действующий функциональный baseline — раздел2 этого документа с уточнениями пользователя20.10.2026,16:50MSK. Источники: [новое ТЗ20.10 в ошибочно выбранном auto_offer](https://github.com/vgvolmax/auto_offer/blob/be86aa652fc022a7ec00e5f73f93911922724d5b/docs/superpowers/specs/2026-10-20-stock-rebalancing-mvp-design.md), [design ORDERS_AUTO03.09](https://github.com/vgvolmax/ORDERS_AUTO/blob/c26970c9592d8bd371bffa7b8604d2a3aae5c26a/docs/superpowers/specs/2026-09-03-rebalancing-module-design.md), [интеграционные уточнения03.09](https://github.com/vgvolmax/ORDERS_AUTO/blob/c26970c9592d8bd371bffa7b8604d2a3aae5c26a/docs/superpowers/specs/2026-09-03-rebalancing-integration-clarifications.md). Уточнения текущего пользователя имеют приоритет при перечисленных ниже расхождениях.

**Статус:** план обновлён по уточнениям пользователя; целевой репозиторий **vgvolmax/ORDERS_AUTO подтверждён**. Программная реализация не начиналась, удалённые репозитории не изменены. План предназначен для размещения в `docs/superpowers/plans/2026-10-20-rebalancing-order-integration.md`. Это версия, заменяющая прежний вариант с донорским ползунком, отдельным внешним журналом и тремя обязательными режимами заказа.

## Global Constraints

- «Join двух отчётов выполняется только по `Коду 1С`, никогда по артикулу или названию» — `AGENTS.md`.
- «Бизнес-расчёты — чистые функции, не React-компоненты»; TypeScript `strict: true`.
- «`index.html` должен запускаться напрямую через `file://` в актуальном Chrome/Edge без локального web server и доступа в интернет».
- «Никаких runtime API/HTTP/HTTPS-запросов, telemetry, analytics или внешних CDN».
- «Реальные отчёты не коммитить»; generated `dist/` и `node_modules/` не коммитить.
- Нормативы Min/Max готовые; модуль их читает. Донор отдаёт **только stock−Max**, суммарно по всем получателям. Порог донора не настраивается.
- Условие участия получателя настраивается: строго ниже Min либо строго ниже Max. Направления: обе стороны / A→B / B→A / запрещено. По умолчанию все пары двусторонние.
- Только явно принятые строки влияют на рабочую потребность/заказы. Выбор галочкой, расчёт предложения, изменение фильтра и просмотр поп-апа не являются принятием.
- Весь рабочий сеанс сохраняется и восстанавливается. Принятие — локальная фиксация планового движения; фактический остаток отчёта и документы1С оно не меняет.
- Неизвестная цена остаётся null, а не0. Код1С, branch ID и transfer ID имеют разные роли.

## Review Focus

1. Частичное принятие: выбраны две строки из десяти — закупка меняется только на принятые количества. Тесты Task2,6,7.
2. Повторное принятие и пересчёт: те же transfer IDs не списывают запас дважды, новый proposal не теряет уже принятые движения. Тесты Task2,3.
3. Полное сохранение: reload восстанавливает оба отчёта, accepted/rejected/selected state, qty edits, supplier mappings, reviews и export markers без повторного импорта. Тест Task5.
4. Исчезнувшие/возвратившиеся строки заказа и общий supplier threshold: снимаются только действительно устаревшие markers, включая соседний заказ при изменении его readiness. Тесты Task4,5.
5. Поп-ап и экспорт: пояснение относится к принятой версии; поиск/галочки/поп-ап не меняют supplier export payload. Тесты Task7,8.

---

## 1. Проверенная поверхность изменения

Репозиторий ORDERS_AUTO прочитан на commit `c26970c9592d8bd371bffa7b8604d2a3aae5c26a`. Ребалансировки в runtime ещё нет: существующие документы03.09 являются спецификацией/планом, не реализованным модулем.

| Место | Текущее поведение | Требуемое изменение |
| --- | --- | --- |
| `src/domain/demand.ts` | calculateDemand считает Max−stock, priceDemand оценивает потребность | Сохранить исходную функцию; рядом строить текущую потребность с accepted movements |
| `src/app/selectors.ts` | calculateDemand→priceDemand→buildOrderProjection | Вставить effective purchase projection, не второй генератор заказов |
| `src/domain/orders.ts` | calculatedQty берётся из deficitQty | Для нового purchase input брать purchaseQty; legacy input работает прежним образом |
| `src/features/suppliers/SuppliersPage.tsx` | problems/neededSkuCodes используют исходный deficitQty | Перевести весь supplier decision workflow на текущую purchaseQty>0 |
| `src/domain/orderWorkflow.ts` | Абсолютные qty edits, review/export по branch+supplier | Адресно инвалидировать изменения закупочной базы |
| `src/app/appStore.ts`, `src/app/App.tsx` | Импорт и рабочее состояние только в памяти | Полное локальное восстановление сеанса |
| `src/persistence/db.ts` | IndexedDB v1: supplierOverrides/settings | Аддитивная миграция с сохранением существующих настроек |
| `src/features/orders/OrderDrawer.tsx`, `SupplierOrdersDrawer.tsx` | Отображают рабочий orderQty | Добавить общий контекст принятых перемещений и поп-ап |
| `src/export/csv.ts`, `supplierWorkbook.ts` | Экспортируют переданные рабочие заказы | Сохранить форматы и единый источник активных количеств |

## 2. Уточнённое ТЗ: функциональный baseline

### 2.1 Получатели, доноры и маршруты

**Подтверждено пользователем:** переключатель «Получатели: ниже MIN / ниже MAX». Условие строгое: равенство выбранному нормативу не делает строку получателем. Предлагаемый default — «ниже MIN», как в новом ТЗ; оба режима сохраняются между сессиями. Настройка относится только к поиску перемещений. Обычная закупочная потребность продолжает считаться до Max, в том числе при остатке между Min и Max.

Получатель пополняется не выше собственного Max. Сохраняется не отменённая пользователем настройка цели получателя из нового ТЗ: receiverPct0…100%, UI-шаг5%, default100%, target=Min+(Max−Min)×receiverPct/100. Она задаёт верхний предел пополнения, а не условие участия. Если выбран режим «ниже Max», но остаток уже выше target, перемещения нет.

**Донор:** availableSurplus=max(0,stock−Max). Никакого донорского ползунка, выдачи ниже Max или ручного обхода. Принятый исходящий объём уменьшает оставшийся донорский surplus; ожидаемый входящий товар не становится донорским запасом. Это исключает транзит и повторное использование полученного товара.

**Маршруты:** одна запись на неупорядоченную пару стабильных IDs; BOTH/A_TO_B/B_TO_A/BLOCKED. Общий режим ALL_ALLOWED открывает все ненастроенные пары в обе стороны; SELECTIVE разрешает только явно включённые пары. Диагональ запрещена. Новые пары наследуют общий режим; существующие исключения сохраняются. Запрещённый маршрут не открывается автоматически.

**Денежные фильтры:** независимые price>threshold и общая сумма SKU по всем маршрутам>threshold; оба по умолчанию выключены. Условие суммы проверяется и на предлагаемом, и на выбранном к принятию подмножестве, чтобы оператор не принял экономически отфильтрованный остаток большого proposal. При одинаковых параметрах объединять ранее принятые строки того же run с добавляемыми; чужие runs не подмешивать в сумму одного расчёта. Недопустимые строки не принимаются молча: показывается причина. Отмена принятия разрешена даже при падении оставшейся суммы ниже порога; это помечается диагностикой, без автоматического восстановления отменённых строк.

### 2.2 Предложение → выбор → принятие

1. «Рассчитать» строит proposal с учётом уже принятых движений и оставшихся ограничений.
2. Оператор отмечает строки; чекбокс означает **выбрано к принятию**, а не «учтено в заказе». Доступны выбор строки, группы SKU/маршрута и всех отображённых строк; счётчик точно отражает область выбора.
3. «Принять выбранные (N)» валидирует выбранные актуальные строки вместе с ранее принятыми, сохраняет новую ревизию сеанса и одновременно пересчитывает потребность, поставщиков и заказы.
4. Непринятые предложения и отклонённые строки не участвуют в закупке. Принятие одной строки не принимает автоматически весь артикул/маршрут/proposal.
5. «Отменить принятие» удаляет влияние конкретного принятого движения и возвращает соответствующую потребность. Принятые строки не редактируются незаметно: для изменения количества отменить принятие, изменить предложение и принять заново.
6. Новый расчёт заменяет только proposal. Принятый набор продолжает действовать, пока оператор явно не отменит принятие. Изменение маршрутов/условий не является скрытой отменой принятых движений; копия условий принятия хранится в принятой записи.

Право получателя участвовать фиксируется на момент создания конкретного proposal. Поэтому после принятия входа15 для исходного stock10/Min20 оператор может принять оставшийся вход20 того же proposal, даже если прогнозный stock уже25. Перед каждым принятием заново проверяются суммарные фактические ограничения текущего accepted ledger: donor surplus, target/Max, шаг и фильтры. Само частичное принятие не делает оставшиеся строки proposal устаревшими. Новый расчёт создаёт новый run и заново определяет получателей по прогнозному остатку; заменённый run больше не принимается. Изменение расчётных условий/маршрутов помечает непринятый proposal устаревшим до пересчёта, но не отменяет уже принятые строки.

Отдельного внешнего журнала/импорта предстоящих движений в этом MVP нет. Предстоящие перемещения — принятые оператором движения текущего рабочего сеанса, ещё не отражённые в его исходном снимке. Реальное исполнение в1С не автоматизируется.

### 2.3 Потребность действительно меняется

Для пары Код1С×подразделение, с валидным закупочным Max:

```text
originalNeed = max(0, Max − snapshotStock)
acceptedIncoming = Σ qty принятых входящих движений
acceptedOutgoing = Σ qty принятых исходящих движений
projectedStock = snapshotStock − acceptedOutgoing + acceptedIncoming
purchaseQty = max(0, Max − projectedStock)
```

Ограничение донора проверяется суммарно: snapshotStock−acceptedOutgoing≥Max. Получатель не превышает target и Max. Инвариант сохранения количества SKU проверяется по всем подразделениям. При полном покрытии purchaseQty=0 строка исчезает из закупочного заказа и supplier problems, но её можно найти в учтённых перемещениях и пояснении исходной потребности.

**В интерфейсе основная потребность — текущая purchaseQty**, а не неизменная originalNeed. Исходный расчёт сохраняется внутри модели для пояснения и сравнения. Это техническое разделение не должно заставлять оператора выбирать один из трёх режимов заказа.

Пример: Max60, stock10, предложены входы15 и20. Оператор принял только15 → рабочая потребность35 и заказ35. Поп-ап: «Без перемещений50; принято к поступлению15; к заказу35». После принятия второй строки потребность15. После отмены первого принятия потребность30. Непринятая строка20 не уменьшает потребность заранее.

### 2.4 Как оператор видит учтённые перемещения

Рядом с изменённой потребностью и в составе заказа — текстовый индикатор «С учётом перемещений» и кнопка «Перемещения · N». По нажатию открывается компактный app-owned поп-ап с:

- исходной потребностью до перемещений;
- принятыми входом/выходом и текущим количеством к заказу;
- короткой таблицей «Откуда → куда | количество | принято» только для релевантных принятых строк;
- ссылкой «Открыть ребалансировку» с сохранением фильтра SKU/подразделения.

Для SKU×подразделение показывать связанные строки; для агрегата поставщика/заказа — соответствующий набор без повторного счёта transfer IDs. Если затронута только донорская строка, пояснить исходящий объём даже при неизменной нулевой закупке. Поп-ап не показывает предложения как уже учтённые. Если принятых перемещений нет, индикатора нет; исходный и рабочий расчёты совпадают.

Сравнение «без перемещений» доступно в пояснении; отдельный обязательный переключатель трёх сценариев удалён. Редактируемое orderQty — существующее ручное итоговое количество. Если оно отличается от purchaseQty, показывать отдельно «Расчёт с перемещениями35; вручную к заказу40», а не скрывать причину расхождения.

### 2.5 Сохраняем весь рабочий сеанс

**Подтверждено пользователем:** восстанавливаем всё, а не только географию. Сохраняются исходные импортированные файлы и их нормализованные данные/метаданные, snapshotId, настройки и маршруты, политики SKU, последний proposal, выбранные/отклонённые строки, принятые движения, ручные количества заказа, выбор поставщиков, пороги, review/export markers и необходимые UI-предпочтения. Повторный импорт после закрытия браузера не нужен.

Поле EXPORTED означает факт успешной выгрузки соответствующей версии заказа. Восстановить его можно только вместе с той же бизнес-сигнатурой заказа; изменение состава/количества/цены/readiness снимает устаревший marker. Ошибка сохранения явно видна; действие «Принять» не считается завершённым и не меняет рабочую потребность, если новую принятую ревизию не удалось сохранить.

Новая загрузка любого исходного отчёта создаёт новую ревизию снимка: прежний сеанс сохраняется в истории, перенос принятых движений на обновлённые остатки автоматически не выполняется. Оператор получает объяснение и новый актуальный расчёт; старый набор не вычитается второй раз из уже обновлённого отчёта. Обычное закрытие/открытие приложения или навигация **ничего не сбрасывает**. История не очищается автоматически; удалить сеанс можно только явным пользовательским действием.

### 2.6 Идентичности и границы

Код1С остаётся SKU ID. Branch registry хранит стабильный локальный UUID и aliases названия; rename не меняет маршрут. У предложения и принятого движения есть разные роли: proposalRunId/lineId для актуальности кандидата и transferId для единственного учёта принятого решения. Принятая запись хранит исходные стороны/количество, snapshotId, принятую ревизию и копию условий.

Резерв/quantity step/unit не выдумываются: текущий Min-Max не содержит резервов и шага количества. Для совместимости закупка использует существующий stock; источник явно отмечен «резерв не предоставлен». Политики шага/единицы для ребалансировки задаются явно и сохраняются. Неизвестный шаг исключает только соответствующий SKU из ребалансировки с причиной, а не блокирует всю обычную закупку.

Смена поставщика переоценивает сокращение закупки по текущей закупочной цене, но не изменяет принятые физические количества. Фильтры перемещений используют учётную цену снимка. Физический surplus>Max гарантирует отсутствие нового дефицита донора вследствие этого ребаланса; прежняя ветка donorPct<100 полностью удалена.

## 3. Техническое приложение

**Verdict — REFACTOR-IN-PR.** Точечная подготовка нужна на границе demand/orders: текущий builder и supplier problems читают original deficitQty. Сохраняем один builder и передаём ему effective purchase projection. Без этого UI потребности, supplier decisions и orders покажут разные количества. Предварительный рефакторинг всего приложения не нужен.

**Change impact.** Новый чистый rebalancing domain, accepted ledger, purchase projection, selectors/store, persistence и Demand/Suppliers/Orders UI. Существующие выбор поставщика, правила закупочных цен, supplier grouping и CSV-колонки сохраняются.

**Technical design.** Import adapter→snapshot→proposal/accepted ledger→purchase projection→existing order builder→selectors→UI/export. Основная UI-потребность использует purchaseQty/purchaseAmount/purchaseStatus; original demand служит пояснением. Полное сохранение рабочего сеанса — отдельный storage adapter, без формул в React/IndexedDB.

**Implementation order.** Два PR: PR1 — domain/accepted workflow/purchase projection; PR2 — полное восстановление, операторское принятие, поп-апы и экспорт. Один PR допустим с теми же независимыми commits. Функцию релизить после полного PR2.

**Verification.** Синтетические fixtures, числовые сценарии, повторное и частичное принятие, отмена, сохранение/ошибки, инвалидация, чтение созданного XLSX и настоящий file:// offline workflow. Проверки в задачах — будущие команды, не утверждение об их уже состоявшемся прохождении.

## 4. PR1 — домен и закупочная проекция

### Task 0: Синхронизировать действующие спецификации

**Modify:** `AGENTS.md`, `docs/product/SPEC.md`, `docs/data/DATA_CONTRACTS.md`, `docs/data/DERIVED_PROJECTIONS.md`, `docs/architecture/ARCHITECTURE.md`, `docs/ux/UX_AND_EXPORT.md`, `docs/testing/ACCEPTANCE_CRITERIA.md`, `DESIGN.md`; исторические rebalancing design/plans03.09. **Create:** `docs/superpowers/specs/2026-10-20-rebalancing-order-integration-design.md` с разделом2 этого документа.

- [ ] Закрепить подтверждённый ORDERS_AUTO и текущую приоритетность правил. Donor floor всегдаMax; recipient trigger configurable; route defaultsBOTH; сохраняется весь session state.
- [ ] Заменить в AC нового ТЗ донор50%=40 на donor surplus20 независимо от настройки получателя; прежний AC-02 больше не действует. Сохранить новый default20, receiver0%=10, cap50 и network trap20. Для получателей добавить оба trigger mode.
- [ ] Удалить из будущего плана внешний journal import, донорский slider и обязательные три режима orders. Зафиксировать accepted subset и popup как продуктовый workflow; старые conflicting statements пометить superseded, а не оставлять два нормативных алгоритма.
- [ ] Проверить документальное покрытие настроек, финансовых фильтров, полного persistence и новой загрузки отчётов. Исторические Pareto/flow-map задачи не переносить автоматически в этот MVP; их статус отдельно зафиксировать в новом design.
- [ ] Commit `docs: align accepted transfers and purchasing requirements`.

### Task 1: Контракты, снимок и валидация

**Create:** `src/domain/rebalancing/{types,validation,index}.ts`, `src/import/rebalanceSnapshot.ts`, `tests/fixtures/rebalanceFixtures.ts`, `tests/domain/rebalancingValidation.test.ts`, `tests/import/rebalanceSnapshot.test.ts`.

**Interfaces:** `createRebalanceSnapshot(input: SnapshotAdapterInput): SnapshotBuildResult`; `validateRebalanceSnapshot(snapshot: RebalanceSnapshot): RebalanceIssue[]`. Типы в `types.ts`: snapshotId/schemaVersion/branches{id,name,active}/skus{skuCode,name,unit,quantityStep,referencePrice}/stocks{skuCode,branchId,stock,min,max,sourceRow}; config{recipientTrigger:'BELOW_MIN'|'BELOW_MAX',receiverPct,routeConfig,unitPriceFilter,skuAmountFilter}; default triggerBELOW_MIN, receiverPct100, filters off. Issue содержит code/message/sourceRow/skuCode/branchId/severity. SnapshotBuildResult возвращает валидный набор и issues.

- [ ] RED: ведущие нули сохраняются; дубли не выбираются last-write-wins; unknown branch alias требует mapping; missing Min/Max не превращаются в0; Min>Max/negative/nonfinite/step≤0 диагностируются; rename сохраняет ID; исходный dataset не мутирует. Закупочное NO_NORM при Max≤0 сохраняется; для ребалансировки явный нулевой норматив допустим, пропущенный — нет.
- [ ] Run `npm test -- --run tests/domain/rebalancingValidation.test.ts tests/import/rebalanceSnapshot.test.ts`; ожидается RED из-за отсутствующих APIs.
- [ ] Implement adapter над текущим MinMaxDataset, registry и сохранёнными SKU policies. Default синтетического fixture: SKU00001, unitшт, step1, price1200; D Min20/Max60/S80, R Min20/Max60/S10; routeBOTH.
- [ ] GREEN той же командой; `npm run typecheck`; commit `feat: validate rebalance snapshots and recipient settings`.

### Task 2: Принятие выбранных движений и отмена

**Create:** `src/domain/rebalancing/acceptedTransfers.ts`, `tests/domain/acceptedTransfers.test.ts`.

**Interfaces:** `acceptTransfers(input: AcceptTransfersInput): AcceptedTransferChange`; `revokeTransfers(input: RevokeTransfersInput): AcceptedTransferChange`. AcceptTransfersInput: snapshot, currentAccepted, currentProposal:RebalanceProposal, selectedLineIds, currentRevision, expectedRevision, currentConfigFingerprint, acceptedAt и transferIdBySourceLineId. RevokeTransfersInput: snapshot, currentAccepted, transferIds, currentRevision, expectedRevision. Результат: nextAccepted, changedSkuBranchKeys, nextRevision либо typed validation error. AcceptedTransfer{transferId,sourceRunId,sourceLineId,skuCode,fromBranchId,toBranchId,qty,snapshotId,acceptedAt,acceptedConfig}; timestamps/IDs передаются параметрами, не создаются скрыто в чистой функции. BaseAcceptedRevision proposal — контекст расчёта, а не запрет на последовательное принятие; optimistic guard проверяет currentRevision===expectedRevision.

- [ ] RED: proposal содержит вход15 и20, accept только первой строки → acceptedIncoming15; selection без accept→0; повторный accept той же sourceRunId/sourceLineId→no-op; revoke первой→0. Нельзя выбрать неизвестную/stale proposal line и принять qty из UI без проверки.
- [ ] RED: BELOW_MIN, stock10/Min20/Max60, два донора с surplus15 и20. Последовательно принять15 и затем20 из одного run → incoming35, purchase15. После первого принятия прогнозный stock25 не запрещает вторую исходно допустимую строку. Заменённый run или другой configFingerprint даёт STALE_PROPOSAL; currentRevision!==expectedRevision даёт REVISION_CONFLICT. Identity конфликт даёт TRANSFER_ID_CONFLICT, нарушение количества/лимитов — INVALID_TRANSFER_BATCH; ledger не меняется при любой ошибке.
- [ ] RED: два получателя суммарно не превышают donor stock−Max; accepted плюс новый batch проверяются совместно; Max/target/step/route и денежные пороги выбранного subset соблюдены. Совпавший transfer ID с другими неизменяемыми данными — ошибка. Вся некорректная партия отклоняется атомарно с причинами, частичного скрытого принятия нет.
- [ ] Run `npm test -- --run tests/domain/acceptedTransfers.test.ts`; проверить RED.
- [ ] Implement canonical accepted ledger и командные APIs. Непринятые/отклонённые строки не входят в ledger; отмена снимает только указанные accepted IDs. Изменение config не переписывает ledger.
- [ ] GREEN; `npm run typecheck`; commit `feat: accept and revoke explicit transfer selections`.

### Task 3: Детерминированное распределение с оставшимися ограничениями

**Create:** `src/domain/rebalancing/{routes,flow,calculate}.ts`, `tests/domain/rebalancingRoutes.test.ts`, `tests/domain/rebalancingFlow.test.ts`, `tests/domain/rebalancingAcceptance.test.ts`.

**Interfaces:** `buildRouteIndex(config: RouteConfig, branches: RebalanceBranch[]): RouteIndex`; `calculateRebalance(snapshot: RebalanceSnapshot, config: RebalanceConfig, accepted: AcceptedTransfer[]): RebalanceResult`; public exports через `index.ts`. RebalanceResult{inputFingerprint,algorithmVersion,transfers,eligibleRecipientKeys,uncoveredNeed,balances,exclusions} содержит только детерминированные поля. App-layer оборачивает его в RebalanceProposal extends RebalanceResult {runId,createdAt,snapshotId,baseAcceptedRevision,configFingerprint}; эта обёртка определена в `types.ts`, её metadata передаются приложением, не генерируются алгоритмом. sourceLineId — канонический ключ skuCode/fromBranchId/toBranchId в пределах run.

- [ ] RED: default donor20; donor никогда не отдаёт40 при stock80/Max60; receiverPct0% даёт10; recipient cap50. R S30/Min20/Max60: BELOW_MIN→0, BELOW_MAX→до30 при достаточном surplus. S=Min не подходит BELOW_MIN, S=Max не подходит BELOW_MAX. Если S>target, new transfer0.
- [ ] RED: network trap D1/D2 по10, D1→R1/R2,D2→R1 → покрытие20. Дробный step0.25 соблюдён; отсутствие цены разрешено при filters off;1200×(6+5)=13200 проходит;1200×6=7200 и равенство порогу не проходят; перестановка входов даёт одинаковый canonical result.
- [ ] RED: переход Min→target не замораживает ранний выбор дуг. BELOW_MAX, D1/D2 surplus10; D1→R1/R2, D2→R1; R1 stock0/Min10/Max10, R2 stock0/Min0/Max10. Итог D2→R1=10 и D1→R2=10: Min покрыт10, всего20. Если этап доMin выбрал D1→R1, residual graph обязан переназначить поток без потери покрытия доMin.
- [ ] RED: accepted вход15 уменьшает остаточный recipient need; accepted исходящий15 при donor surplus20 оставляет новым предложениям максимум5; новый расчёт не удаляет accepted и не переиспользует ожидаемый вход.
- [ ] Run `npm test -- --run tests/domain/rebalancingRoutes.test.ts tests/domain/rebalancingFlow.test.ts tests/domain/rebalancingAcceptance.test.ts`; проверить RED.
- [ ] Implement целочисленные capacities в шагах SKU и residual graph с обратными дугами; сначала покрытие доMin, потом доtarget; supply только surplus>Max. В режиме BELOW_MAX eligible recipients фиксируются перед распределением по их прогнозному остатку с уже принятыми движениями. Переназначения потока не уменьшают достигнутые старшие цели; deterministic consolidation не ухудшает покрытие. Не заявлять точный fixed-charge minimum маршрутов.
- [ ] GREEN; `npm run typecheck`; commit `feat: calculate donor-safe transfer proposals`.

### Task 4: Текущая потребность и единый order builder

**Create:** `src/domain/purchaseDemand.ts`, `tests/domain/purchaseDemand.test.ts`. **Modify:** `src/domain/types.ts`, `src/domain/orders.ts`, `tests/domain/orders.test.ts`.

**Interfaces:** `buildPurchaseDemand(demand: PricedDemandLine[], accepted: AcceptedTransfer[], branchRegistry: BranchRegistry): PurchaseDemandLine[]`. PurchaseDemandLine extends PricedDemandLine; добавляет originalNeed,acceptedIncomingQty,acceptedOutgoingQty,projectedStock,purchaseQty,purchaseAmount,purchaseStatus,acceptedTransferIds. Original deficitQty/stock остаются исходными внутри модели; UI текущей потребности читает purchase-поля. `buildOrderProjection(demand: (PricedDemandLine|PurchaseDemandLine)[],resolutions:SupplierResolution[],edits:OrderQtyEdit[],settings:OrderSettings):OrderProjection` использует purchaseQty при наличии, legacy deficitQty иначе.

- [ ] RED: исходно50, приняты15→purchase35; неприняты20 не влияют; дополнительно приняты20→15; revoke15→30. Тестировать прямыми assertions `expect(line.purchaseQty).toBe(35)` и `expect(line.deficitQty).toBe(50)`. Original input frozen и не мутирует.
- [ ] RED: fully covered SKU отсутствует в order lines/unassigned; partial сохраняет цену/blockers; донор не получает новый дефицит благодаря floorMax; price null не становится0; manual qty40 при purchase35 остаётся40 с предупреждением. Threshold modes пересчитываются по активным заказам.
- [ ] Run `npm test -- --run tests/domain/purchaseDemand.test.ts tests/domain/orders.test.ts tests/domain/orderWorkflow.test.ts`; проверить RED новых cases и сохранность legacy behavior.
- [ ] Implement один группировщик заказов, одну систему закупочных цен и порогов; не копировать orders.ts для сравнения. OrderLine получает purchase context и relevant accepted IDs; исходный расчёт доступен для popup.
- [ ] GREEN; `npm run typecheck`; `npm test -- --run`; `npm run build`; commit `feat: build orders from accepted-transfer demand`.

**PR1 gate:** домен принимает только выбранные движения, не переиспользует запас, сохраняет floorMax и даёт правильный рабочий orderQty. UI новой функции пока не подключён; текущее приложение работает как раньше.

## 5. PR2 — полное сохранение и рабочий интерфейс

### Task 5: Сохранение всего сеанса, app state и инвалидация

**Create:** `src/domain/rebalanceWorkflow.ts`, `src/persistence/workspaces.ts`, `tests/domain/rebalanceWorkflow.test.ts`, `tests/persistence/workspaces.test.ts`. **Modify:** `src/app/appStore.ts`, `src/app/selectors.ts`, `src/app/useDerivedState.ts`, `src/app/App.tsx`, `src/persistence/db.ts`, `tests/ui/renderWithStore.tsx`, `tests/ui/useDerivedState.test.tsx`, `tests/persistence/persistence.test.ts`.

**Interfaces:** `buildAcceptedTransferStatePatch(input: AcceptedWorkflowInput): AcceptedWorkflowResult`; `loadWorkspace(id:string):Promise<StoredWorkspace|null>`; `saveWorkspace(workspace:StoredWorkspace,expectedRevision:number):Promise<void>`; `listWorkspaces():Promise<WorkspaceMetadata[]>`. StoredWorkspace version1 содержит полный session state раздела2.5; raw import bytes хранятся ссылками в собственном blob store. IndexedDB v1→v2 добавляет `workspaces`(key workspaceId),`workspaceFiles`(key fileId),`workspaceMeta`(key main); старые supplierOverrides/settings сохраняются. AcceptedWorkflowInput получает previous/next ledger, previous/next projections, edits, review/export IDs; результат — целевой patch/affected IDs/число сбрасываемых manual edits.

- [ ] RED: v1 migration сохраняет mappings/settings; round-trip восстанавливает оба отчёта, настройки, proposal, selection/rejections, accepted, edits, reviews, exports и UI preferences. После reload повторный import не нужен. Unsupported workspace version и quota/write failure не очищают БД.
- [ ] RED: failed save принятия не меняет accepted/потребность; expectedRevision защищает stale write; быстрые последовательные изменения записываются по ревизиям без потери последнего. Полное изменение accepted+edits+markers сохраняется одной транзакцией до публикации committed UI state.
- [ ] RED: positive→0 и0→positive снимают markers по union old/new orders; unrelated edits сохраняются; SUPPLIER_TOTAL threshold ripple снимает marker соседнего заказа при изменении readiness. Повтор identical accept/revoke отсутствующего ID — no-op. Price-only change переоценивает money и signatures, а не accepted qty.
- [ ] Run `npm test -- --run tests/domain/rebalanceWorkflow.test.ts tests/persistence/workspaces.test.ts tests/ui/useDerivedState.test.tsx`; проверить RED.
- [ ] Implement durable workspace commands и последовательное сохранение остальных пользовательских изменений; после bootstrap загружается latest active workspace. Для принятия/отмены сначала построить новый валидный state, получить app-owned подтверждение affected edits, затем persist+publish. При отмене диалога изменений нет.
- [ ] В selectors добавить originalDemand,purchaseDemand,proposal,acceptedSummary; projection строится из purchaseDemand. В memo dependencies включить business revisions; поиск/selection/pop-up не пересчитывают allocation graph. При новой загрузке входов создать новую snapshot revision и сохранить предыдущую в истории, не удаляя её и не перенося accepted на обновлённые остатки автоматически.
- [ ] App-layer создаёт RebalanceProposal, добавляя runId/createdAt/baseAcceptedRevision/configFingerprint к чистому RebalanceResult; при частичном принятии сохраняет текущий proposal, при явном пересчёте заменяет его. Поэтому воспроизводимость доменного результата не зависит от UUID или часов.
- [ ] GREEN; `npm run typecheck`; `npm test -- --run`; `npm run build`; commit `feat: persist complete purchasing workspaces and transfer revisions`.

### Task 6: Оператор принимает конкретные строки

**Create:** `src/features/rebalancing/RebalancingPage.tsx`, `RoutesMatrix.tsx`, `ConditionsPanel.tsx`, `ResultsTable.tsx`, `AcceptTransfersDialog.tsx`, `tests/ui/rebalancingPage.test.tsx`, `tests/ui/acceptTransfers.test.tsx`. **Modify:** `src/app/App.tsx`, `src/features/import/ImportPage.tsx`, `src/styles/app.css`, `tests/ui/importReviewReset.test.tsx`, `tests/ui/importWorkflow.test.tsx`.

**Interfaces:** RebalancingPage потребляет Store/selectors и команды Tasks2/5. ResultsTable получает proposal/accepted/selectedLineIds; selection не вызывает принятие. Диалог показывает N выбранных строк, суммарный вход/выход, изменение закупки и affected edits.

- [ ] RED: раздел между подразделениями и поставщиками; внутренние «Маршруты / Условия / Результаты». Настройка BELOW_MIN/BELOW_MAX, один receiver slider; donor slider отсутствует; route matrix зеркальна, diagonal disabled, defaultBOTH.
- [ ] RED: выбрать2 из10 не меняет потребность; «Принять выбранные(2)» меняет только2; rejected/unselected не учитываются; повтор не удваивает; отмена принятия пересчитывает назад; новый proposal не снимает accepted; изменённые config не маскируются как отмена прежних решений.
- [ ] RED: все отчёты/selection/accepted восстанавливаются после remount; новая загрузка любого отчёта сообщает о новой snapshot revision и сохраняет старый workspace в истории. Старое асинхронное чтение файла не восстанавливает неактуальный снимок.
- [ ] Run `npm test -- --run tests/ui/rebalancingPage.test.tsx tests/ui/acceptTransfers.test.tsx tests/ui/importReviewReset.test.tsx`; проверить RED.
- [ ] Implement app-owned dialogs и текстовые PROPOSED/ACCEPTED/REJECTED labels; выбранные галочки имеют самостоятельный счётчик. Большие результаты/матрица виртуализируются, sticky identities/поиск/клавиатурное управление соответствуют DESIGN.md. Убрать устаревшее «ШагN из4» в затронутом workflow.
- [ ] GREEN; `npm run typecheck`; `npm test -- --run`; `npm run build`; commit `feat: accept selected movements in rebalancing workspace`.

### Task 7: Текущая потребность и краткий поп-ап

**Create:** `src/features/rebalancing/AcceptedMovementsPopover.tsx`, `src/domain/rebalancing/movementSummary.ts`, `tests/domain/movementSummary.test.ts`, `tests/ui/acceptedMovementsPopover.test.tsx`, `tests/ui/rebalanceOrderIntegration.test.tsx`. **Modify:** `src/features/demand/DemandPage.tsx`, `src/features/suppliers/SuppliersPage.tsx`, `src/features/orders/OrdersPage.tsx`, `src/features/orders/OrderDrawer.tsx`, `src/features/orders/SupplierOrdersDrawer.tsx`, `tests/ui/demandPage.test.tsx`, `tests/ui/suppliersPage.test.tsx`, `tests/ui/ordersPage.test.tsx`, `tests/ui/supplierOrdersDrawer.test.tsx`.

**Interfaces:** `buildMovementSummary(input: MovementSummaryInput): MovementSummary`; input{purchaseDemand,acceptedTransfers,scope:{skuCode?,branchId?,orderIds?}}; summary{originalNeed,currentNeed,incomingQty,outgoingQty,transferCount,transfers,manualOrderQty?}. `AcceptedMovementsPopover({summary,onOpenRebalancing}:Props)` только отображает полученные значения. Aggregate scope дедуплицирует transfer IDs; ошибки разных единиц не суммируют физически несопоставимые величины в «шт».

- [ ] RED: основное «Нужно» меняется50→35 после принятия15; status/filter/KPI current demand соответствуют purchaseQty/purchaseStatus. Popup показывает50/15/35 и только accepted строку; неприняты20 не показаны как учтённые. Закрытие/открытие popup не меняет order state.
- [ ] RED: fully covered SKU исчезает из supplier problems/массового назначения; partially covered остаётся. Покрытую строку можно найти в разделе принятых и просмотре всех товаров, даже если её больше нет в заказе. Поп-ап работает и в order drawer, и в supplier matrix, данные совпадают.
- [ ] RED: manual orderQty40 при purchase35 поясняется отдельно; смена поставщика переоценивает суммы без изменения accepted. Без принятых индикатора нет. Pop-up имеет focus return, закрытие Escape и читаемую краткую таблицу без новой страницы обязательных сравнений.
- [ ] Run `npm test -- --run tests/domain/movementSummary.test.ts tests/ui/acceptedMovementsPopover.test.tsx tests/ui/rebalanceOrderIntegration.test.tsx tests/ui/demandPage.test.tsx tests/ui/suppliersPage.test.tsx tests/ui/ordersPage.test.tsx tests/ui/supplierOrdersDrawer.test.tsx`; проверить RED.
- [ ] Implement текущие demand KPI/колонки по purchase-полям; источник фактического stock явно подписать «Остаток по отчёту», projected stock доступен в пояснении. NeededSkuCodes/problemDemand/problemAmount и supplier belowMin summary используют текущую purchaseQty>0. Сохранить общий applyOrderQtyChange для обоих drawer и единый order builder.
- [ ] GREEN; `npm run typecheck`; `npm test -- --run`; `npm run build`; commit `feat: explain effective demand with accepted movements popovers`.

### Task 8: Экспорт, восстановление и полный offline acceptance

**Create:** `src/export/rebalancingWorkbook.ts`, `tests/export/rebalancingWorkbook.test.ts`. **Modify:** `src/features/orders/OrdersPage.tsx`, `src/features/rebalancing/RebalancingPage.tsx`, `tests/export/csv.test.ts`, `tests/export/supplierWorkbook.test.ts`, `tests/e2e/offline.spec.ts`.

**Interfaces:** `buildRebalancingWorkbook(input:RebalancingExportInput):Promise<ArrayBuffer>`; input содержит snapshot/config/proposal/accepted/purchaseDemand/run metadata. Supplier orderToCsv/buildSupplierWorkbook получают только рабочую projection после текущих blockers/threshold rules. Колонки supplier CSV не меняются.

- [ ] RED: proposal вход15/20, accepted только15 → supplier CSV/XLSX qty35, не15 и не50; manual40 экспортируется40. Поиск, галочки и открытый pop-up не меняют payload. Глобальный ZIP использует полный текущий order projection, не фильтр supplier search.
- [ ] RED: rebalance XLSX имеет «Принятые», «Предложения», «Сводка», «Исключения», «Параметры»; proposal/accepted визуально и структурно различаются, totals учтённых закупок берутся только из accepted. Повторно прочитать ArrayBuffer ExcelJS и проверить содержимое. Unknown money остаётся пустым с пояснением.
- [ ] RED: сбой workbook/download не ставит EXPORTED; успешный supplier export помечает только фактически выгруженные заказы; экспорт отчёта ребалансировки не меняет supplier export markers.
- [ ] Run `npm test -- --run tests/export/rebalancingWorkbook.test.ts tests/export/csv.test.ts tests/export/supplierWorkbook.test.ts`; проверить RED, implement через существующий exceljs.
- [ ] Extend настоящий file:// E2E: импорт2 синтетических отчётов→настройки→proposal→выбор подмножества→принять→Demand35→popup→Suppliers→Orders→CSV/XLSX→reload без повторного импорта→проверить accepted/orderQty/review/export→отмена принятия→возврат потребности. Сохранить no-network/перенос папки проверки; не заменять их dev-server тестом.
- [ ] GREEN: `npm run typecheck`; `npm test -- --run`; `npm run build`; `npm run test:e2e`; commit `feat: export and restore accepted-transfer purchasing workflow`.

## 6. Матрица покрытия и выпуск

| Требование | Проверяется |
| --- | --- |
| Получатель нижеMin/нижеMax — настройка | Tasks0,1,3,6 |
| Донор только вышеMax, no reuse/no transit | Tasks1–4 |
| Направления и defaultBOTH | Tasks0,3,6 |
| Только принятые конкретные строки меняют потребность | Tasks2,4,6–8 |
| Поп-ап кратких учтённых перемещений, baseline для пояснения | Task7 |
| Полное восстановление всей работы | Tasks5,6,8 |
| Price/unit/sku sum filters и корректный selected subset | Tasks2,3,6 |
| Partial/full coverage, no supplier stale problems | Tasks4,7 |
| Targeted invalidation и threshold ripple | Task5 |
| XLSX/CSV parity и настоящий file:// | Task8 |

Порядок сдачи: PR1 `feat: rebalance domain and accepted demand` → PR2 `feat: integrate accepted movements into purchasing workflow`. При одном PR сохранить Tasks0…8 отдельными логическими commits. Релиз только полного сценария принятия/восстановления, а не промежуточного изменения orders без пояснения.

Миграция IndexedDB аддитивная. Не удалять БД ради отката; старый openDB(version1) после перехода на2 не считать безопасным rollback. Для отката подготовить совместимый сv2 build, который сохраняет workspace data и явно отключает новую feature; не выдавать baseline-заказы за прежние рабочие без уведомления оператора. Историю пользователя не чистить автоматически.

При исполнении перед каждым законченным этапом обязательны typecheck/tests/build, финально offline E2E. Реальные файлы компании не коммитятся; тестовые workbooks генерируются синтетически. Программная реализация, API1С, проведение и отслеживание фактического исполнения перемещений не входят в текущую задачу подготовки плана.

## 7. Самопроверка обновлённого плана

- Репозиторий больше не предположение: подтверждён ORDERS_AUTO.
- Нет донорского slider/выдачи нижеMax, отдельного импорта внешнего журнала и обязательного трёхрежимного выбора закупки.
- Неизменность исходного снимка — внутреннее правило аудита; основная потребность оператора действительно пересчитывается по принятым движениям.
- Отбор галочками, proposals, accepted и rejected не смешиваются; accept subset/revoke/no-op/recalculation имеют отдельные tests.
- Полное восстановление сохраняет imported reports, proposals, selected/accepted/rejected state и весь purchasing workflow; reload не сбрасывает решения.
- Согласован единый публичный domain entry, общий order builder, существующий manual edit pipeline и одна рабочая projection для экспорта.
- Числовой сценарий50→35→15→30, пороговые/маршрутные инварианты, ошибка persistence и snapshot replacement покрыты конкретными задачами.
- Новые типы живут в `src/domain/rebalancing/types.ts`; PurchaseDemandLine — в `src/domain/purchaseDemand.ts`; workspace storage DTO — в `src/persistence/workspaces.ts`. React-компоненты не содержат бизнес-формул.
- Проверка документа и числовых примеров не является выполнением будущих unit/E2E-тестов приложения. Исходники приложения не изменялись.
