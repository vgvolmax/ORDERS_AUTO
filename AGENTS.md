# AGENTS.md — ORDERS_AUTO

Эти правила обязательны для любого агента, который пишет код в репозитории.

## 1. Не менять бизнес-логику самовольно

Перед разработкой прочитать в указанном порядке:

1. `docs/product/SPEC.md`
2. `docs/data/DATA_CONTRACTS.md`
3. `docs/data/DERIVED_PROJECTIONS.md`
4. `docs/architecture/ARCHITECTURE.md`
5. `docs/ux/UX_AND_EXPORT.md`
6. `docs/testing/ACCEPTANCE_CRITERIA.md`
7. `DESIGN.md`
8. `docs/superpowers/specs/2026-09-03-rebalancing-module-design.md`
9. `docs/superpowers/specs/2026-09-03-rebalancing-integration-clarifications.md`
10. `docs/superpowers/plans/2026-09-03-rebalancing-module-implementation.md`
11. `docs/superpowers/plans/2026-09-03-rebalancing-integration-amendment.md`
12. `docs/superpowers/plans/2026-08-28-orders-auto-implementation.md`

Если документы противоречат друг другу, приоритет: `SPEC.md` → `DATA_CONTRACTS.md` + `DERIVED_PROJECTIONS.md` → `UX_AND_EXPORT.md` → `ARCHITECTURE.md` → design/spec → implementation plan. Для Rebalancing уточнение `2026-09-03-rebalancing-integration-clarifications.md` имеет приоритет над конфликтующей формулировкой базового Rebalancing design spec только в явно перечисленных в нём интеграционных вопросах; `2026-09-03-rebalancing-integration-amendment.md` аналогично переопределяет конфликтующие шаги базового Rebalancing implementation plan.

## 2. Неподвижные архитектурные ограничения

- Никакого backend/FastAPI/Express/SQLite.
- Production artifact — автономная локальная папка `ORDERS_AUTO/`; пользовательская точка входа — `ORDERS_AUTO/index.html`.
- `index.html` должен запускаться напрямую через `file://` в актуальном Chrome/Edge без локального web server и доступа в интернет.
- Количество локальных production-файлов не ограничено. Все runtime assets должны находиться внутри production-папки и подключаться переносимыми относительными путями.
- Никаких runtime API/HTTP/HTTPS-запросов, telemetry, analytics или внешних CDN.
- На пользовательском ПК не должны требоваться Node.js/npm/Python или установка runtime-зависимостей.
- Source code остаётся модульным; запрещено превращать исходники в один гигантский `index.html`.
- TypeScript `strict: true`.
- Бизнес-расчёты — чистые функции, не React-компоненты.
- Join двух отчётов выполняется только по `Коду 1С`, никогда по артикулу или названию.
- Реальные отчёты не коммитить.
- Не создавать и не коммитить корневой `ORDERS_AUTO.html`.
- Не возвращать `vite-plugin-singlefile` и не встраивать application bundle в `index.html`.
- Production генерируется только в `dist/ORDERS_AUTO/` и состоит из `index.html` и локальных assets.

## 3. TDD и качество

Для каждого доменного правила сначала тест, затем минимальная реализация. Обязательные команды перед каждым законченным этапом:

```bash
npm run typecheck
npm test -- --run
npm run build
```

Финально:

```bash
npm run typecheck
npm test -- --run
npm run build
npm run test:e2e
```

Нельзя исправлять падающий тест ослаблением assertion, если не изменилось требование из спецификации.

## 4. UI

- Интерфейс русский.
- Desktop-first, рабочая ширина от 1280 px.
- Цвет — дополнительный сигнал, не единственный: каждый статус имеет текстовый label.
- Денежные значения форматируются как RUB, количества без лишних десятичных знаков, но доменная модель допускает дробные единицы.
- Таблицы с большим количеством строк виртуализируются.

## 5. Git

- Делать небольшие логические commits по задачам implementation plan.
- Не коммитить `dist/`, `node_modules/`, реальные Excel-файлы и пользовательские данные.
- Не переписывать документацию только потому, что реализация удобнее иначе. Если обнаружена реальная неоднозначность — зафиксировать её отдельным вопросом/issue, не угадывать.
