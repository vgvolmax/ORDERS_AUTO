/** Starter roster used before the supplier editor was introduced. */
const PREVIOUS_STARTER_POOL = [
  'АО ТД "ЭЛЕКТРОТЕХМОНТАЖ"',
  'ИП Баранов Роман Борисович',
  'ИП Бобров Э.Р.',
  'Ип Жовтый Сергей Юрьевич',
  'ИП Никишин Андрей Николаевич',
  'Ип Рязанцева Надежда Леонидовна',
  'ООО "Авангард Система"',
  'ООО "Акварио Рус"',
  'ООО "Алмаз"',
  'ООО "Вера Саша и Олег"',
  'ООО "ВЕРДЕ"',
  'ООО "ВЕРСУС ГРУПП"',
  'ООО "ДЕНСАН"',
  'ООО "Ева"',
  'ООО "ИНЖЕНЕРНЫЙ ЦЕНТР "АПРЕЛЬ"',
  'ООО "Мир инструмента"',
  'ООО "Р-КЛИМАТ"',
  'ООО "РЕСУРС ФОРВАРДИНГ"',
  'ООО "САНСФЕРА-РУС"',
  'ООО "САНТЕХГРУПП"',
  'ООО "Сантехкомплект"',
  'ООО "СТД-ПРО"',
  'ООО "ТЕПЛОТЕХНИКАСЕРВИС"',
  'ООО "Теплотренд"',
  'ООО "Терем"',
  'ООО "Термаснаб"',
  'ООО "Торговый Дом Импульс"',
  'ООО "ФАХМАНН РУССЛАНД"',
  'ООО "ЭмВиАй"',
  'ООО "ЮЗТК"',
  'ООО "Ютара"',
  'ООО ТД "БИОСЕПТИК"',
] as const;

const sablineService = 'ООО "САБЛАЙН СЕРВИС"';
export const SUPPLIER_POOL: readonly string[] = [...PREVIOUS_STARTER_POOL, sablineService];

export function supplierKey(supplier: string): string {
  // Ignore presentation, but retain the legal form and complete name: no fuzzy/prefix matches.
  return supplier.toLocaleLowerCase('ru-RU').replace(/[\s"'«»„“”‘’]/gu, '');
}

const approvedNames = new Map(
  SUPPLIER_POOL.map((supplier) => [supplierKey(supplier), supplier]),
);

export function canonicalSupplierName(supplier: string, pool: readonly string[] = SUPPLIER_POOL): string | undefined {
  const key = supplierKey(supplier);
  return pool === SUPPLIER_POOL ? approvedNames.get(key) : pool.find((name) => supplierKey(name) === key);
}

export function isSupplierInPool(supplier: string, pool: readonly string[] = SUPPLIER_POOL): boolean {
  return canonicalSupplierName(supplier, pool) !== undefined;
}

const previousStarterKeys = PREVIOUS_STARTER_POOL.map(supplierKey);
const sablineServiceKey = supplierKey(sablineService);

/** Upgrade the previous starter roster, including catalogs with additional suppliers. */
export function upgradeStarterSupplierPool(suppliers: string[]): string[] {
  const keys = new Set(suppliers.map(supplierKey));
  if (keys.has(sablineServiceKey) || !previousStarterKeys.every((key) => keys.has(key))) return suppliers;
  return [...suppliers, sablineService];
}
