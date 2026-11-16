# Неактивные товары Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Явный read-only список отсутствующих в выбранном MIN/MAX товаров.

**Architecture:** Существующее вычисление присутствия по Коду 1С остаётся
сеансовой проекцией. SupplierWorkspace разделяет представления и фильтры,
SupplierProducts переиспользует виртуальную таблицу в read-only варианте.

**Tech Stack:** React, strict TypeScript, Vitest/RTL, Playwright Chrome, IndexedDB.

**Spec:** docs/superpowers/specs/2026-11-16-inactive-catalog-products-design.md

## Global Constraints
- Только код 1С; статус отсутствия не сохраняется в shared/IndexedDB.
- Вкладка неактивных только для просмотра, расчётные формулы не меняются.
- Русский интерфейс, существующие токены и UI primitives, file:// offline.
- Не сливать PR.

## Review Focus
- Нет MIN/MAX: неизвестное присутствие не становится массовой неактивностью.
- Legacy presence/hasDemand и скрытый bulk selection не ломают новые списки.
- Одинаковые артикулы с разными кодами и ведущими нулями не объединяются.
- Поиск/поставщик/роль не меняют счётчики и сохраняются между представлениями.
- Restore/reload/ошибка импорта сохраняют общий справочник и accepted.

### Task 1: Разделить представления с сохранением расчётной области

**Files:**
- Modify: src/features/suppliers/{SuppliersPage.tsx,SupplierProducts.tsx,SuppliersPage.css}
- Test: tests/ui/{independentCatalog,suppliersPage}.test.tsx
- Test: tests/persistence/independentCatalog.test.ts
- Test: tests/e2e/offline.spec.ts
- Modify: docs/product/SPEC.md, docs/ux/UX_AND_EXPORT.md,
  docs/testing/ACCEPTANCE_CRITERIA.md, DESIGN.md, UX-CONTRACT.md.

**Interfaces:** SupplierProducts получает mode: 'current' | 'inactive' и
hasMinMax: boolean; остальные прежние props сохраняются. Данные и durable
команды не меняются. SupplierWorkspace определяет count из catalog.products
и множества minMax.skus.code; selectedCodes ограничены текущим MIN/MAX.

- [ ] Написать RTL регрессии: активная область по умолчанию, неактивная
  read-only область с единицей/связями, независимые фильтры и точные счётчики,
  нулевые остатки/нормы/цена, нет отчёта, пустой список, legacy preferences.
- [ ] Запустить новые тесты, подтвердить ожидаемые FAIL без новых вкладок.
- [ ] Расширить прежний owner mode-вариантом; удалить противоречащий
  presence-select. Изолировать фильтры, ограничить восстановленный выбор.
- [ ] Адаптировать старый тест редактирования отсутствующего товара к новой
  read-only спецификации; сохранить покрытие связей и отсутствия расчётов.
- [ ] Проверить lifecycle через реальный workspaceSession и fake IndexedDB:
  исчезновение/возврат/restore, отсутствие в demand/orders/snapshot/proposal,
  сохранность связи и отсутствие нового persisted active-флага.
- [ ] Обновить E2E-28 на read-only список: назначить поставщика до исчезновения,
  проверить отдельную вкладку, reload, поиск/clear, возврат и старую неделю.
- [ ] Обновить точные доступные имена счётчиков в прежних RTL тестах;
  проверки не ослаблять. Уточнить текущую продуктовую/UX документацию.
- [ ] Запустить npm run typecheck, npm test -- --run, npm run build,
  ORDERS_AUTO_CHROME_PATH=/usr/bin/chromium npm run test:e2e,
  npm run build:appbox, strict UI audit; просмотреть снимки 1280/1024.
- [ ] Независимое ревью итогового diff; важные замечания закрыть регрессиями.
- [ ] Создать feature PR с результатами проверок; оставить без merge.
