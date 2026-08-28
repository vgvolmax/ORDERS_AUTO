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

interface SupplierHeader {
  rowIndex: number;
  columns: SupplierColumns;
  sharedHierarchyColumn: boolean;
  combinedNameAndUnit: boolean;
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

      if (header.sharedHierarchyColumn) {
        const sharedText = normalizeText(row[header.columns.name]);
        const skuCode = normalizeText(row[header.columns.code]);
        const marker = normalizeKey(sharedText);

        if (!skuCode) {
          if (
            sharedText &&
            marker !== 'поставщики' &&
            !marker.startsWith('итого') &&
            !marker.startsWith('всего')
          ) {
            currentSupplier = sharedText;
          }
          continue;
        }

        if (!currentSupplier || !sharedText) {
          continue;
        }

        const parsedName = header.combinedNameAndUnit
          ? splitCombinedNameAndUnit(sharedText)
          : { name: sharedText, unit: '' };

        // In the 1C hierarchical report folders have their own codes and
        // aggregate amounts, but no base unit after the final comma. Only
        // leaf nomenclature rows represent purchasable SKU history.
        if (header.combinedNameAndUnit && !parsedName.unit) {
          continue;
        }

        addHistoryRow({
          row,
          header,
          supplier: currentSupplier,
          skuCode,
          skuName: parsedName.name,
          unit: parsedName.unit,
          aggregated,
        });
        continue;
      }

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
      if (!supplier || !skuCode) {
        continue;
      }

      const unit =
        header.columns.unit >= 0 ? normalizeText(row[header.columns.unit]) : '';

      addHistoryRow({
        row,
        header,
        supplier,
        skuCode,
        skuName,
        unit,
        aggregated,
      });
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

function addHistoryRow({
  row,
  header,
  supplier,
  skuCode,
  skuName,
  unit,
  aggregated,
}: {
  row: unknown[];
  header: SupplierHeader;
  supplier: string;
  skuCode: string;
  skuName: string;
  unit: string;
  aggregated: Map<string, AggregatedHistory>;
}): void {
  const quantity =
    header.columns.qty >= 0
      ? parseOptionalNumber(row[header.columns.qty])
      : null;
  const amount =
    header.columns.amount >= 0
      ? parseOptionalNumber(row[header.columns.amount])
      : null;

  if (quantity == null && amount == null) {
    return;
  }

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

function findHeader(rows: unknown[][]): SupplierHeader | null {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const normalized = rows[rowIndex]!.map(normalizeKey);
    const columns = columnsFromRow(normalized);

    if (
      columns.supplier >= 0 &&
      columns.code >= 0 &&
      (columns.qty >= 0 || columns.amount >= 0)
    ) {
      return {
        rowIndex,
        columns,
        sharedHierarchyColumn: false,
        combinedNameAndUnit: false,
      };
    }

    // Standard 1C hierarchical purchase report renders a two-level header:
    //   Контрагент | Количество | Стоимость
    //   Код        | Номенклатура, Базовая единица измерения
    // Контрагент and Номенклатура intentionally share one body column.
    if (
      columns.supplier >= 0 &&
      columns.code < 0 &&
      (columns.qty >= 0 || columns.amount >= 0)
    ) {
      for (
        let detailRowIndex = rowIndex + 1;
        detailRowIndex <= Math.min(rowIndex + 3, rows.length - 1);
        detailRowIndex += 1
      ) {
        const detailNormalized = rows[detailRowIndex]!.map(normalizeKey);
        const detailColumns = columnsFromRow(detailNormalized);

        if (detailColumns.code < 0 || detailColumns.name < 0) {
          continue;
        }

        return {
          rowIndex: detailRowIndex,
          columns: {
            supplier: columns.supplier,
            code: detailColumns.code,
            name: detailColumns.name,
            qty: columns.qty,
            amount: columns.amount,
            unit: detailColumns.unit,
          },
          sharedHierarchyColumn: columns.supplier === detailColumns.name,
          combinedNameAndUnit: detailNormalized[detailColumns.name]!.includes(
            'базовая единица измерения',
          ),
        };
      }
    }
  }

  return null;
}

function columnsFromRow(normalized: string[]): SupplierColumns {
  const findAlias = (names: string[]) =>
    normalized.findIndex((cell) => names.some((name) => cell === name || cell.startsWith(name)));

  return {
    supplier: findAlias(aliases.supplier),
    code: findAlias(aliases.code),
    name: findAlias(aliases.name),
    qty: findAlias(aliases.qty),
    amount: findAlias(aliases.amount),
    unit: findAlias(aliases.unit),
  };
}

function splitCombinedNameAndUnit(value: string): { name: string; unit: string } {
  const separator = value.lastIndexOf(',');
  if (separator < 0) {
    return { name: value.trim(), unit: '' };
  }

  return {
    name: value.slice(0, separator).trim(),
    unit: value.slice(separator + 1).trim(),
  };
}

function fatal(message: string): ParseResult<SupplierDataset> {
  return {
    data: null,
    fatal: true,
    issues: [{ severity: 'ERROR', code: 'MISSING_REQUIRED_COLUMN', message }],
  };
}
