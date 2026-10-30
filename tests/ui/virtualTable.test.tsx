import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { VirtualTable, type TableSort, type VirtualColumn } from '../../src/components/VirtualTable';

const rows = [{ code: '00001', name: 'Один', qty: 20 }, { code: '00002', name: 'Два', qty: null }, { code: '00003', name: 'Три', qty: 5 }];
const columns: VirtualColumn<(typeof rows)[number]>[] = [
  { key: 'code', header: 'Код', width: '120px', sticky: true, hideable: false, render: r => r.code },
  { key: 'name', header: 'Наименование', width: 'minmax(200px,1fr)', sticky: true, hideable: false, render: r => r.name },
  { key: 'qty', header: 'Количество', width: '100px', sortValue: r => r.qty, render: r => r.qty ?? 'Нет данных' },
];
it('keeps the named scroll surface outside the table and exposes logical row metadata', () => {
  render(<VirtualTable rows={rows} columns={columns} getRowKey={r => r.code} />);
  const table = screen.getByRole('table');
  const scroll = screen.getByLabelText('Прокрутка таблицы');
  expect(scroll).toContainElement(table);
  expect(table).toHaveAttribute('aria-rowcount', '4');
  expect(table).toHaveAttribute('aria-colcount', '3');
  const dataRows = within(table).getAllByRole('row');
  expect(dataRows.map(r => r.getAttribute('aria-rowindex'))).toEqual(['1','2','3','4']);
  const name = within(dataRows[1]!).getAllByRole('cell')[1]!;
  expect(name).toHaveClass('is-frozen');
  expect(name).toHaveStyle({ left: '120px' });
});

it('sorts numbers both ways with unknown values last and preserves selection while hiding other columns', () => {
  function Harness() {
    const [sort, changeSort] = useState<TableSort | null>(null);
    const [hidden, changeHidden] = useState<string[]>([]);
    const [selected, changeSelected] = useState<string[]>([]);
    return <VirtualTable rows={rows} columns={[
      ...columns,
      { key: 'check', header: 'Выбор', width: '80px', hideable: false, render: r => <input type="checkbox" aria-label={`Выбрать ${r.code}`} checked={selected.includes(r.code)} onChange={() => changeSelected([r.code])} /> },
    ]} getRowKey={r => r.code} sort={sort} onSortChange={changeSort} hiddenColumns={hidden} onHiddenColumnsChange={changeHidden} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать 00001' }));
  const codes = () => screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[0]!.textContent);
  fireEvent.click(screen.getByRole('button', { name: 'Сортировать: Количество' }));
  expect(codes()).toEqual(['00003','00001','00002']);
  expect(screen.getByRole('columnheader', { name: /Количество/ })).toHaveAttribute('aria-sort','ascending');
  fireEvent.click(screen.getByRole('button', { name: 'Сортировать: Количество' }));
  expect(codes()).toEqual(['00001','00003','00002']);
  fireEvent.click(screen.getByText('Столбцы'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Показать столбец Количество' }));
  expect(screen.queryByRole('columnheader', { name: /Количество/ })).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Выбрать 00001' })).toBeChecked();
  expect(screen.queryByRole('checkbox', { name: 'Показать столбец Код' })).not.toBeInTheDocument();
});
