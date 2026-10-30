import type { VirtualColumn } from './VirtualTable';

export interface ProductIdentity {
  code: string;
  article: string | null;
  name: string;
}
export function productColumns<T>(
  identity: (row: T) => ProductIdentity,
  overrides: Partial<
    Record<'code' | 'article' | 'name', Partial<VirtualColumn<T>>>
  > = {},
): VirtualColumn<T>[] {
  return [
    {
      key: 'code',
      header: 'Код',
      width: '140px',
      className: 'product-code',
      render: (row: T) => <strong>{identity(row).code}</strong>,
      ...overrides.code,
    },
    {
      key: 'article',
      header: 'Артикул',
      width: '120px',
      className: 'product-article',
      render: (row: T) => identity(row).article ?? '—',
      ...overrides.article,
    },
    {
      key: 'name',
      header: 'Наименование',
      width: 'minmax(220px, 1.5fr)',
      className: 'product-name',
      render: (row: T) => identity(row).name,
      ...overrides.name,
    },
  ];
}
