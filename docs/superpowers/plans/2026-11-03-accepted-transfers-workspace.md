# Accepted transfers workspace implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline.

**Goal:** Stable compact rebalancing chrome and accepted-only route list with filters and CSV exports.

**Architecture:** Existing TransferDocument projection and shared VirtualTable/Dialog/Select/SearchInput. Read-only accepted view; optional persisted filters; shared single/bulk CSV serializer.

**Tech Stack:** React, TypeScript, CSS, Vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-11-03-accepted-transfers-workspace-design.md

## Global constraints

- Offline file://, no new dependencies or domain rule changes.
- Only committed accepted ledger in list and CSV, never proposals.
- Full directed-document export despite SKU query; monetary unknown remains unknown.
- Existing design tokens/shared component owners; Conditions natural height.
- New PR without merge/auto-merge.

## Review focus

- Search may find one SKU but CSV must contain the complete accepted route.
- Export selection can include hidden rows; scope must be explicit.
- Legacy workspace lacks acceptedFilters and must remain valid.
- Large lists must scroll/virtualize without moving header or clipping actions.
- Export failure must preserve decisions/selection and support retry.

### Task1: Accepted projection and shared CSV

Files: acceptedTransfersViewModel.ts; transferCsv.ts/download.ts; projection/export tests.

Interfaces: buildAcceptedDocuments(input), filterAcceptedDocuments(documents, filters), transfersToCsv(documents); existing transferToCsv unchanged.

- [x] RED: accepted-only projection; query preserves full document; one CSV header for multiple directions and no proposed/rejected lines.
- [x] Implement pure projection/filter and shared serializer; run focused tests.

### Task2: View, stable chrome and persistence

Files: AcceptedTransfersView.tsx; RebalancingPage.tsx; workspace.ts; styles/app.css; UI tests and UX docs.

Interfaces: view consumes complete accepted docs/filter state, emits filter changes and selected document IDs for CSV. Parent resolves fresh accepted docs when exporting.

- [x] RED: fourth tab, filter/selection/export/composition/empty/error states.
- [x] Reuse existing primitives and CSV download; share compact header styles across tabs.
- [x] Add E2E19 with stable geometry, bounded scrolling, CSV individual/bulk and reload.
- [x] Local typecheck/full tests401/build/strict audit; fresh review has no Critical/Important. Legacy restoration test added.
- [ ] Publish PR and verify full Chrome CI.
