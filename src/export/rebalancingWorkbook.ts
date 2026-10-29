import { skippedReasonLabel } from '../features/rebalancing/skippedRebalance';
import ExcelJS from 'exceljs';
import type { PurchaseDemandLine } from '../domain/purchaseDemand';
import {
  acceptedEconomicDiagnostics,
  type AcceptedTransfer,
  type RebalanceConfig,
  type RebalanceIssue,
  type RebalanceProposal,
  type RebalanceSnapshot,
} from '../domain/rebalancing';
export interface RebalancingExportInput {
  snapshot: RebalanceSnapshot;
  config: RebalanceConfig;
  proposal: RebalanceProposal | null;
  accepted: AcceptedTransfer[];
  purchaseDemand: PurchaseDemandLine[];
  issues: RebalanceIssue[];
  workspaceId: string;
  exportedAt: string;
  rejectedLineIds?: string[];
  selectedLineIds?: string[];
}
export async function buildRebalancingWorkbook(
  input: RebalancingExportInput,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook(),
    { snapshot, proposal, accepted } = input;
  const branches = new Map(snapshot.branches.map((b) => [b.id, b.name])),
    skus = new Map(snapshot.skus.map((s) => [s.skuCode, s]));
  const sheet = (name: string, headers: string[]) => {
    const s = wb.addWorksheet(name);
    s.addRow(headers);
    s.getRow(1).font = { bold: true, color: { argb: 'FF17212B' } };
    s.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEDF3FF' },
    };
    s.views = [{ state: 'frozen', ySplit: 1 }];
    s.columns = headers.map((h) => ({ width: h.length > 20 ? 42 : 22 }));
    s.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: headers.length },
    };
    return s;
  };
  const headers = [
    'Код',
    'Отправитель',
    'Получатель',
    'Количество',
    'Ед.',
    'Цена MIN/MAX, ₽',
    'Сумма по цене MIN/MAX, ₽',
    'Решение',
  ];
  const acceptedSheet = sheet('Принятые', [
    ...headers,
    'ID перемещения',
    'Принято в',
    'Расчёт',
    'Сохранённые условия',
  ]);
  const proposedSheet = sheet('Предложения', [
    ...headers,
    'Строка расчёта',
    'Отмечено',
  ]);
  const movement = (t: {
    skuCode: string;
    fromBranchId: string;
    toBranchId: string;
    qty: number;
  }) => {
    const sku = skus.get(t.skuCode),
      price = sku?.referencePrice ?? null;
    return [
      t.skuCode,
      branches.get(t.fromBranchId) ?? t.fromBranchId,
      branches.get(t.toBranchId) ?? t.toBranchId,
      t.qty,
      sku?.unit ?? null,
      price,
      price === null ? null : price * t.qty,
    ];
  };
  for (const t of accepted)
    acceptedSheet.addRow([
      ...movement(t),
      'Принято — учтено в потребности',
      t.transferId,
      t.acceptedAt,
      t.sourceRunId,
      JSON.stringify(t.acceptedConfig),
    ]);
  for (const t of proposal?.transfers ?? []) {
    if (
      accepted.some(
        (a) =>
          a.sourceRunId === proposal!.runId &&
          a.sourceLineId === t.sourceLineId,
      )
    )
      continue;
    proposedSheet.addRow([
      ...movement(t),
      input.rejectedLineIds?.includes(t.sourceLineId)
        ? 'Отклонено — не учтено'
        : 'Предложено — не учтено',
      t.sourceLineId,
      input.selectedLineIds?.includes(t.sourceLineId)
        ? 'Да (не принято)'
        : 'Нет',
    ]);
  }
  for (const s of [acceptedSheet, proposedSheet]) {
    s.getColumn(4).numFmt = '#,##0.############';
    s.getColumn(6).numFmt = '#,##0.00';
    s.getColumn(7).numFmt = '#,##0.00';
  }
  const summary = sheet('Сводка', [
    'Код',
    'Подразделение',
    'Ед.',
    'Остаток по отчёту',
    'Принятый вход',
    'Принятый выход',
    'Прогноз остатка',
    'Нужно без перемещений',
    'Текущая закупка',
    'Цена закупки, ₽',
    'Текущая сумма, ₽',
  ]);
  for (const l of input.purchaseDemand)
    summary.addRow([
      l.skuCode,
      l.branch,
      skus.get(l.skuCode)?.unit ?? null,
      l.stock,
      l.acceptedIncomingQty,
      l.acceptedOutgoingQty,
      l.projectedStock,
      l.originalNeed,
      l.purchaseQty,
      l.unitPrice,
      l.purchaseAmount,
    ]);
  summary.getColumn(10).numFmt = '#,##0.00';
  summary.getColumn(11).numFmt = '#,##0.00';
  const issues = sheet('Исключения', [
    'Код проверки',
    'Уровень',
    'Код товара',
    'Подразделение',
    'Строка отчёта',
    'Сообщение',
  ]);
  const unique = new Map(
    [
      ...input.issues,
      ...(proposal?.exclusions.filter((i) => !i.code.startsWith('ACCEPTED_')) ??
        []),
      ...acceptedEconomicDiagnostics(snapshot, accepted),
    ].map((i) => [JSON.stringify(i), i]),
  );
  for (const i of unique.values())
    issues.addRow([
      i.code,
      i.severity,
      i.skuCode ?? null,
      i.branchId ? (branches.get(i.branchId) ?? i.branchId) : null,
      i.sourceRow,
      i.message,
    ]);
  const skippedSheet = sheet('Не распределено', [
    'Код',
    'Товар',
    'Ед.',
    'Вся потребность',
    'Можно доставить',
    'Не хватает',
    'Цена MIN/MAX, ₽',
    'Сумма всей потребности, ₽',
    'Причина',
  ]);
  const skippedRecipients = sheet('Получатели пропущенных', [
    'Код',
    'Подразделение',
    'Ед.',
    'Нужно',
    'Можно доставить',
    'Не хватает',
  ]);
  for (const skipped of proposal?.skippedSkus ?? []) {
    const sku = skus.get(skipped.skuCode),
      price = sku?.referencePrice ?? null;
    skippedSheet.addRow([
      skipped.skuCode,
      sku?.name ?? skipped.skuCode,
      sku?.unit ?? null,
      skipped.neededQty,
      skipped.deliverableQty,
      skipped.missingQty,
      price,
      price === null ? null : price * skipped.neededQty,
      skippedReasonLabel[skipped.reason],
    ]);
    for (const recipient of skipped.recipients)
      skippedRecipients.addRow([
        skipped.skuCode,
        branches.get(recipient.branchId) ?? recipient.branchId,
        sku?.unit ?? null,
        recipient.neededQty,
        recipient.deliverableQty,
        Math.max(0, recipient.neededQty - recipient.deliverableQty),
      ]);
  }
  skippedSheet.getColumn(7).numFmt = '#,##0.00';
  skippedSheet.getColumn(8).numFmt = '#,##0.00';
  const parameters = sheet('Параметры', ['Параметр', 'Значение']);
  parameters.addRows([
    ['Снимок', snapshot.snapshotId],
    ['Сеанс', input.workspaceId],
    ['Выгружено в', input.exportedAt],
    ['Расчёт', proposal?.runId ?? null],
    ['Версия алгоритма', proposal?.algorithmVersion ?? null],
    [
      'Правило распределения',
      'Только полное покрытие артикула по всей сети; ручные приоритеты отсутствуют',
    ],
    ['Участие подразделений', proposal?.participationFingerprint ?? null],
    ['Исходная ревизия принятых', proposal?.baseAcceptedRevision ?? null],
    ['Отпечаток входов', proposal?.inputFingerprint ?? null],
    ['Получатель', input.config.recipientTrigger],
    ['Цель получателя, %', input.config.receiverPct],
    ['Маршруты', input.config.routeConfig.mode],
    ['Условия текущие', JSON.stringify(input.config)],
    ['Условия предложения', proposal ? JSON.stringify(proposal.config) : null],
    [
      'Пояснение',
      'Только лист «Принятые» влияет на закупку. Предложения и галочки не учтены.',
    ],
    [
      'Деньги',
      'Неизвестные цены и суммы оставлены пустыми. Стоимость логистики не рассчитывается.',
    ],
    [
      'Ручные количества',
      'Сводка показывает расчётную потребность. Файлы поставщика учитывают ручные количества заказа.',
    ],
  ]);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
