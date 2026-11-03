# Calculation integrity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Исправить пять подтверждённых дефектов аудита закупочных расчётов.

**Architecture:** Pure import/domain corrections, shared purchasing diagnostics, exact decimal money helpers. Existing CAS state, offline runtime and export contracts remain authoritative.

**Tech Stack:** TypeScript, React, Vitest, SheetJS, ExcelJS, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-calculation-integrity-design.md`

## Global constraints

- Join only by Код1С; no new runtime dependencies/backend/HTTP.
- Only accepted transfers alter procurement; no merge into main.
- Known numeric zero differs from unknown; supplier returns remain supported.
- Legacy workspace schema stays version1; derive validates old normalized inputs.

## Review focus

- Incomplete amount mixed with complete rows must not dilute average price.
- Duplicate parent/branch errors survive reload and supplier/accepted changes.
- An omitted malformed branch remains visible without blocking unrelated orders.
- Negative fallback cannot reduce a positive mixed order or bypass export guards.
- Decimal boundaries work in both threshold modes, with edited quantities and sub-cent prices.

## Task1: Protect import and pricing integrity

Files: `src/import/{supplierParser,minMaxParser}.ts`, `src/domain/{types,demand}.ts`, `tests/domain/calculationIntegrity.test.ts`.

- [x] Write integration tests using real workbooks: blank/bad amount => valid fallback; partially missing amount => not50; zero and returns unchanged; duplicate parent => diagnostic/no last-price fallback; negative price => null/BLOCKED.
- [x] Run tests and inspect expected failures.
- [x] Track incomplete history, diagnose duplicate parents, validate all price sources.
- [x] Run targeted tests/typecheck, commit this logical change.

## Task2: Preserve purchasing data errors through orders and UI

Files: `src/domain/{purchasingIssues,orders,rebalanceWorkflow}.ts`, `src/app/selectors.ts`, `src/components/PurchasingDataAlert.tsx`, existing Demand/Suppliers/Orders pages; `tests/{domain,ui}`.

Interfaces: `collectPurchasingIssues(dataset,sourceIssues):ValidationIssue[]`; optional `OrderProjection.dataIssues`; optional fifth `buildOrderProjection(...,dataIssues)` argument.

- [x] Test duplicate branch blocks affected order, malformed branch remains a projection issue, independent order stays READY, old normalized duplicates remain blocked, workflow patch preserves blockers.
- [x] Test same persistent issue panel on each purchasing screen and export eligibility of affected vs independent orders.
- [x] Observe RED; implement indexed issue matching and shared Alert using existing primitives.
- [x] Observe GREEN; commit.

## Task3: Exact monetary totals and thresholds

Files: `src/domain/money.ts`, `orders/demand/purchaseDemand`, existing export and summary owners; integrity tests and export roundtrips.

Interfaces: pure `moneyProduct(qty,price)`, `moneySum(values)`, `moneyProductsLessThan(products,threshold)`; exact comparison occurs before converting decimal accumulator to Number.

- [x] Test 10.1+20.2 at30.3 in both modes, below/above boundaries, edited fractional quantity, explicit zero, sub-cent weighted price, exported model parity.
- [x] Observe RED; implement shared decimal helpers, route relevant sums/products through them, keep all existing exports compatible.
- [x] Observe GREEN; commit.

## Task4: Full verification and delivery

- [ ] Run typecheck, all Vitest tests, production build, byte reproducibility and Chrome file:// E2E; report unavailable checks accurately.
- [x] Review changed code against the five audit examples and current contracts. Update docs with final behavior/compatibility.
- [ ] Push branch, open reviewable PR without merge/auto-merge; check CI results and fix new failures.


Execution note: Tasks1–3 implemented together because the real workbook integration tests span import, diagnostics, prices and thresholds. Local typecheck, 369 tests/73 files, offline build and strict UI audit (0 findings) pass. Chrome is unavailable locally (installation blocked by environment). Automatic permission review rejected git push because publishing code was not explicitly authorized; remote branch/PR/CI remain pending user permission. No merge.

Read-only review found no Critical/Important regressions. Additional fractional need case (Max0.3−stock0.1 at threshold0.2) exposed a pre-existing binary subtraction gap within this correction scope; a RED regression was added and calculateStockStatus now uses the shared exact subtraction helper. Final full verification follows this change.

Final local verification after fractional subtraction correction: typecheck, 370/370 tests in73files and offline build pass. Review: no Critical/Important findings; Chrome E2E cannot launch because Chrome is not installed. Remote publication remains blocked awaiting explicit user authorization; neither push nor PR creation was completed.
