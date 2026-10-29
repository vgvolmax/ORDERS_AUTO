> **Исторический документ:** ручные приоритеты отменены пользователем29.10.2026. Текущая спецификация: `docs/superpowers/specs/2026-10-29-routes-full-coverage-design.md`.

# Donor priorities Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; one independent whole-branch code review after implementation.

**Goal:** Operator chooses recipients per donor/SKU, splits proportionally or equally, then edits quantities without breaching donor/recipient limits.
**Architecture:** Pure allocationPlan extends the existing proposal with optional allocation decisions/revision/modes; existing workspace queue saves one consistent plan. Existing solver/decimal/ledger primitives validate every change. UI reuses modal, VirtualTable and QuantityInput.
**Tech Stack:** React/TypeScript, existing offline IndexedDB, Vitest/Chrome file://. No new dependencies.
**Spec:** ../specs/2026-10-23-donor-priorities-design.md

## Global Constraints

Only accepted quantities affect purchase/CSV. Donor outgoing<=stock−Max and recipient incoming<=configured target<=Max globally. Steps, routes, original run eligibility and monetary filters remain valid. Frozen accepted rows cannot be edited. Old workspaces without optional metadata load. No merge.

## Review Focus

- Competing donors must reallocate automatic suggestions without changing any accepted/manual reservation.
- More than one needy recipient and shortage requires an explicit per-SKU choice before accepting; one recipient does not.
- Proportional/equal distribution respects caps, exact steps and deterministic remainder; mode changes preserve manual quantities.
- Failed/stale saves never publish a partial decision/quantity; confirmation binds current workspace revision.
- Original read-only direction inspector, CSV, workbook balances and purchasing remain consistent after edits/reload/revoke.

### Task1: pure distribution, model and commands

Files: domain/rebalancing/allocationPlan.ts, allocationSplit.ts, types.ts/index.ts; tests/domain/donorAllocation.test.ts.
Interfaces: AllocationContext={snapshot,proposal,accepted}; buildDonorAllocationModel(ctx), setDonorPriorities(ctx,skuCode,fromBranchId,recipientIds), setDonorQuantity(ctx,skuCode,fromBranchId,toBranchId,qty), setDonorSplitMode(ctx,fromBranchId,mode), assertDonorPrioritiesReady(ctx,sourceIds). Each command returns a new complete RebalanceProposal. Modes PROPORTIONAL/EQUAL; decision modes PRIORITY/MANUAL. Quantity commands freeze other quantities of that donor/SKU; priority checkbox commands clear that group's manual values and reallocate explicitly selected cells.
- [ ] RED: tests one recipient/all up to target; two8/4 capacity6→4/2 or3/3; cap redistribution; step fractions/remainders; unused surplus; global competing donors/manual protection; invalid budget/route/step/target; source immutability; unresolved guard; frozen accepted.
- [ ] Implement split arithmetic and model. Decisions reserve manual quantities, then priority groups in saved order, then reuse allocateFlow for unchosen donors of only the affected SKU. Rebuild balances/uncovered need without accepted duplication.
- [ ] GREEN: targeted tests. Add readiness guard to acceptTransfers; existing acceptance/flow tests stay green.

### Task2: app/persistence contracts

Files: app/rebalanceActions.ts, features/rebalancing/RebalancingPage.tsx, domain/workspace.ts; tests/ui/donorPriorities.test.tsx and persistence coverage.
- [ ] Add serialized plan-edit command adapter. Await persistence before publishing, validate run/config and stale revision, preserve accepted state. Optional proposal fields travel through existing storage; tab gains priorities.
- [ ] Warn before a fresh calculation discards edited plan. Prevent obsolete confirmations from accepting different quantities. Workbook uses edited plan quantities/balances and records split/decision metadata.
- [ ] Test actual queue, failure/retry, raw legacy workspace/reload and edited-quantity acceptance affecting demand/CSV; no purchase change from priority/manual edits alone.

### Task3: donor overview and matrix

Files: features/rebalancing/DonorPriorities.tsx, DonorAllocationDrawer.tsx, related CSS; ResultsTable/TransferDrawer; shared viewport page-size primitive if required.
- [ ] Donor cards and sender-card entry; text status/amounts; search and shortage filter.
- [ ] Matrix SKU rows/recipient columns with row/column pagination, stock/Max/budget/final balances, need/other incoming, independent priority flag and QuantityInput, manual/priority status, visible validation/pending/error. Common mode setting in same donor window; manual rows stay fixed on mode change.
- [ ] Existing selection-to-accept is distinct. Unresolved routes cannot be selected/accepted; shortcut opens donor priorities. Header/actions always reachable, name disclosure uses Dialog, focus restores.

### Task4: docs and verification

- [ ] Update product/data/UX/DESIGN authoritative contracts around editable proposal and split settings. Run typecheck, full tests, build, strict UI audit, formatter and offline E2E.
- [ ] Extend native E2E to shortage→donor matrix→mode switch→flags→manual valid/invalid→accept→order/CSV→reload plus narrow layouts. Preserve existing six scenarios.
- [ ] Inspect final screenshots, independent code review, address confirmed findings. Publish concrete draft PR then mark ready after exact-head native CI. Do not merge.
