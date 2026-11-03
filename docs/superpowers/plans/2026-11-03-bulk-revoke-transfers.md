# Bulk revoke and movement indicator implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline.

**Goal:** Compact readable movement indicator and confirmed bulk revocation by route filters or SKU search.

**Architecture:** Reuse existing prepareAcceptedChange/revokeTransfers atomic command and AcceptTransfersDialog. Common TransferDrawer owns composition selection for accept/revoke; AcceptedTransfersView reuses that owner instead of duplicating a new cancellation dialog. Current quantities and accepted ledger remain the sole business source.

**Tech Stack:** React/TypeScript, existing UI/CSS, Vitest, Chrome file:// E2E.

## Global constraints

- New PR without merge/auto-merge; offline runtime and exact monetary rules unchanged.
- Revocation changes purchasing only after successful confirmed persistence.
- Route-list action means all accepted rows of selected directed documents, including selected directions hidden by filters; hidden count explicit.
- Composition action means selected accepted IDs in its current search; hidden rows are excluded and scope stated. Proposal selection remains separate.
- Stale proposals do not block revocation; busy operations do. Legacy accepted records remain cancellable.

## Review focus

- SKU search must not accidentally revoke unrelated accepted SKUs or proposal lines.
- Whole-route selection must map fresh accepted IDs, never sourceLineIds.
- Failed persistence leaves ledger, purchase demand and selection unchanged, retry works.
- Removing a final accepted document must not break nested modal isolation/focus.
- One-line indicator stays inside narrow numeric cells, full meaning remains accessible.

### Task1: Selection and revoke flow

Files: TransferDrawer, ResultsTable, AcceptedTransfersView, RebalancingPage, UI tests.

- [x] RED: accepted row checkboxes; select accepted by search; bulk accepted directions; confirmation/app persistence.
- [x] Implement optional bulk callbacks, separate temporary accepted selection, reuse shared drawer for accepted composition.
- [x] Preserve empty parent drawer until confirmation closes; show cancel counts and amount; no proposal acceptance side effects.

### Task2: Compact indicator and verification

Files: AcceptedMovementsPopover, app.css, E2E20 and normative UX/data docs.

- [x] Compact label/count on one line with full accessible name/tooltip and numeric alignment.
- [x] Added browser checks narrow-cell geometry, search cancellation, route cancellation, reload and final-record cancellation.
- [x] Local typecheck405 tests/build/strict audit pass; fresh review has no Critical/Important.
- [ ] Publish PR and verify full Chrome CI.


## Technical decision — REFACTOR-IN-PR

The existing readonly accepted composition dialog would duplicate selection/confirmation behavior. Replace it with the maintained TransferDrawer owner in this same bounded change; public bulk callbacks are optional for legacy consumers. No storage schema or domain contract changes. Verification includes original CSV/composition flows, nested final-document revoke, failed commit/retry and browser geometry. The monetary algorithm remains v5.
