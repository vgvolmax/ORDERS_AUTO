> **Исторический документ:** ручные приоритеты отменены пользователем29.10.2026. Текущая спецификация: `docs/superpowers/specs/2026-10-29-routes-full-coverage-design.md`.

# План реализации: три приоритета донора

Spec: `docs/superpowers/specs/2026-10-23-donor-priority-tiers-design.md` (утверждено).
Один функциональный PR, без merge/auto-merge. Выполнение inline с финальным независимым ревью.

## Global constraints

Только излишек выше Max. Accepted/manual резервируются первыми; explicit решения сохраняют порядок; автоматические предложения других доноров могут перераспределяться. Старые решения без recipientLevels остаются exclusive. Нет пересчёта при загрузке. Только принятое меняет заказы и CSV. Сохранение через существующую CAS очередь. Native Chrome file:// — GitHub Actions при недоступности локального Chrome.

## Task 1: domain tiers

TDD: sequential1→2→3→remaining; оба split-режима, дробный шаг, маршруты, пустые уровни, legacy, manual protection/overwrite, accepted identities, shared donor reservation. Add optional donor template and per-SKU executable levels; one atomic replan/revision. Preserve existing explicit decision order.

## Task 2: projection and commands

TDD: unique SKU Max coverage (unrounded residual), money via transferDocuments, accepted-source dedup, rejected excluded, other donors, unknown price, filters ignored. Add app levels command; real storage round-trip and stale/revision guards. Shared pure scoped ID resolver.

## Task 3: donor window

TDD: three priority cards, multi-select/move/remove, manual protection, cancel/retry/focus; coverage + scope + search/reset. Scoped acceptance waits durable saves and resolves latest committed IDs, aborts failed save without accepting old plan. Existing confirmation shows scope/money and purchasing effects; no filter/selection dependency. Compact layout, one virtual list and all receivers per SKU.

## Task 4: integration and verification

Excel records template, named groups, individual exceptions. Accepted-only CSV unchanged. Update product/data/derived/UX contracts. Full typecheck/Vitest/build/reproducible offline package. Native E2E with249SKU/8recipients, four viewports, priority groups, manual protection, filter, group/all acceptance, reload, orders popup and CSV. Strict premium audit and visual inspection. Fresh whole-branch review; fix Important/Critical with RED→GREEN. Open PR ready only after exact-head CI; never merge.

## Review Focus

1. Other donors and reservation order.
2. Blocked or missing group branches.
3. Fractional and rejected coverage.
4. Scoped pending/failure persistence queue.
5.249SKU, eight recipients and short viewport.

## Recovery checkpoint28.10.2026

Workspace maintenance removed unpublished local implementation from23.10.2026. Restored upstream design checkpoint9ff1d4b and repeated implementation/tests against it. Historical309-test result is not evidence for this restored branch. New evidence is recorded in the task ledger and PR CI.
