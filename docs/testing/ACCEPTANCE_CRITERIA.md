> **Правила29.10.2026 имеют приоритет:** полное покрытие SKU и маршруты по согласованной `2026-10-29-routes-full-coverage-design.md`. Частичное распределение и ручные приоритеты23–28.10 ниже — исторические и заменены уточнением в конце документа.

> **Rebalancing20.10.2026:** для изменённой функции действуют уточнения в конце этого документа и `docs/superpowers/specs/2026-10-20-rebalancing-order-integration-design.md`; исторические правила03.09 в конфликтующей части заменены. PR1 реализует только домен, остальная интеграция — PR2.

# ORDERS_AUTO — Acceptance Criteria

## 1. Автоматические quality gates

`npm run verify` обязан выполнять и успешно завершать:

```text
typecheck
unit/integration tests
production build
offline production package check
```

Дополнительно CI обязан открыть production `dist/ORDERS_AUTO/index.html` через `file://` в Chrome, повторить запуск после копирования папки в путь с пробелами и кириллицей и подтвердить отсутствие page/console errors и runtime HTTP/HTTPS requests.

## 2. Parser tests — Min-Max

Обязательные кейсы:

1. Групповая строка с кодом, но без последующих branch rows, не создаёт SKU.
2. SKU row + 9 branch rows создаёт 1 Sku и 9 BranchStock.
3. Пустой branch stock становится 0.
4. Пустой MIN/MAX остаётся null.
5. Код с ведущими нулями не превращается в number.
6. Дубликат `skuCode+branch` создаёт validation issue.
7. Расхождение parent total и суммы branches создаёт warning, но branches остаются source of truth.
8. Новое название подразделения появляется в `branches` автоматически.

## 3. Parser tests — suppliers

1. Парсится legacy `.xls` buffer.
2. Парсится `.xlsx` buffer.
3. Flat supplier layout.
4. Grouped supplier layout с `currentSupplier`.
5. `Итого/Всего` не становятся item lines.
6. Дубли `supplier+skuCode` агрегируются.
7. Weighted price = `Σamount / Σqty`.
8. Пустой код не создаёт supplier history item.

Fixtures генерировать программно в `tests/fixtures/workbookBuilders.ts`, реальные файлы не коммитить.

## 4. Demand boundary tests

Для `MIN=20, MAX=40`:

| Stock | Expected |
|---:|---|
| 40 | OK |
| 39 | YELLOW |
| 30 | YELLOW (ровно 25% дефицита) |
| 29 | ORANGE |
| 20 | ORANGE (50%) |
| 19 | BELOW_MIN (override) |
| 10 | BELOW_MIN |
| 0 | BELOW_MIN |

Дополнительно:

- MAX null/0 → NO_NORM и deficitQty=0;
- MIN null, MAX 40, stock 5 → LIGHT_RED;
- MIN 50, MAX 40 → INVALID_NORM;
- stock 50 при MAX 40 → OK, deficitQty=0.

## 5. Supplier resolution tests

- no candidates → UNRESOLVED;
- one candidate → AUTO_SINGLE;
- two candidates → MANUAL_REQUIRED, selectedSupplier null;
- recommendation выбирает максимум purchaseQty, затем purchaseAmount;
- valid persisted override → MANUAL_SELECTED;
- override отсутствует в новых candidates → STALE_OVERRIDE и blocker.

## 6. Price tests

- selected supplier weighted price доступна → SUPPLIER_HISTORY;
- supplier price null, Min-Max price есть → MIN_MAX_FALLBACK;
- обе null → MISSING, amount null и order blocker.

## 7. Threshold tests

При threshold 10 000 ₽:

- SUPPLIER_TOTAL: поставщик с сетью 12 000 ₽ проходит, даже если branch orders 6 000 + 6 000;
- BRANCH_SUPPLIER: обе клетки 6 000 ₽ belowThreshold;
- changing threshold не удаляет orders и возвращается при `showBelowThreshold=true`.

## 8. Order editing tests

- initial orderQty = deficitQty;
- изменение qty мгновенно меняет line/order/supplier totals;
- qty 0 удаляет строку из экспортируемого состава, но не из расчётной demand модели;
- qty > calculatedQty разрешено и даёт warning;
- отрицательное qty отвергается validation.

## 9. CSV tests

Проверить byte/string output:

- начинается с UTF-8 BOM;
- separator `;`;
- CRLF;
- русские headers в нужном порядке;
- quoted fields корректны при `;`, кавычке и переносе строки;
- экспортируется edited `orderQty`.

## 10. XLSX tests

Сгенерировать workbook и повторно прочитать его тестом:

- есть `Общий заказ`;
- есть листы только подразделений с qty > 0;
- общий SKU агрегирован по подразделениям;
- суммы совпадают с order model;
- sheet names <=31 и уникальны;
- workbook открывается без corruption.

## 11. UI integration acceptance

На синтетическом dataset:

1. загрузить оба файла;
2. увидеть validation summary;
3. перейти в подразделение и увидеть status/deficit/local+network totals;
4. перейти в `Поставщики`, разрешить SKU с двумя кандидатами;
5. задать порог 10 000 ₽ и переключить scope;
6. открыть `Заказы`, увидеть изменение матрицы;
7. изменить orderQty;
8. скачать CSV;
9. скачать supplier XLSX.

## 12. Packaging acceptance

**ORDERS_AUTO — автономное локальное статическое приложение, поставляемое как папка/архив. Пользовательская точка входа — `index.html`, который должен запускаться напрямую через `file://` в актуальном Chrome/Edge без web server и доступа в интернет. Количество файлов внутри production-пакета не ограничено. Все runtime-ресурсы должны находиться внутри пакета и подключаться переносимыми относительными путями.**

- production build создаёт автономную папку `dist/ORDERS_AUTO/`;
- пользовательская точка входа — `ORDERS_AUTO/index.html`;
- количество файлов внутри папки не ограничено;
- все runtime assets находятся внутри этой папки, а runtime paths относительные;
- прямое открытие `index.html` через `file://` работает в актуальном Chrome/Edge;
- приложение работает в offline browser context без HTTP/HTTPS runtime requests;
- CDN, remote fonts/scripts, внешние API, telemetry и analytics отсутствуют;
- для запуска не требуется Node.js/npm/Python, установка зависимостей или web server;
- копирование production-папки в другой filesystem path не ломает приложение;
- CI публикует production-папку как ZIP/artifact.

## 13. Manual smoke on real local reports

Перед релизом разработчик локально использует реальные файлы из `samples/private/` и проверяет:

- Min-Max распознал все подразделения и не превратил групповые строки в SKU;
- supplier parser получил ненулевой список контрагентов и SKU;
- join выполняется по коду;
- unresolved/multiple suppliers видимы, а не потеряны;
- суммы в нескольких случайных SKU вручную совпадают с `MAX-stock`;
- production `ORDERS_AUTO/index.html` работает при двойном клике через `file://` без web server и интернета.

Результаты real-data smoke не должны коммитить содержимое или строки реальных отчётов.

## 14. Operational supplier and order-review regressions

Автоматический acceptance-набор дополнительно фиксирует следующий workflow:

- массовый выбор поставщика поддерживает области `ALL`, `SELECTED` и
  `EXCEPT_SELECTED`, по умолчанию защищает ручные назначения и заменяет их
  только после явного выбора «Перезаписать ручные назначения»; preview считает
  фактически изменяемые назначения, а сворачивание блока не сбрасывает выбор;
- повторная запись текущего `orderQty` является no-op и сохраняет edits,
  review/export markers; реальное изменение снимает оба marker, а возврат к
  `calculatedQty` удаляет manual edit;
- supplier matrix использует тот же state/edit pipeline, что карточка заказа,
  и после изменения ячейки одновременно пересчитывает SKU, подразделение и
  поставщика, показывает `✋` и снимает review конкретного заказа;
- supplier summary показывает сумму, число фактических branch orders, число
  уникальных SKU, прогресс review и количество ручных изменений;
- глобальные ZIP-действия строятся из полной order projection и не зависят от
  supplier search или скрытия строк; hard blocker исключает заказ даже при
  сохранённом review marker;
- XLSX builder получает уже отфильтрованный subset заказов: dashboard, branch
  sheets, количества и суммы строятся только из переданного subset;
- успешная замена каждого из двух отчётов независимо очищает review и stale
  export markers;
- READY без review нейтрален, reviewed выделен зелёным, а blocker всегда имеет
  красный визуальный приоритет над review на order и supplier уровнях;
- matrix сохраняет контекст большой таблицы за счёт sticky header и трёх sticky
  identity columns, использует прединдексированную модель и отображает пустые
  ячейки как `—`.


## Расширение20.10.2026: PR1

Обязательные доменные cases перечислены в docs/superpowers/specs/2026-10-20-rebalancing-order-integration-design.md: default20, donor floorMax, receiver0%=10, configurable trigger, cap50, network trap20, rerouting Min→target, step0.25, strict money boundaries, subset filtering, accepted15/20/revoke15 → purchase35/15/30, no-op/revision/stale guards и неизменность входов. Прежний AC donor50%=40 отменён. Legacy orders/qty edits/prices/thresholds обязаны проходить без нового UI. Полное persistence/popover/file:// workflow новой функции относится к PR2; текущий offline E2E остаётся регрессионным gate PR1.


Регрессии21.10.2026: при шаге1/излишке1 получатель с дефицитомMin1 имеет приоритет перед получателем с дефицитомMin0.1, даже при большем target второго. Полный перебор3072 дробных сетей сверяет реальное покрытиеMin и общий объём с независимым optimum. После accept6+5 по1200 и revoke5 при пороге>10000 обязательна диагностика оставшихся7200; разные runs не объединяются, no-op/новый расчёт не снимают предупреждение, восстановление суммы либо полная отмена группы снимают его.

### Компактные приоритеты23.10.2026

UI:6SKU/7подразделений одновременно в карточках, нет кнопок страниц, неактивные получатели не редактируются, exact quantity commands/полное имя/поиск/очистка сохранены. Native E2E11: импорт249SKU/7получателей, ограниченный DOM, все подразделения в одной карточке, отсутствие horizontal/outer scroll, действия доступны на1920×900/1280×720/1024×768/1280×600. Последняя карточка достижима скроллом; ошибочное количество отклоняется, валидная правка сохраняется через scroll/filter/reload. E2E10 продолжает проверять режимы, принятие, потребность и CSV.


### Три массовых приоритета донора ·28.10.2026

Уровни1→2→3→остальные проверены обоими режимами и дробным шагом; manual/accepted/legacy и общий резерв сохраняются. Coverage исключает rejected и дедуплицирует accepted; неизвестная цена не превращается в0. UI проверяет multi-select/move/remove/cancel/manual overwrite, coverage+scope+search, независимое принятие и durable success/failure barrier. Native file:// E2E249SKU/8получателей на1920×900/1280×720/1280×600/1024×768 проверяет геометрию, принятие, reload, CSV и popup текущей потребности.


### Регрессии полного покрытия ·29.10.2026

Новые нормативные тесты заменяют partial/manual priority сценарии: surplus12/need8+6 ->0 и skipped14/12/2; совместные доноры8+6 ->14; маршрутизируемый cut при суммарном запасе20 ->0; полностью закрытый вход исключён намеренно; шаг0.2 при need0.3 ->0. Известные невалидные выбранные строки не дают false full. Денежный порог полного кандидата не скрывает диагностическую нехватку частичного trial flow.

Legacy tab/algorithm/signature, inactive physical+accepted/revoke, частичное принятие полного proposal, pending/rejected/accepted dedup, unknown money/разные единицы, сохранение активности при замене импорта и CAS failure обязательны. Low-level exhaustive flow tests сохранены для диагностического максимума. Chrome file:// проверяет9×9/геометрию1280×720/600, Dialog pair/group, active state, automatic coverage/skip list, acceptance/orders/popup/CSV/reload. Прежние E2E приоритетов заменяются; unrelated supplier/portable/offline/readonly-transfer проверки сохраняются.
