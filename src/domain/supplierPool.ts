/** Approved purchasing pool. Imported history remains intact for session recovery. */
export const SUPPLIER_POOL: readonly string[] = [
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
];

function supplierKey(supplier: string): string {
  // Ignore presentation, but retain the legal form and complete name: no fuzzy/prefix matches.
  return supplier.toLocaleLowerCase('ru-RU').replace(/[\s"'«»„“”‘’]/gu, '');
}

const approvedKeys = new Set(SUPPLIER_POOL.map(supplierKey));

export function isSupplierInPool(supplier: string): boolean {
  return approvedKeys.has(supplierKey(supplier));
}
