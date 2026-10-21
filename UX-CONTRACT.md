# UX Contract

## Product and source ownership

ORDERS_AUTO — русский локальный инструмент закупок, desktop от 1280 px. Работает через `file://`, без сети и сервера. Дата сохраняется в ISO UTC; история показывает местное время браузера с часовым поясом. Цель доступности — WCAG 2.2 AA; автоматические тесты не являются полной сертификацией.

Источники бизнес-правил: `docs/product/SPEC.md`, `docs/data/DATA_CONTRACTS.md`, `docs/data/DERIVED_PROJECTIONS.md`, `docs/ux/UX_AND_EXPORT.md`, `docs/superpowers/specs/2026-10-20-rebalancing-order-integration-design.md`. Приоритет задаёт `AGENTS.md`. Срок хранения/жизненный цикл — раздел полного сохранения сеансов в интеграционном spec; UI не добавляет автоматического удаления.

`DESIGN.md` отражает канонические runtime tokens `src/styles/app.css`; новая функция сохраняет язык существующих Demand/Orders. Единственная тема — светлая рабочая область с тёмной навигацией. Нет внешних шрифтов или ресурсов. Изменения tokens проверяются вместе с CSS и скриншотами sibling screens.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Table Selection | ResultsTable / SupplierDecisions | persisted selectedLineIds / uiPreferences | Видимые предложения; supplier scope явно выбирается | acceptTransfers.test.tsx; offline.spec.ts |
| Select/Listbox | components/ui.tsx Select | native HTML select | OS popup принят для компактных настроек и русских option labels; без авторского popup | rebalancingPage.test.tsx; browser keyboard |
| Form | ConditionsPanel / PolicyEditor / QuantityInput | domain validation + app commit | inline settings; explicit save for unit/step; noValidate | rebalancingPage.test.tsx |
| Scrollbar | styles/app.css | глобальные scrollbar-color/width | Таблицы имеют собственный горизонтальный/вертикальный scroll | offline screenshots |
| Toast | App | state.toast | Один status, 3.5 секунды; ошибки сохранения имеют отдельный постоянный banner | workspaceRestore / persistence tests |
| CRUD | workspaceSession + rebalanceActions | committed workspace | Принять/отменить с подтверждением; импорт и восстановление создают новый сеанс | offline.spec.ts; workspaceSession.test.ts |

## Navigation and dataset state

Порядок: все товары → подразделения → ребалансировка → поставщики → заказы. История доступна отдельно. Последняя страница, фильтры, выбор строк и ширины матрицы сохраняются в IndexedDB. URL не хранит рабочие данные: автономный file:// не имеет серверных маршрутов. Подтверждения и краткие пояснения — временные overlays.

Большие наборы используют VirtualTable; шапка и строки разделяют горизонтальный scroll. Матрица маршрутов сохраняет идентификаторы при горизонтальном scroll. Поиск локальный; очистка немедленная и возвращает фокус. Пустые предложения, отсутствие принятых и отсутствие результата имеют разные сообщения.

Галочка не принимает перемещение. Массовый выбор ограничен видимыми допустимыми предложениями, остальные галочки сохраняются и входят в отдельный счётчик. Отклонение снимает галочку. Принятие ограничено конкретными выбранными строками и требует app-owned подтверждения с изменением закупки/сбросом затронутых ручных количеств.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|
| Импорт | Выбор файла | busy конкретного отчёта | Тот же экран, сохранённый новый снимок | Предыдущий отчёт остаётся; повторный выбор | На file input | ImportPage / importWorkflow tests |
| Расчёт | Рассчитать перемещения | Кнопка недоступна | Результаты; принятые сохранены | Inline error, повтор | В рабочей области | RebalancingPage |
| Принять/отменить | Выбранные IDs / строка | Подтверждение блокирует повтор | Текущие результаты и новые заказы | Диалог и исходный committed state сохранены | Возврат к trigger, если он остался | rebalanceActions / Dialog |
| Экспорт | CSV/XLSX/ZIP | Export busy | Текущая страница | Повтор выгрузки; markers только для совпавшего payload | Кнопка экспорта | OrdersPage tests |
| Восстановление | История → подтверждение | Кнопки недоступны | Копия сохранённого сеанса | Текущий сеанс остаётся | Восстановленная страница | workspaceSession tests |
| Отмена окна | Escape / отмена / фон | Нет мутации | Исходная страница | Не требуется | Возврат к trigger | dialog.test.tsx |

## Overlays and resilience

Dialog и useModalLayer — канонический владелец focus trap, Escape, inert background, scroll lock и возврата фокуса; drawers используют тот же hook и portal. Вложенный диалог выше drawer, toast выше диалога; runtime tokens определены в CSS. Длинный текст скроллится внутри ограниченного viewport окна.

Сохранение бизнес-состояния — pessimistic: persist, затем publish. QuantityInput хранит локальный текст ввода, чтобы быстрый набор не затирался промежуточной записью; количество в расчёте меняется после сохранения. Ошибка возвращает последнее сохранённое значение. Проверка и экспорт ждут завершения записи количества. Команды сериализуются, используют ревизии workspace/accepted ledger. Ошибка записи сохраняет предыдущую версию и показывает постоянное объяснение с повторным открытием сохранённого сеанса. CAS не позволяет другой вкладке молча перезаписать актуальную версию. Импорт имеет отдельное поколение отмены: позднее чтение не возвращает сброшенный сеанс. Никаких автоматических очисток БД или переносов accepted в свежий импорт.

## Verification

Команды определены в premium-ui.json. Компонентные тесты проверяют фокус, Escape, зеркальные маршруты, явные единицы, отмену подтверждения, текущие количества, ручные правки, storage failure и stale export. Реальный Chrome file:// E2E проверяет импорт → выбранное принятие → popup → заказы/CSV/XLSX → reload → отмену; сохраняет кадры при 1280 и 1440 px. Sibling comparison — Demand и Orders с существующими токенами. Статический аудит дополняет эти проверки; реальный браузер остаётся обязательным.
