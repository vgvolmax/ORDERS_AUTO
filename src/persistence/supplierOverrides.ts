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

export async function saveSupplierOverrides(
  values: SupplierOverride[],
): Promise<void> {
  if (values.length === 0) {
    return;
  }

  const database = await db();
  const transaction = database.transaction('supplierOverrides', 'readwrite');
  for (const value of values) {
    await transaction.store.put(value);
  }
  await transaction.done;
}
