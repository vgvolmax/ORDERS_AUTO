import {
  normalizeKey,
  normalizeText,
  parseOptionalNumber,
} from '../domain/normalize';
import type {
  ParseResult,
  SupplierDataset,
  SupplierHistory,
  ValidationIssue,
} from '../domain/types';
import { readFirstSheetRows } from './workbook';

const aliases = {
  supplier: ['контрагент', 'поставщик'],
  code: ['код', 'код номенклатуры'],
  name: ['номенклатура', 'товар'],
  qty: ['количество', 'кол-во'],
  amount: ['стоимость', 'сумма'],
  unit: ['ед. изм.', 'единица измерения', 'единица'],
};

interface SupplierColumns {
  supplier: number;
  code: number;
  name: number;
  qty: number;
  amount: number;
  unit: number;
}

interface AggregatedHistory extends SupplierHistory {
  normalizedUnits: Set<string>;
}

export function parseSupplierWorkbook(
  input: ArrayBuffer,
): ParseResult<SupplierDataset> {
  try {
    const rows = readFirstSheetRows(input);
    const header = findHeader(rows);
    if (!header) {
      return fatal(
        'Не удалось найти колонки поставщика, кода и количества/стоимости. Проверьте отчёт поставщиков из 1С.',
      );
    }

    const issues: ValidationIssue[] = [];
    const aggregated = new Map<string, AggregatedHistory>();
    let currentSupplier: string | null = null;

    for (let index = header.rowIndex + 1; index < rows.length; index += 1) {
      const row = rows[index]!;
      const supplierCell = normalizeText(row[header.columns.supplier]);
      const skuCode = normalizeText(row[header.columns.code]);
      const skuName =
        header.columns.name >= 0 ? normalizeText(row[header.columns.name]) : '';
      const totalMarker = normalizeKey(skuName || supplierCell);

      if (totalMarker.startsWith('итого') || totalMarker.startsWith('всего')) {
        continue;
      }

      if (supplierCell) {
        currentSupplier = supplierCell;
      }
      if (supplierCell && !skuCode) {
        continue;
      }

      const supplier = supplierCell || currentSupplier;
      const quantity =
        header.columns.qty >= 0
          ? parseOptionalNumber(row[header.columns.qty])
          : null;
      const amount =
        header.columns.amount >= 0
          ? parseOptionalNumber(row[header.columns.amount])
          : null;

      if (!supplier || !skuCode || (quantity == null && amount == null)) {
        continue;
      }

      const unit =
        header.columns.unit >= 0 ? normalizeText(row[header.columns.unit]) : '';
      const key = `${supplier}\0${skuCode}`;
      const item = aggregated.get(key) ?? {
        supplier,
        skuCode,
        skuName: skuName || null,
        unit: unit || null,
        purchaseQty: 0,
        purchaseAmount: 0,
        weightedUnitCost: null,
        normalizedUnits: new Set<string>(),
      };

      item.purchaseQty += quantity ?? 0;
      item.purchaseAmount += amount ?? 0;
      if (unit) {
        item.normalizedUnits.add(normalizeKey(unit));
        if (!item.unit) {
          item.unit = unit;
        }
      }
      aggregated.set(key, item);
    }

    const history = [...aggregated.values()].map((item): SupplierHistory => {
      if (item.normalizedUnits.size > 1) {
        issues.push({
          severity: 'WARNING',
          code: 'MIXED_UNITS',
          message: `Разные единицы измерения: ${item.supplier} / ${item.skuCode}`,
          skuCode: item.skuCode,
        });
        item.unit = null;
      }

      const weightedUnitCost =
        item.purchaseQty > 0 && item.purchaseAmount >= 0
          ? item.purchaseAmount / item.purchaseQty
          : null;

      return {
        supplier: item.supplier,
        skuCode: item.skuCode,
        skuName: item.skuName,
        unit: item.unit,
        purchaseQty: item.purchaseQty,
        purchaseAmount: item.purchaseAmount,
        weightedUnitCost,
      };
    });

    if (history.length === 0) {
      return {
        data: null,
        fatal: true,
        issues: [
          {
            severity: 'ERROR',
            code: 'NO_SUPPLIER_HISTORY',
            message: 'В отчёте не найдена история закупок.',
          },
        ],
      };
    }

    const suppliersBySku = new Map<string, Set<string>>();
    for (const item of history) {
      const suppliers = suppliersBySku.get(item.skuCode) ?? new Set<string>();
      suppliers.add(item.supplier);
      suppliersBySku.set(item.skuCode, suppliers);
    }
    for (const [skuCode, suppliers] of suppliersBySku) {
      if (suppliers.size > 1) {
        issues.push({
          severity: 'WARNING',
          code: 'MULTIPLE_SUPPLIERS',
          message: `У позиции ${skuCode} несколько исторических поставщиков: ${suppliers.size}`,
          skuCode,
        });
      }
    }

    return {
      data: {
        history,
        suppliers: [...new Set(history.map((item) => item.supplier))].sort((a, b) =>
          a.localeCompare(b, 'ru'),
        ),
      },
      issues,
      fatal: false,
    };
  } catch {
    return fatal('Не удалось прочитать отчёт поставщиков. Поддерживаются XLS и XLSX.');
  }
}

function findHeader(
  rows: unknown[][],
): { rowIndex: number; columns: SupplierColumns } | null {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const normalized = rows[rowIndex]!.map(normalizeKey);
    const findAlias = (names: string[]) =>
      normalized.findIndex((cell) => names.includes(cell));

    const columns: SupplierColumns = {
      supplier: findAlias(aliases.supplier),
      code: findAlias(aliases.code),
      name: findAlias(aliases.name),
      qty: findAlias(aliases.qty),
      amount: findAlias(aliases.amount),
      unit: findAlias(aliases.unit),
    };

    if (
      columns.supplier >= 0 &&
      columns.code >= 0 &&
      (columns.qty >= 0 || columns.amount >= 0)
    ) {
      return { rowIndex, columns };
    }
  }

  return null;
}

function fatal(message: string): ParseResult<SupplierDataset> {
  return {
    data: null,
    fatal: true,
    issues: [{ severity: 'ERROR', code: 'MISSING_REQUIRED_COLUMN', message }],
  };
}
