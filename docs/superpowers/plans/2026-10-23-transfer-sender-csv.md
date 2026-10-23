# Transfer sender summary and CSV Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans; implement inline and review the whole branch before completion.

**Goal:** Понятные суммы отправителя, состав без прокруток и CSV принятых перемещений.
**Architecture:** Existing transferDocuments owns money; VirtualTable and modal primitives remain shared. A transfer CSV adapter reuses the order CSV encoder/download. Pagination bounds the drawer only.
**Tech Stack:** React/TypeScript, existing CSS, Vitest and Chrome file://.
**Spec:** ../specs/2026-10-23-transfer-sender-csv-design.md

## Global Constraints

No backend, remote assets, dependencies or schema changes. Quantity read-only; only accepted ledger changes purchase. CSV exports accepted rows from the entire route. No merge.

## Review Focus

- Multiple recipients / filtered rows: sender totals and selected money remain global.
- Unknown/zero prices, rejected and accepted dedup: no invented money.
- Search/page/resize: retained selection, clamped page, all actions reachable.
- CSV after partial acceptance and filters: complete accepted route only, exact codes/decimal quantities/escaping.
- Download failure and acceptance pending: retry without ledger/purchase changes.

## Tasks

- [ ] Add failing export tests in tests/export/transferCsv.test.ts and UI regression tests in tests/ui/transferInspector.test.tsx. Run targeted tests and confirm missing behavior.
- [ ] Extract shared rowsToCsv in src/export/csv.ts; create transferCsv.ts and extend download.ts. Preserve existing order output bytes.
- [ ] Add sender and selected route money to ResultsTable; resolve full route for CSV through RebalancingPage.
- [ ] Add bounded page-size hook and responsive TransferDrawer layout, identity disclosure, pagination and CSV control. Update the inspector tests for page semantics.
- [ ] Extend Chrome E2E09 for no scroll, all pages, selection, money, CSV contents and narrow/short layouts. Preserve existing offline/accepted-order checks.
- [ ] Update DESIGN/UX contract, run typecheck/full tests/build/strict UI audit and exact-head native CI; inspect screenshots and request review. Open a new unmerged PR.
