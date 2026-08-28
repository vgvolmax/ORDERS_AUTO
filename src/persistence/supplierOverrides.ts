import type { SupplierOverride } from '../domain/types';
import { db } from './db';

export async function getSupplierOverrides(): Promise<SupplierOverride[]> {
  return (await db()).getAll('supplierOverrides');
}

export async function saveSupplierOverride(
  value: SupplierOverride,
): Promise<string> {
  return (await db()).put('supplierOverrides', value);
}
