# Готовый промпт для Codex

Скопируй текст ниже в Codex без дополнительных пояснений.

---

Работай в репозитории `vgvolmax/ORDERS_AUTO`.

Нужно реализовать приложение полностью по уже подготовленной спецификации. Продуктовую логику не придумывай и не меняй.

Перед первым изменением кода обязательно прочитай:

1. `AGENTS.md`
2. `docs/product/SPEC.md`
3. `docs/data/DATA_CONTRACTS.md`
4. `docs/data/DERIVED_PROJECTIONS.md`
5. `docs/architecture/ARCHITECTURE.md`
6. `docs/ux/UX_AND_EXPORT.md`
7. `docs/testing/ACCEPTANCE_CRITERIA.md`
8. `docs/superpowers/specs/2026-08-28-orders-auto-design.md`
9. `docs/superpowers/plans/2026-08-28-orders-auto-implementation.md`

Исторические design specs и plans могут содержать явно помеченные superseded packaging-шаги. Для deployment всегда следуй актуальным `SPEC.md` и `ARCHITECTURE.md`, а не этим старым шагам.

Критические ограничения:

- приложение полностью client-side, backend и локальный web server запрещены;
- production — автономная локальная static-папка/ZIP с `index.html` как пользовательской точкой входа;
- `index.html` запускается напрямую через `file://` в актуальном Chrome/Edge без интернета;
- количество production-файлов не ограничено, все runtime dependencies локальны и подключены переносимыми относительными путями;
- runtime HTTP/HTTPS requests, внешние API, CDN, remote fonts/scripts, telemetry и analytics запрещены;
- не оптимизировать production под single-file и не inline'ить JS/CSS только ради уменьшения количества файлов;
- импортировать `.xlsx` Min-Max и `.xls/.xlsx` отчёт поставщиков в браузере;
- связывать отчёты только по коду 1С;
- расчёт статусов, MIN/MAX, поставщиков, цен, порогов и заказов реализовать строго по спецификации;
- дефицит с неразрешённым поставщиком нельзя терять: он должен оставаться в `unassigned` до решения пользователя;
- реальные файлы компании не добавлять в git;
- unit/integration tests должны создавать синтетические workbook fixtures программно;
- интерфейс на русском языке;
- итоговый workflow: `Импорт → Потребность → Поставщики → Заказы → CSV/XLSX`;
- не создавать корневой `ORDERS_AUTO.html`, не возвращать `vite-plugin-singlefile` и не inline'ить application bundle;
- production генерировать в `dist/ORDERS_AUTO/` командой `npm run build`;
- перед завершением выполнить `npm run verify` и `npm run test:e2e`.

Не останавливайся после scaffolding или отдельных экранов. Цель — законченный MVP по Definition of Done. Если реализация раскрывает неоднозначность, сначала проверь документацию: решение почти наверняка уже зафиксировано. Если требования действительно нет, не придумывай новое продуктовое поведение — зафиксируй конкретный blocker.

В конце дай краткий отчёт: реализованные задачи, результаты `npm run verify`, путь к production folder, entry `index.html`, production ZIP и оставшиеся blockers (если есть).

---
