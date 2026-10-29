import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoutesMatrix } from '../../src/features/rebalancing/RoutesMatrix';
import type {
  BranchRegistry,
  RouteConfig,
} from '../../src/domain/rebalancing/types';

const branches: BranchRegistry = [
  { id: 'a', name: 'Склад А', active: true, aliases: [] },
  { id: 'b', name: 'Склад Б', active: true, aliases: [] },
  { id: 'c', name: 'Склад В', active: false, aliases: [] },
];
function Example({
  registry: initial = branches,
  config = { mode: 'SELECTIVE', pairs: [] } as RouteConfig,
}) {
  const [registry, setRegistry] = useState(initial);
  const [value, setValue] = useState(config);
  return (
    <RoutesMatrix
      registry={registry}
      value={value}
      onChange={setValue}
      onRegistryChange={setRegistry}
    />
  );
}
const cell = (from = 'Склад А', to = 'Склад Б') =>
  screen.getByRole('button', { name: new RegExp(`^Маршрут ${from} → ${to}:`) });

describe('route matrix', () => {
  it('edits four explicit directions atomically, mirrors arrows and restores focus on Escape', () => {
    render(<Example />);
    const trigger = cell();
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('radio')).toHaveLength(4);
    fireEvent.click(
      within(dialog).getByRole('radio', { name: 'Склад А → Склад Б' }),
    );
    expect(trigger).toHaveTextContent('×');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(trigger).toHaveTextContent('×');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('radio', { name: 'Склад А → Склад Б' }));
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    expect(cell()).toHaveTextContent('→');
    expect(cell('Склад Б', 'Склад А')).toHaveTextContent('←');
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getAllByLabelText('Внутри подразделения')).toHaveLength(3);
  });

  it('keeps inactive branches visible and synchronizes participation on both axes without losing directions', () => {
    render(
      <Example
        config={{
          mode: 'SELECTIVE',
          pairs: [{ branchAId: 'a', branchBId: 'c', direction: 'BOTH' }],
        }}
      />,
    );
    expect(cell('Склад А', 'Склад В')).toBeDisabled();
    const checks = screen.getAllByRole('checkbox', { name: 'Участие Склад В' });
    expect(checks).toHaveLength(2);
    expect(checks[0]).not.toBeChecked();
    fireEvent.click(checks[1]!);
    expect(checks[0]).toBeChecked();
    expect(checks[1]).toBeChecked();
    expect(cell('Склад А', 'Склад В')).toBeEnabled();
    expect(cell('Склад А', 'Склад В')).toHaveTextContent('↔');
    fireEvent.click(
      screen.getAllByRole('checkbox', { name: 'Участие Склад А' })[0]!,
    );
    expect(cell()).toBeDisabled();
    expect(
      screen.getByRole('button', {
        name: 'Настроить направления Склад А, строка',
      }),
    ).toBeDisabled();
  });

  it.each(['строка', 'столбец'])(
    'configures only receives relative to selected branch from %s including off-page counterparts',
    (axis) => {
      const registry = Array.from({ length: 12 }, (_, i) => ({
        id: String(i),
        name: `Филиал ${i + 1}`,
        active: true,
        aliases: [],
      }));
      render(<Example registry={registry} />);
      fireEvent.click(
        screen.getByRole('button', {
          name: `Настроить направления Филиал 1, ${axis}`,
        }),
      );
      expect(
        screen.getByText(
          'Будет изменено пар: 11. Все активные подразделения, включая другие страницы.',
        ),
      ).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole('radio', {
          name: 'Только получает: остальные → Филиал 1',
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
      expect(cell('Филиал 1', 'Филиал 2')).toHaveTextContent('←');
      fireEvent.click(
        screen.getByRole('button', { name: 'Следующие столбцы' }),
      );
      expect(cell('Филиал 1', 'Филиал 12')).toHaveTextContent('←');
    },
  );

  it('preserves explicit exceptions while switching the default for unconfigured pairs', () => {
    render(
      <Example
        registry={branches.map((b) => ({ ...b, active: true }))}
        config={{
          mode: 'SELECTIVE',
          pairs: [{ branchAId: 'a', branchBId: 'b', direction: 'BLOCKED' }],
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Режим маршрутов'), {
      target: { value: 'ALL_ALLOWED' },
    });
    expect(cell()).toHaveTextContent('×');
    expect(cell('Склад А', 'Склад В')).toHaveTextContent('↔');
  });

  it('keeps all nine branches on both axes when the available desktop region fits them', () => {
    const geometry = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return {
          width: 946,
          height: this.classList.contains('routes-tools') ? 58 : 52,
          top: 200,
          bottom: 252,
          left: 0,
          right: 946,
          x: 0,
          y: 200,
          toJSON: () => ({}),
        };
      });
    const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    try {
      render(
        <Example
          registry={Array.from({ length: 9 }, (_, i) => ({
            id: String(i),
            name: `Филиал ${i + 1}`,
            active: true,
            aliases: [],
          }))}
        />,
      );
      expect(screen.getAllByRole('checkbox')).toHaveLength(18);
      expect(screen.getAllByRole('button', { name: /^Маршрут / })).toHaveLength(
        72,
      );
      expect(
        screen.queryByRole('navigation', { name: 'Страницы матрицы' }),
      ).not.toBeInTheDocument();
    } finally {
      geometry.mockRestore();
      height.mockRestore();
    }
  });

  it('recomputes axis pages when a parent warning reduces the available height', () => {
    let top = 200;
    const callbacks = new Map<Element, ResizeObserverCallback[]>();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(target: Element) {
          callbacks.set(target, [
            ...(callbacks.get(target) ?? []),
            this.callback,
          ]);
        }
        disconnect() {}
      },
    );
    const geometry = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return {
          width: 946,
          height: this.classList.contains('routes-tools') ? 58 : 52,
          top,
          bottom: top + 52,
          left: 0,
          right: 946,
          x: 0,
          y: top,
          toJSON: () => ({}),
        };
      });
    const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    try {
      const { container } = render(
        <main>
          <Example
            registry={Array.from({ length: 9 }, (_, i) => ({
              id: String(i),
              name: `Филиал ${i + 1}`,
              active: true,
              aliases: [],
            }))}
          />
        </main>,
      );
      expect(
        screen.queryByRole('navigation', { name: 'Страницы матрицы' }),
      ).not.toBeInTheDocument();
      top = 300;
      act(() =>
        callbacks
          .get(container.querySelector('main')!)
          ?.forEach((callback) => callback([], {} as ResizeObserver)),
      );
      expect(
        screen.getByRole('button', { name: 'Следующие строки' }),
      ).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Следующие строки' }));
      expect(
        screen.getByRole('button', {
          name: 'Настроить направления Филиал 8, строка',
        }),
      ).toBeInTheDocument();
    } finally {
      geometry.mockRestore();
      height.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
