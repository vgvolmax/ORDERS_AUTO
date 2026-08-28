# Готовый промпт для Codex

Скопируй текст ниже в Codex без дополнительных пояснений.

---

Работай в репозитории `vgvolmax/ORDERS_AUTO`.

Нужно реализовать приложение полностью по уже подготовленной спецификации. Продуктовую логику не придумывай и не меняй.

Перед первым изменением кода обязательно прочитай:

1. `AGENTS.md`
2. `docs/product/SPEC.md`
3. `docs/data/DATA_CONTRACTS.md`
4. `docs/architecture/ARCHITECTURE.md`
5. `docs/ux/UX_AND_EXPORT.md`
6. `docs/testing/ACCEPTANCE_CRITERIA.md`
7. `docs/superpowers/specs/2026-08-28-orders-auto-design.md`
8. `docs/superpowers/plans/2026-08-28-orders-auto-implementation.md`

После этого исполняй implementation plan последовательно, task-by-task, с TDD и небольшими commits.

Критические ограничения:

- приложение полностью client-side, backend запрещён;
- production build должен быть одним самодостаточным `dist/index.html`, открывающимся локально через `file://` в Chrome/Edge;
- импортировать `.xlsx` Min-Max и `.xls/.xlsx` отчёт поставщиков в браузере;
- связывать отчёты только по коду 1С;
- расчёт статусов, MIN/MAX, поставщиков, цен, порогов и заказов реализовать строго по `SPEC.md`;
- реальные файлы компании не добавлять в git;
- unit/integration tests должны создавать синтетические workbook fixtures программно;
- интерфейс на русском языке;
- итоговый workflow: `Импорт → Потребность → Поставщики → Заказы → CSV/XLSX`;
- перед завершением выполнить `npm run verify` и проверить single-file build.

Не останавливайся после scaffolding или отдельных экранов. Цель — законченный MVP по Definition of Done. Если реализация раскрывает неоднозначность, сначала проверь документацию: решение почти наверняка уже зафиксировано. Если требования действительно нет, не придумывай новое продуктовое поведение — зафиксируй конкретный blocker.

В конце дай краткий отчёт: реализованные задачи, результаты `npm run verify`, путь к production HTML и оставшиеся blockers (если есть).

---
