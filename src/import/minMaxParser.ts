import {
  normalizeKey,
  normalizeText,
  parseOptionalNumber,
  parseStockNumber,
} from '../domain/normalize';
import type {
  MinMaxDataset,
  ParseResult,
  ValidationIssue,
  ValidationIssueCode,
} from '../domain/types';
import { readFirstSheet } from './workbook';
import { hasNegativeStockNorm } from '../domain/stockNorms';

interface MinMaxColumns {
  code: number;
  article: number;
  name: number;
  stock: number;
  min: number;
  max: number;
  price: number;
}

interface IndexedRow {
  row: unknown[];
  rowNumber: number;
}

export const MIN_MAX_PARSER_VERSION = 3;

export function parseMinMaxWorkbook(
  input: ArrayBuffer,
  savedBranchNames: readonly string[] = [],
): ParseResult<MinMaxDataset> {
  try {
    const { rows, readCode, keepNumericErrors } = readFirstSheet(input);
    const header = findHeader(rows);
    if (!header) {
      return fatal(
        'MISSING_REQUIRED_COLUMN',
        'Не удалось найти обязательные колонки отчёта MIN/MAX.',
      );
    }

    keepNumericErrors(header.rowIndex + 1, [
      header.columns.stock,
      header.columns.min,
      header.columns.max,
    ]);
    const data: MinMaxDataset = { skus: [], branchStocks: [], branches: [] };
    const issues: ValidationIssue[] = [];
    const seenSkuBranch = new Set<string>();
    const seenSku = new Set<string>();
    const branchNameByKey = new Map<string, string>();
    function branchName(value: unknown): string {
      const name = normalizeText(value);
      const key = normalizeKey(name);
      const canonical = branchNameByKey.get(key);
      if (canonical !== undefined) return canonical;
      branchNameByKey.set(key, name);
      data.branches.push(name);
      return name;
    }
    // Resolve identities before reading blocks: a malformed row can precede
    // the only valid occurrence of its branch, or be known only by a saved alias.
    const knownBranches = new Set(savedBranchNames.map(normalizeKey));
    for (const row of rows.slice(header.rowIndex + 1))
      if (isBranchRow(row, header.columns))
        knownBranches.add(normalizeKey(row[header.columns.name]));

    for (let index = header.rowIndex + 1; index < rows.length; ) {
      const parentRow = rows[index]!;
      const code = readCode(index, header.columns.code);
      if (!code) {
        index += 1;
        continue;
      }

      let nextIndex = index + 1;
      const children: IndexedRow[] = [];
      while (
        nextIndex < rows.length &&
        !normalizeText(rows[nextIndex]![header.columns.code])
      ) {
        children.push({ row: rows[nextIndex]!, rowNumber: nextIndex + 1 });
        nextIndex += 1;
      }

      const branchRows = children.filter(({ row }) =>
        isBranchRow(row, header.columns),
      );
      const malformedRows = children.filter(
        ({ row }) =>
          isBranchIdentity(row, header.columns) &&
          !isBranchRow(row, header.columns) &&
          (knownBranches.has(normalizeKey(row[header.columns.name])) ||
            [header.columns.min, header.columns.max].some(
              (column) => normalizeText(row[column]) !== '',
            )),
      );

      // Coded category/group rows in the 1C report have no branch children.
      // They are intentionally ignored rather than becoming fake SKU records.
      if (branchRows.length > 0 || malformedRows.length > 0) {
        for (const child of malformedRows) {
          // Preserve recognized branches even when no physical stock could be read.
          const branch = branchName(child.row[header.columns.name]);
          issues.push({
            severity: 'ERROR',
            code: 'INVALID_BRANCH_VALUES',
            skuCode: code,
            branch,
            row: child.rowNumber,
            message: `Некорректные числовые данные остатка или MIN/MAX: ${code} / ${branch}`,
          });
        }

        const sku = {
          code,
          article:
            header.columns.article >= 0
              ? readCode(index, header.columns.article) || null
              : null,
          name: normalizeText(parentRow[header.columns.name]),
          reportedTotalStock: parseOptionalNumber(
            parentRow[header.columns.stock],
          ),
          referencePrice:
            header.columns.price >= 0
              ? parseOptionalNumber(parentRow[header.columns.price])
              : null,
        };
        if (seenSku.has(code)) {
          issues.push({
            severity: 'ERROR',
            code: 'DUPLICATE_SKU',
            skuCode: code,
            row: index + 1,
            message: `Повторный товарный блок с кодом ${code}. Исправьте дубли в отчёте MIN/MAX.`,
          });
        }
        seenSku.add(code);
        data.skus.push(sku);

        if (sku.referencePrice !== null && sku.referencePrice < 0) {
          issues.push({
            severity: 'WARNING',
            code: 'INVALID_REFERENCE_PRICE',
            skuCode: code,
            row: index + 1,
            message: `Некорректная цена MIN/MAX: ${code}. Цена должна быть неотрицательной.`,
          });
          sku.referencePrice = null;
        }

        if (sku.referencePrice == null) {
          issues.push({
            severity: 'WARNING',
            code: 'MISSING_REFERENCE_PRICE',
            message: `Нет цены в MIN/MAX: ${code} · ${sku.name}`,
            skuCode: code,
            row: index + 1,
          });
        }

        let branchTotal = 0;
        for (const { row, rowNumber } of branchRows) {
          const branch = branchName(row[header.columns.name]);
          const normalizedBranch = normalizeKey(branch);
          const uniqueKey = `${code}\0${normalizedBranch}`;
          const stock = parseStockNumber(row[header.columns.stock]);
          const min = parseOptionalNumber(row[header.columns.min]);
          const max = parseOptionalNumber(row[header.columns.max]);

          if (seenSkuBranch.has(uniqueKey)) {
            issues.push({
              severity: 'ERROR',
              code: 'DUPLICATE_SKU_BRANCH',
              message: `Дубликат строки подразделения: ${code} / ${branch}`,
              skuCode: code,
              branch,
              row: rowNumber,
            });
            continue;
          }
          seenSkuBranch.add(uniqueKey);

          if (hasNegativeStockNorm(min, max)) {
            issues.push({
              severity: 'ERROR',
              code: 'INVALID_NORM',
              message: `Отрицательный норматив MIN/MAX: ${code} / ${branch}. Укажите неотрицательные значения (MIN: ${min ?? 'не задан'}, MAX: ${max ?? 'не задан'}).`,
              skuCode: code,
              branch,
              row: rowNumber,
            });
          } else if (min != null && max != null && min > max) {
            issues.push({
              severity: 'WARNING',
              code: 'INVALID_NORM',
              message: `MIN больше MAX: ${code} / ${branch} (${min} > ${max})`,
              skuCode: code,
              branch,
              row: rowNumber,
            });
          }

          data.branchStocks.push({ skuCode: code, branch, stock, min, max });
          branchTotal += stock;
        }

        if (
          sku.reportedTotalStock != null &&
          Math.abs(sku.reportedTotalStock - branchTotal) > 0.01
        ) {
          issues.push({
            severity: 'WARNING',
            code: 'TOTAL_STOCK_MISMATCH',
            message: `Общий остаток не равен сумме подразделений: ${code}`,
            skuCode: code,
            row: index + 1,
          });
        }
      }

      index = nextIndex;
    }

    if (data.skus.length === 0) {
      return fatal('NO_SKU_BLOCKS', 'В отчёте не найдены товарные блоки.');
    }
    if (data.branches.length === 0) {
      return fatal('NO_BRANCHES', 'В отчёте не найдены подразделения.');
    }

    return { data, issues, fatal: false };
  } catch {
    return fatal(
      'MISSING_REQUIRED_COLUMN',
      'Не удалось прочитать файл MIN/MAX. Проверьте формат XLSX.',
    );
  }
}

function findHeader(
  rows: unknown[][],
): { rowIndex: number; columns: MinMaxColumns } | null {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const normalized = rows[rowIndex]!.map(normalizeKey);
    const exact = (name: string) =>
      normalized.findIndex((cell) => cell === name);
    const contains = (name: string) =>
      normalized.findIndex((cell) => cell.includes(name));

    const columns: MinMaxColumns = {
      code: exact('код'),
      article: exact('артикул'),
      name: exact('номенклатура'),
      stock: contains('количество'),
      min: exact('минимальный остаток'),
      max: exact('максимальный остаток'),
      price: exact('цена'),
    };

    if (
      columns.code >= 0 &&
      columns.name >= 0 &&
      columns.stock >= 0 &&
      columns.min >= 0 &&
      columns.max >= 0
    ) {
      return { rowIndex, columns };
    }
  }

  return null;
}

function isBranchIdentity(row: unknown[], columns: MinMaxColumns): boolean {
  if (normalizeText(row[columns.code])) {
    return false;
  }
  if (columns.article >= 0 && normalizeText(row[columns.article])) {
    return false;
  }
  if (!normalizeText(row[columns.name])) {
    return false;
  }

  return true;
}

function isBranchRow(row: unknown[], columns: MinMaxColumns): boolean {
  if (!isBranchIdentity(row, columns)) return false;
  return [columns.stock, columns.min, columns.max].every((column) => {
    const value = row[column];
    return parseOptionalNumber(value) !== null || normalizeText(value) === '';
  });
}

function fatal<T>(code: ValidationIssueCode, message: string): ParseResult<T> {
  return {
    data: null,
    fatal: true,
    issues: [{ severity: 'ERROR', code, message }],
  };
}
