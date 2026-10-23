# Compact donor priority cards

Operator request23.10.2026, image(3).png: replace paged sparse matrix with a continuous compact SKU list; all divisions visible inside each card. User selected cards; the old narrower matrix still wastes empty cells, independent route cards lose the shared donor budget.

One SKU card contains code/name/status/unit/step, full donor budget and a responsive grid of mini-cards for every active branch except the donor, in registry order. Each mini-card has name, need, norms, priority and quantity; accepted quantities remain locked. Ineligible divisions stay visible and noninteractive. Seven divisions fit a row at1280px and wrap inside the same card on narrower screens. No horizontal scrolling or recipient/SKU page buttons.

All249SKU remain reachable in one vertical scroller, virtualized with measured heights and stable SKU keys. Header/footer stay visible. Search resets offset and uses shared clear; edits preserve offset. Wrapping/errors remeasure heights. Full names open shared Dialog. Existing mode, manual/priority, cap, saved state, accepted-only purchasing/CSV and read-only direction inspector stay unchanged. No new dependency/data migration/runtime network calls.

Canonical owners: QuantityInput/useDurableDraft for edits, Dialog/useModalLayer for overlays, new shared VirtualList for non-tabular measured cards, app.css tokens/scrollbars. Existing sibling Orders density/styles remain. New PR from8cdef46; no merge.

Verify real249SKU/7branches,1920/1280/1024/short viewports, bounded DOM, last-row edit through scroll/search/reload, failure/accepted-only scenarios.
