import type { OrderSettings } from '../domain/types';
import { db } from './db';

export const defaults: OrderSettings = {
  minimumOrderAmount: 0,
  thresholdMode: 'SUPPLIER_TOTAL',
};

export async function getSettings(): Promise<OrderSettings> {
  return (await db()).get('settings', 'main').then((value) => value ?? defaults);
}

export async function saveSettings(value: OrderSettings): Promise<string> {
  return (await db()).put('settings', value, 'main');
}
