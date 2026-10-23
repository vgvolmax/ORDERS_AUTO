# Donor priority cards Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; one fresh whole-branch reviewer at end.

**Goal:** continuous compact SKU cards with every recipient visible and no page switches.
**Architecture:** drawer owns filters/modal/footer; VirtualList owns measured stable-key virtualization; DonorAllocationCard owns SKU/recipient display with unchanged commands.
**Tech Stack:** existing React/TypeScript/TanStack Virtual/Vitest/Chrome file://.
**Spec:** ../specs/2026-10-23-donor-priority-cards-design.md

## Global Constraints
Russian UI, same tokens and controls. Visual change only; only accepted affect purchasing/CSV. One vertical list scroller; no horizontal scrolling/page switches. No merge.

## Review Focus
249SKU with resize/last-row edit; seven recipients/long names; missing cells noninteractive; async errors/drafts survive measured height changes; footer/focus remain accessible at1024×768/1280×600.

### Task1: continuous cards
Files: components/VirtualList.tsx; rebalancing/DonorAllocationCard.tsx,DonorAllocationDrawer.tsx,RebalancingPage.tsx; scoped app.css; tests/ui/donorPriorityCards.test.tsx.
Interfaces: VirtualList<T>({items,getItemKey,renderItem,label,resetKey,emptyMessage}); card receives row,registry recipients,disabled/stale,onEdit,onProduct.
- [ ] RED:6SKU/7branches all listed, no page controls, unavailable cells, exact command, Dialog, search/clear/empty.
- [ ] Implement measured list (threshold100), adaptive card grid, existing inputs/drafts/commands.
- [ ] GREEN targeted/typecheck/fulltests/build; commit.

### Task2: browser verification and delivery
- [ ] Update E2E10 from page navigation to list/search, preserving all business assertions.
- [ ] Add249SKU/7division E2E with narrow/short/long names, bounded DOM,last-row edit/scroll/reload.
- [ ] Update DESIGN/UX/testing contracts, formatter/strict UX audit/fullverify/offline build.
- [ ] Fresh whole review, new draft PR, exact-head native CI/screenshots; mark ready after green. No merge.
