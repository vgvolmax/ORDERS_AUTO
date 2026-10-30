import { productColumns } from '../../components/productColumns';
import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { VirtualTable } from '../../components/VirtualTable';
import { Alert, Button, EmptyState, SearchInput } from '../../components/ui';
import {
  ALGORITHM_VERSION,
  type RebalanceProposal,
  type BranchRegistry,
} from '../../domain/rebalancing';
import type { Sku } from '../../domain/types';
import type {
  SkuQuantityPolicy,
  SkippedRebalanceSku,
} from '../../domain/rebalancing';
import { fmtQty, money } from '../demand/DemandPage';
import { skippedReasonLabel } from './skippedRebalance';

export function SkippedRebalanceList({
  proposal,
  skus,
  registry,
  policies,
  stale,
  onBack,
}: {
  proposal: RebalanceProposal | null;
  skus: Sku[];
  registry: BranchRegistry;
  policies: SkuQuantityPolicy[];
  stale: boolean;
  onBack: () => void;
}) {
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<SkippedRebalanceSku | null>(null);
  const skuMap = new Map(skus.map((s) => [s.code, s]));
  const names = new Map(registry.map((b) => [b.id, b.name]));
  const units = new Map(policies.map((p) => [p.skuCode, p.unit]));
  const normalized = query.trim().toLocaleLowerCase('ru');
  const rows = (proposal?.skippedSkus ?? []).filter((r) =>
    [
      r.skuCode,
      skuMap.get(r.skuCode)?.article ?? '',
      skuMap.get(r.skuCode)?.name ?? '',
    ]
      .join(' ')
      .toLocaleLowerCase('ru')
      .includes(normalized),
  );
  const current =
    proposal?.algorithmVersion === ALGORITHM_VERSION &&
    proposal.skippedSkus !== undefined;
  return (
    <section
      className="skipped-rebalance"
      aria-label="Нераспределённые артикулы"
    >
      <div className="section-heading">
        <h2>
          Не распределено ·{' '}
          {current ? (proposal?.skippedSkus?.length ?? 0) : '—'} SKU
        </h2>
        <Button className="secondary" onClick={onBack}>
          К перемещениям
        </Button>
      </div>
      <p>
        Весь артикул пропущен: потребность не закрывается полностью. «Можно
        доставить» — проверка возможностей, эти количества не предложены к
        принятию.
      </p>
      {!proposal ? (
        <EmptyState>Сначала рассчитайте перемещения.</EmptyState>
      ) : !current ? (
        <Alert tone="warning">
          Сохранённый расчёт использовал прежние правила. Выполните новый
          расчёт, чтобы увидеть нераспределённые артикулы.
        </Alert>
      ) : (
        <>
          {stale && (
            <Alert tone="warning">
              Показан прежний расчёт. Для новых настроек пересчитайте
              перемещения.
            </Alert>
          )}
          <div className="filters">
            <label className="filter-search">
              Поиск нераспределённого товара
              <SearchInput
                aria-label="Поиск нераспределённого товара"
                value={query}
                onValueChange={setQuery}
              />
            </label>
            <span>
              {rows.length} из {proposal.skippedSkus!.length} SKU
            </span>
          </div>
          <VirtualTable
            rows={rows}
            getRowKey={(r) => r.skuCode}
            emptyMessage={
              normalized
                ? 'Ничего не найдено. Измените или очистите поиск.'
                : 'Все выбранные потребности обеспечены либо исключены условиями расчёта. Проверьте список исключений.'
            }
            columns={[
              ...productColumns<(typeof rows)[number]>((r) => ({
                code: r.skuCode,
                article: skuMap.get(r.skuCode)?.article ?? null,
                name: skuMap.get(r.skuCode)?.name ?? r.skuCode,
              })),
              {
                key: 'need',
                header: 'Нужно · можно доставить · не хватает',
                width: 'minmax(170px, 1fr)',
                render: (r) => (
                  <div className="skip-cell">
                    <strong>Нужно: {fmtQty(r.neededQty)}</strong>
                    <span>Можно доставить: {fmtQty(r.deliverableQty)}</span>
                    <span>Не хватает: {fmtQty(r.missingQty)}</span>
                  </div>
                ),
              },
              {
                key: 'reason',
                header: 'Причина · сумма всей потребности',
                width: 'minmax(230px, 1.3fr)',
                render: (r) => {
                  const price = skuMap.get(r.skuCode)?.referencePrice;
                  return (
                    <div className="skip-cell">
                      <span>{skippedReasonLabel[r.reason]}</span>
                      <strong>
                        {price == null ||
                        price < 0 ||
                        !Number.isFinite(price * r.neededQty)
                          ? 'Сумма неизвестна'
                          : money(price * r.neededQty)}
                      </strong>
                      <button className="link" onClick={() => setOpened(r)}>
                        Потребность подразделений · {r.recipients.length}
                      </button>
                    </div>
                  );
                },
              },
            ]}
          />
        </>
      )}
      {opened && (
        <Dialog
          title={`Не распределено · ${skuMap.get(opened.skuCode)?.article ?? opened.skuCode}`}
          onClose={() => setOpened(null)}
          actions={
            <Button className="secondary" onClick={() => setOpened(null)}>
              Закрыть
            </Button>
          }
        >
          <p>
            {skippedReasonLabel[opened.reason]}. Артикул не включён в новый план
            перемещений.
          </p>
          <VirtualTable
            rows={opened.recipients}
            getRowKey={(r) => r.branchId}
            columns={[
              {
                key: 'branch',
                header: 'Получатель',
                width: 'minmax(170px, 1fr)',
                render: (r) => names.get(r.branchId) ?? r.branchId,
              },
              {
                key: 'need',
                header: 'Нужно',
                width: '100px',
                render: (r) => fmtQty(r.neededQty),
              },
              {
                key: 'possible',
                header: 'Можно доставить',
                width: '140px',
                render: (r) => fmtQty(r.deliverableQty),
              },
              {
                key: 'missing',
                header: 'Не хватает',
                width: '100px',
                render: (r) =>
                  fmtQty(Math.max(0, r.neededQty - r.deliverableQty)),
              },
            ]}
          />
        </Dialog>
      )}
    </section>
  );
}
