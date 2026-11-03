# Transfer SKU minimum implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One inclusive amount minimum per SKU×donor×recipient; remove the separate unit-price filter.

**Architecture:** Existing per-SKU full-coverage allocation followed by per-line economic filtering. Share exact SKU-route amounts between calculation, acceptance and diagnostics. Preserve other retained lines and frozen legacy conditions.

**Tech Stack:** TypeScript, React, Vitest, Playwright, offline Vite package.

**Spec:** docs/superpowers/specs/2026-11-03-transfer-sku-minimum-design.md

## Global constraints

- Offline file://; no backend/runtime network or new dependencies.
- Full SKU codes; donor≥MAX; receiver≤target; accepted only affects purchasing.
- Inclusive exact qty×referencePrice minimum; distinct SKU/routes/runs never combine.
- New PR, no merge or auto-merge.

## Review focus

- Saved legacy threshold retains enabled/value, frozen historical conditions remain readable.
- Other SKU, donors, recipients, reverse directions and runs never subsidize a small line.
- Removing one small line must preserve other eligible allocations even below recipient MAX.
- Removed unit-price filter must neither appear nor silently affect a restored session.
- Acceptance/revoke and export/need/balances use retained/accepted quantities atomically.

### Task1: Domain rule and compatibility

Files: src/domain/rebalancing/{types,constraints,calculate,acceptedTransfers,economics,transferAmounts}.ts; tests/domain/transferAmountFilter.test.ts and superseded rule tests.

Interfaces: calculateRebalance/acceptTransfers unchanged; getTransferAmountFilter(config) reads live new/legacy threshold; groupTransferSkuAmounts(snapshot,lines) groups exact products by SKU×from×to.

- [x] RED: several small SKU cannot combine;8k+2k different donors retain8k; another SKU cannot finance an invalid accepted line; legacy enabled unit-price rule ignored.
- [x] Inspect failing assertions, implement shared grouping/postfilter/explicit saved conditions.
- [x] Test decimal equality, purchase10→2 only after acceptance, revoke→10, legacy/no-op/stale and diagnostics.
- [x] Update tests only where requirements explicitly changed; full typecheck/Vitest green.
- [x] Independent domain review: missing-price early exit fixed with RED→GREEN regressions; full suite392/392.

### Task2: UI, exports and workflow

Files: ConditionsPanel.tsx, RebalancingPage.tsx, initialState.ts, rebalancingWorkbook.ts, UI/E2E tests and normative docs.

Interfaces: existing QuantityInput/Alert/VirtualTable, getTransferAmountFilter, issue SKU/from/to context.

- [x] RED: one checkbox/filter, no unit-price field, legacy live setting retained, save failure/retry.
- [x] Implement precise labels/explanation/acceptance errors and XLSX context.
- [x] Update E2E18:1357.20 and3000 excluded despite other donors/SKU;5089.50 and equality5000 retained; acceptance/reload/CSV.
- [x] Local typecheck/full Vitest392/build/strict audit passed.
- [ ] Chrome offline CI (local Chrome unavailable).
- [ ] Independent review, fix material findings and create PR without merge.
