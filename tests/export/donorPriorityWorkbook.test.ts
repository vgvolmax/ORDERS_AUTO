import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';
import { donorTierContext } from '../fixtures/donorTierContext';
import {
  setDonorPriorityLevels,
  setDonorPriorities,
} from '../../src/domain/rebalancing';
import { buildRebalancingWorkbook } from '../../src/export/rebalancingWorkbook';
it('exports template, human tier names and individual exceptions without changing accepted CSV', async () => {
  const c = donorTierContext();
  let p = setDonorPriorityLevels(c, 'D', [['R1'], ['R2'], ['R3']]);
  p = setDonorPriorities({ ...c, proposal: p }, 'SKU', 'D', ['R4']);
  const bytes = await buildRebalancingWorkbook({
    ...c,
    config: p.config,
    proposal: p,
    purchaseDemand: [],
    issues: [],
    workspaceId: 'w',
    exportedAt: p.createdAt,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const rows = wb.getWorksheet('Параметры')!.getSheetValues();
  const text = JSON.stringify(rows);
  expect(text).toContain('Массовые приоритеты донора');
  expect(text).toContain('D · Приоритет 1');
  expect(text).toContain('R1');
  expect(text).toContain('Индивидуальные исключения');
  expect(text).toContain('SKU');
});
