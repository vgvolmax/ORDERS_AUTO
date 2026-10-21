import { useState } from 'react';
import { useStore } from '../../app/appStore';
import { useDerivedState } from '../../app/useDerivedState';
import { Dialog } from '../../components/Dialog';
import { Button } from '../../components/ui';
import { VirtualTable } from '../../components/VirtualTable';
import { buildMovementSummary, type MovementScope, type MovementSummary } from '../../domain/rebalancing';
import { fmtQty } from '../demand/DemandPage';
export function AcceptedMovementsPopover({ summary, onOpenRebalancing, onClose }: { summary: MovementSummary; onOpenRebalancing: () => void; onClose: () => void }) {
  return <Dialog title="Учтённые перемещения" onClose={onClose} actions={<><Button className="secondary" onClick={onClose}>Закрыть</Button><Button onClick={onOpenRebalancing}>Открыть ребалансировку</Button></>}>
    <p>Потребность рассчитана с учётом только принятых перемещений: {summary.transferCount}.</p>
    {summary.totalsByUnit.map((t, i) => <div className="movement-totals" key={i}><strong>{t.unit ?? `Единица не указана · ${t.skuCode}`}</strong><dl><dt>Без перемещений</dt><dd>{fmtQty(t.originalNeed)}</dd><dt>Принятый вход</dt><dd>{fmtQty(t.incomingQty)}</dd><dt>Принятый выход</dt><dd>{fmtQty(t.outgoingQty)}</dd><dt>Текущая потребность</dt><dd><strong>{fmtQty(t.currentNeed)}</strong></dd></dl></div>)}
    {summary.manualOrderQty !== undefined && <p className="manual-indicator">Ручное количество к заказу: {fmtQty(summary.manualOrderQty)}. Указано оператором отдельно от рассчитанной потребности.</p>}
    <VirtualTable rows={summary.transfers} getRowKey={(t) => t.transferId} columns={[{ key: 'sku', header: 'Код', width: '110px', render: (t) => t.skuCode }, { key: 'route', header: 'Принятый маршрут', width: 'minmax(240px, 1fr)', render: (t) => `${t.fromName} → ${t.toName}` }, { key: 'qty', header: 'Количество', width: '130px', render: (t) => `${fmtQty(t.qty)} ${t.unit ?? 'ед. не указана'}` }]} />
    <details><summary>Остаток по отчёту → прогноз</summary>{summary.stocks.map((l) => <p key={`${l.skuCode}\0${l.branch}`}>{l.skuCode} · {l.branch}: {fmtQty(l.physical)} → {fmtQty(l.projected)}</p>)}</details>
  </Dialog>;
}
export function MovementIndicator({ scope, manualOrderQty }: { scope: MovementScope; manualOrderQty?: number | undefined }) {
  const { state, set } = useStore(), d = useDerivedState(state), [open, setOpen] = useState(false);
  if (!state.rebalance.accepted.length) return null;
  const summary = buildMovementSummary({ purchaseDemand: d.purchaseDemand, acceptedTransfers: state.rebalance.accepted, registry: state.rebalance.registry, policies: state.rebalance.policies, scope, manualOrderQty });
  if (!summary.transferCount) return null;
  return <><button className="link movement-indicator" aria-label={`Учтённые перемещения ${scope.skuCode ?? ''} ${scope.branch ?? ''}`.trim()} onClick={() => setOpen(true)}>С учётом перемещений ({summary.transferCount})</button>{open && <AcceptedMovementsPopover summary={summary} onClose={() => setOpen(false)} onOpenRebalancing={() => { setOpen(false); set((s) => ({ page: 'rebalancing', rebalance: { ...s.rebalance, tab: 'results', query: scope.skuCode ?? '' } })); }} />}</>;
}
