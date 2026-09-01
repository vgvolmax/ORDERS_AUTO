# ORDERS_AUTO — Acceptance Criteria

## 1. Автоматические quality gates

`npm run verify` обязан выполнять и успешно завершать:

```text
typecheck
unit/integration tests
production build
offline production package check
```

Дополнительно CI обязан открыть production `ORDERS_AUTO/index.html` через `file://` в Chrome и подтвердить отсутствие page/console errors и runtime HTTP/HTTPS requests.

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

- production build создаёт автономную папку `ORDERS_AUTO/`;
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
