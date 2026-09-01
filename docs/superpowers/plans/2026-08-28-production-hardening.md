# Production Hardening Implementation Plan

> **SUPERSEDED for production packaging by the 2026-09-01 deployment contract.** Требования ниже о standalone/single self-contained HTML и проверке единственного файла сохранены как история выполненного плана и больше не нормативны. Актуальный deployment contract: `docs/product/SPEC.md` и `docs/architecture/ARCHITECTURE.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ORDERS_AUTO safe and predictable for pilot/production handoff when launched as a standalone HTML file.

**Architecture:** Preserve the client-only single-file architecture. Harden the build/runtime boundary, keep business logic in pure domain helpers, keep UI failures visible to the user, and add automated browser coverage for the exact `file://` launch path.

**Tech Stack:** React 19, TypeScript, Vite 7, Vitest, Playwright/Chromium, SheetJS, ExcelJS, JSZip, IndexedDB.

**Spec:** `docs/testing/ACCEPTANCE_CRITERIA.md`, `docs/ux/UX_AND_EXPORT.md`

## Global Constraints

- No backend or runtime network dependency.
- Production remains a single self-contained `dist/index.html`.
- Real company reports must never be committed.
- Join suppliers only by 1C code.
- Missing price remains a blocker and never becomes zero.
- Existing threshold semantics stay unchanged.

---

### Task 1: Offline startup and visible failure recovery

**Files:**
- Modify: `index.html`
- Modify: `src/main.tsx`
- Create: `src/components/AppErrorBoundary.tsx`
- Create: `tests/e2e/offline.spec.ts`
- Modify: `.github/workflows/verify.yml`
- Modify: `package.json`, `package-lock.json`

- [ ] Add a failing browser smoke test that builds and opens `file://.../dist/index.html`, then asserts the import screen is visible and no page errors occur.
- [ ] Add a static startup fallback before React mounts and a React Error Boundary that replaces crashes with a readable recovery message.
- [ ] Add global `error`/`unhandledrejection` fallback handling for failures before or outside React.
- [ ] Run browser smoke and confirm it passes.

### Task 2: Order and export edge cases

**Files:**
- Modify: `src/domain/orders.ts`
- Modify: `src/features/orders/OrdersPage.tsx`
- Modify: `src/export/download.ts`
- Modify: `tests/domain/orders.test.ts`
- Modify/Create: export/UI tests as needed

- [ ] Add failing test: an order whose edited quantities are all zero is not READY/exportable.
- [ ] Implement an explicit empty-order blocker or omit it from exportable orders while preserving the demand model.
- [ ] Add failing tests for ZIP/XLSX export failure feedback.
- [ ] Catch export errors, clear busy state, and show a Russian actionable toast instead of an unhandled rejection.

### Task 3: Import concurrency and derived-state performance

**Files:**
- Modify: `src/app/appStore.ts`
- Modify: `src/features/import/ImportPage.tsx`
- Modify: `src/app/App.tsx` or add `src/app/useDerivedState.ts`
- Modify UI tests

- [ ] Add failing UI test for two overlapping imports so one completion cannot clear the other file's loading state.
- [ ] Replace the single import loading flag with independent MIN/MAX and supplier states.
- [ ] Memoize derived purchasing projections on the actual business inputs so local filter typing does not recompute the full dataset.
- [ ] Add a focused regression test around derived-state reuse where practical.

### Task 4: Export naming and local dates

**Files:**
- Create/Modify: `src/export/date.ts`
- Modify: `src/export/download.ts`
- Modify: `src/features/orders/OrdersPage.tsx`
- Modify: filename/export tests

- [ ] Add failing tests for local calendar date and dated CSV entries inside ZIP.
- [ ] Centralize `YYYY-MM-DD` formatting using local date parts, not UTC `toISOString()`.
- [ ] Ensure single CSV, ZIP member CSVs, ZIP filename, and supplier XLSX all use the same local-date helper.

### Task 5: SheetJS dependency hardening

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Verify: supplier/min-max parser tests for both `.xls` and `.xlsx`

- [ ] Move from vulnerable npm `xlsx@0.18.5` to the supported SheetJS CE 0.20.3 package source while keeping the app fully bundled offline at runtime.
- [ ] Re-run all parser tests, typecheck and production build.
- [ ] Run dependency audit and record any residual transitive findings in the PR body without applying blind fixes.

### Task 6: Final verification and PR

- [ ] Run `npm run verify`.
- [ ] Run the exact `file://` Chromium smoke test.
- [ ] Confirm `dist` contains only `index.html`, with no external JS/CSS/runtime network dependency.
- [ ] Confirm the CI artifact is named `ORDERS_AUTO-preview` and contains the built file, not the Vite source entrypoint.
- [ ] Open a PR to `main` with the test evidence and a requirement-by-requirement checklist.
