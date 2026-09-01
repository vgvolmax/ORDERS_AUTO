# ORDERS_AUTO

Локальное приложение для подготовки заказов поставщикам на основании двух отчётов 1С:

1. `Min-Max.xlsx` — остатки и нормативы MIN/MAX по подразделениям.
2. отчёт по поставщикам (`.xls` / `.xlsx`) — исторические поставщики, количество и стоимость закупок по коду номенклатуры.

## Как запускать приложение

```text
Скачать ORDERS_AUTO.zip
↓
распаковать
↓
открыть папку ORDERS_AUTO
↓
двойной клик по index.html
```

Пользовательская точка входа — **`ORDERS_AUTO/index.html`**. Она должна открываться напрямую через `file://` в актуальном Chrome или Edge. Для работы приложения не нужны web server, Node.js/npm, Python, установка зависимостей или интернет.

Не запускайте отдельные файлы из `assets/` и не вынимайте `index.html` из папки. Всю папку можно целиком копировать или переносить в другое место.

## Воспроизводимая production-сборка

Инструменты разработки используют зафиксированную для проекта версию Node.js и lockfile. Готовый переносимый пакет собирается из source одной командой:

```bash
npm ci
npm run build
```

Результат находится в `dist/ORDERS_AUTO/`; generated output не коммитится. `index.html` подключает classic IIFE bundle и CSS как внешние локальные файлы из `assets/`.

Production-пакет имеет следующий общий вид, но точная структура `assets/` не является контрактом:

```text
dist/ORDERS_AUTO/
├── index.html
├── assets/
│   ├── *.js
│   ├── *.css
│   └── другие локальные runtime-файлы
└── ...
```

## JTBD

> Из двух отчётов 1С за несколько минут получить проверяемый набор заказов вида **«подразделение → поставщик»**, отфильтровать экономически бессмысленные заказы и выгрузить готовые CSV/XLSX.

## Архитектура

- React + TypeScript + Vite.
- **ORDERS_AUTO — автономное локальное статическое приложение, поставляемое как папка/архив. Пользовательская точка входа — `index.html`, который должен запускаться напрямую через `file://` в актуальном Chrome/Edge без web server и доступа в интернет. Количество файлов внутри production-пакета не ограничено. Все runtime-ресурсы должны находиться внутри пакета и подключаться переносимыми относительными путями.**
- Runtime HTTP/HTTPS requests, внешние API, CDN, remote fonts/scripts, telemetry и analytics запрещены.
- Реальные отчёты обрабатываются только локально в браузере.
- IndexedDB хранит только пользовательские настройки и ручные соответствия `Код 1С → поставщик`; исходные отчёты в репозиторий не коммитятся.

## Документация

- [`AGENTS.md`](AGENTS.md) — обязательные правила для Codex/агентов.
- [`CODEX_PROMPT.md`](CODEX_PROMPT.md) — готовый стартовый промпт для Codex.
- [`docs/product/SPEC.md`](docs/product/SPEC.md) — продуктовая спецификация и бизнес-правила.
- [`docs/data/DATA_CONTRACTS.md`](docs/data/DATA_CONTRACTS.md) — форматы импорта, нормализация и базовые доменные типы.
- [`docs/data/DERIVED_PROJECTIONS.md`](docs/data/DERIVED_PROJECTIONS.md) — денежная потребность, unresolved demand и вычисляемые представления.
- [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) — техническая архитектура и границы модулей.
- [`docs/ux/UX_AND_EXPORT.md`](docs/ux/UX_AND_EXPORT.md) — экраны, фильтры, состояния и экспорт.
- [`docs/testing/ACCEPTANCE_CRITERIA.md`](docs/testing/ACCEPTANCE_CRITERIA.md) — критерии приёмки и контрольные кейсы.
- [`docs/superpowers/specs/2026-08-28-orders-auto-design.md`](docs/superpowers/specs/2026-08-28-orders-auto-design.md) — исторический design spec; прежняя packaging-часть superseded.
- [`docs/superpowers/plans/2026-08-28-orders-auto-implementation.md`](docs/superpowers/plans/2026-08-28-orders-auto-implementation.md) — исторический implementation plan; прежняя packaging-часть superseded.
- [`docs/superpowers/plans/2026-08-28-production-hardening.md`](docs/superpowers/plans/2026-08-28-production-hardening.md) — исторический hardening-план; прежняя packaging-часть superseded.

## Важное о тестовых данных

Репозиторий публичный. Реальные отчёты компании не должны попадать в git. Для локальной smoke-проверки положите файлы в `samples/private/`; эта папка игнорируется git. Unit/integration tests обязаны генерировать синтетические `.xlsx`/`.xls` fixtures программно.

## Definition of Done

Приложение считается готовым, когда `npm run verify` проходит полностью, production build создаёт переносимую папку `ORDERS_AUTO/`, CI публикует её как ZIP/artifact и offline production package check подтверждает прямой запуск `index.html` через `file://` без сетевых запросов. Сценарий `импорт → потребность → поставщики → заказы → CSV/XLSX` должен проходить на синтетических fixtures и на реальных локальных отчётах без ручного изменения исходных файлов.
