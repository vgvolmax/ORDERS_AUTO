import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { StatusBadge } from '../../components/StatusBadge';
import { Alert, Button, Input, Select } from '../../components/ui';
import { VirtualTable, type VirtualColumn } from '../../components/VirtualTable';
import {
  historyDefaultQuantity, historyGroupNeedsReview, type HistoryDecision, type HistoryPositionGroup,
  type InvoiceHistoryOrder,
} from '../../domain/invoiceHistory';
import { validSupplierInn } from '../../domain/invoiceHistoryBackup';
import { fmtQty } from '../../format/numbers';

interface Entry {
  group: HistoryPositionGroup;
  line: HistoryPositionGroup['lines'][number];
}

export function CloseInvoiceHistoryDialog({ groups, previous, initialName, initialInn, confirmations, noDocuments, busy, onClose, onSave, onConfirm }: {
  groups: HistoryPositionGroup[];
  previous: readonly InvoiceHistoryOrder[];
  initialName: string;
  initialInn: string;
  confirmations: ReadonlyMap<string, { at: string }>;
  noDocuments: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (supplier: { name: string; inn: string }, decisions: ReadonlyMap<string, HistoryDecision>) => Promise<void>;
  onConfirm: (supplier: { name: string; inn: string }, keys: string[]) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [inn, setInn] = useState(initialInn);
  const [error, setError] = useState('');
  const [decisions, setDecisions] = useState(new Map<string, HistoryDecision>());
  const oldLines = new Map(previous.flatMap((order) => order.positions).map((line) => [line.key, line]));
  const rows = groups.filter(historyGroupNeedsReview).flatMap((group) => group.lines.map((line) => ({ group, line })));

  function getDecision({ group, line }: Entry): HistoryDecision {
    const defaults = historyDefaultQuantity(group, line.requested);
    const old = oldLines.get(line.key);
    return decisions.get(line.key) ?? {
      qty: defaults === null ? (old ? String(Math.min(old.invoiced, line.requested)) : '') : String(defaults),
      reason: confirmations.has(line.key) ? 'confirmed'
        : old?.reason === 'buyer' && (defaults ?? old.invoiced) === 0 ? 'buyer'
        : old?.reason === 'confirmed' || noDocuments ? 'confirmed' : 'closed',
    };
  }

  function update(entry: Entry, change: Partial<HistoryDecision>) {
    setDecisions((before) => new Map(before).set(entry.line.key, { ...getDecision(entry), ...change }));
  }

  const columns: VirtualColumn<Entry>[] = [
    { key: 'item', header: 'Артикул и заказ', width: 'minmax(150px, 1.1fr)', render: ({ group, line }) =>
      <div className="invoice-identity"><strong>{group.article || group.skuCode}</strong><small>{line.branch} · {group.name}</small></div> },
    { key: 'available', header: 'В счетах всего', width: '95px', className: 'num',
      render: ({ group }) => group.available === null ? 'Уточните' : fmtQty(group.available) },
    { key: 'requested', header: 'Заказано', width: '85px', className: 'num', render: ({ line }) => fmtQty(line.requested) },
    { key: 'allocated', header: 'Выставлено', width: '95px', render: (entry) =>
      historyDefaultQuantity(entry.group, entry.line.requested) === null
        ? <Input inputMode="decimal" aria-label={`Выставлено ${entry.group.article || entry.group.skuCode} · ${entry.line.branch}`}
            disabled={busy} value={getDecision(entry).qty} onChange={(event) => update(entry, { qty: event.target.value })} />
        : fmtQty(historyDefaultQuantity(entry.group, entry.line.requested) ?? 0) },
    { key: 'deficit', header: 'Дефицит сейчас', width: '124px', render: ({ line }) => line.stockStatus === 'unknown'
      ? 'Нет данных' : <StatusBadge status={line.stockStatus} /> },
    { key: 'reason', header: 'Основание', width: 'minmax(155px, 1fr)', render: (entry) =>
      <Select aria-label={`Основание ${entry.group.article || entry.group.skuCode} · ${entry.line.branch}`}
        disabled={busy} value={getDecision(entry).reason} onChange={(event) => update(entry, {
          reason: event.target.value as HistoryDecision['reason'],
        })}>
        <option value="closed" disabled={noDocuments}>Не выставлено</option>
        <option value="confirmed">Подтвердил поставщик</option>
        <option value="buyer">Сняли мы</option>
      </Select> },
  ];

  const newConfirmations = rows.filter((entry) =>
    decisions.get(entry.line.key)?.reason === 'confirmed' && !confirmations.has(entry.line.key)
    && oldLines.get(entry.line.key)?.reason !== 'confirmed');

  async function submit(onlyConfirmations = false) {
    setError('');
    if (!name.trim() || !validSupplierInn(inn.trim())) {
      setError('Укажите название контрагента и ИНН из 10 или 12 цифр.');
      return;
    }
    try {
      const party = { name: name.trim(), inn: inn.trim() };
      if (onlyConfirmations) await onConfirm(party, newConfirmations.map(({ line }) => line.key));
      else await onSave(party, new Map(rows.map((entry) => [entry.line.key, getDecision(entry)])));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось сохранить сверку.');
    }
  }

  return <Dialog title="Завершить сверку" size="wide" onClose={() => { if (!busy) onClose(); }} actions={<>
    <Button className="secondary" onClick={onClose} disabled={busy}>Отмена</Button>
    {!noDocuments && newConfirmations.length > 0 && <Button className="secondary" onClick={() => void submit(true)} disabled={busy}>
      Зафиксировать подтверждённые отказы
    </Button>}
    <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить итог'}</Button>
  </>}>
    <p>{noDocuments
      ? 'Зафиксируйте отказ поставщика по заказам, на которые он не выставит ни одного счёта.'
      : 'Убедитесь, что собраны все счета и их выставил один контрагент. При частичном покрытии распределите выставленное количество по заказам.'}</p>
    <div className="invoice-filters">
      <label>Контрагент в счёте<Input value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
      <label>ИНН поставщика<Input value={inn} inputMode="numeric" maxLength={12} disabled={busy}
        onChange={(event) => setInn(event.target.value)} /></label>
    </div>
    {rows.length > 0 && <VirtualTable rows={rows} columns={columns} getRowKey={({ line }) => line.key} maxHeight="min(42vh, 420px)" />}
    {!noDocuments && newConfirmations.length > 0 && <p>При ожидании других счетов можно зафиксировать подтверждённые отказы отдельно. В сводку попадёт итог завершённой сверки.</p>}
    {error && <Alert tone="danger">{error}</Alert>}
  </Dialog>;
}
