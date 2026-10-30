import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePageScroll } from '../../src/app/usePageScroll';

afterEach(() => vi.restoreAllMocks());

it('owns scroll per page and workspace without rewinding ordinary updates', () => {
  let y = 312;
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation((options: number | ScrollToOptions) => {
    y = typeof options === 'object' ? options.top ?? 0 : 0;
  });
  function Harness() {
    const [page, setPage] = useState('all');
    const [workspace, setWorkspace] = useState('one');
    const [count, setCount] = useState(0);
    usePageScroll(page, workspace, true);
    return <>
      <button onClick={() => setPage('all')}>Все</button>
      <button onClick={() => setPage('orders')}>Заказы</button>
      <button onClick={() => setWorkspace('two')}>Новый сеанс</button>
      <button onClick={() => setCount(count + 1)}>Фильтр</button>
      <main><h1>{page}</h1></main>
    </>;
  }
  render(<Harness />);
  expect(y).toBe(0);
  act(() => { y = 420; fireEvent.scroll(window); });
  fireEvent.click(screen.getByText('Заказы'));
  expect(y).toBe(0);
  act(() => { y = 100; fireEvent.scroll(window); });
  fireEvent.click(screen.getByText('Фильтр'));
  expect(y).toBe(100);
  fireEvent.click(screen.getByText('Все'));
  expect(y).toBe(420);
  fireEvent.click(screen.getByText('Заказы'));
  expect(y).toBe(100);
  fireEvent.click(screen.getByText('Новый сеанс'));
  expect(y).toBe(0);
  expect(scroll).toHaveBeenCalledTimes(5);
});
