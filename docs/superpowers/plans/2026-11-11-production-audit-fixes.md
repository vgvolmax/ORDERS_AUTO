# Production audit fixes

Goal: close the four findings approved by the user on 11.11.2026, in one unmerged PR from main 56023c3.

Design: keep current domain, import, UI and export owners. No new dependencies, schema changes, network calls or calculation-rounding changes. The existing unit-price tolerance remains 0.01 RUB. Negative stock, blank norms and explicit zero MAX keep their existing business meaning.

Canonical owners: domain/demand + shared norm predicate for stock status; import/minMaxParser and domain/purchasingIssues for current/legacy diagnostics; domain/invoiceAmounts for monetary presentation; existing InvoiceResults/MetricCard/VirtualTable and comparison CSV for invoice evidence; existing ImportPage FileCard for import state; WorkspaceMasthead + global feedback-height token for layout.

1. Negative MIN/MAX: reproduce with parser and import-to-order tests; classify negative norms as INVALID_NORM, preserve data for inspection, exclude from purchasing, surface legacy snapshot diagnostics. Keep independent valid branches usable.
2. Invoice totals: derive actual order amount from summed order lines, never a rounded weighted price. Display order/invoice totals and signed difference, per-row amounts and delta, and include those in comparison CSV. Amount differences remain reachable through discrepancy filters even when unit-price tolerance passes. Do not change correction quantities, inclusion or price tolerance. Unknown amounts stay unknown; filters never alter global totals.
3. Import status: nonfatal row errors display “Прочитан с ошибками”, warnings display “Прочитан с предупреждениями”, clean imports display successful status. Loading takes priority, locked startup source also exposes its issues. Continuing with independent valid data remains allowed.
4. Feedback layout: reserve a stable 36px lane above the masthead. Compact masthead must retain save status and allow nine route rows at 1280×600/720. Add a real-browser geometry assertion that the toast does not intersect masthead content and that transient toast removal does not move content.

Verification: observe regressions RED before implementation where executable locally; npm run typecheck; npm test -- --run; npm run build; static UI audit; full Chrome file:// E2E and AppBox smoke in CI. Review the whole branch independently and inspect current CI screenshots. Push the feature branch, open PR, leave auto-merge off and do not merge.

Review focus: missing invoice amounts; mixed order prices; negative MAX or MIN with blank/zero MAX; warnings-only and locked import source states; compact routes and nested modal feedback.
