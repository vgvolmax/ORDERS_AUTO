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
      width: '120px',
      className: 'product-code',
      sticky: true,
      hideable: false,
      render: (row: T) => <strong>{identity(row).code}</strong>,
      ...overrides.code,
    },
    {
      key: 'article',
      header: 'Артикул',
      width: '110px',
      className: 'product-article',
      sticky: true,
      hideable: false,
      render: (row: T) => identity(row).article ?? '—',
      ...overrides.article,
    },
    {
      key: 'name',
      header: 'Наименование',
      width: 'minmax(220px, 1.5fr)',
      className: 'product-name',
      sticky: true,
      hideable: false,
      render: (row: T) => identity(row).name,
      ...overrides.name,
    },
  ];
}
