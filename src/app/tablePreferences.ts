import type { TableSort } from '../components/VirtualTable';
import { usePreference } from './usePreference';

export function useTablePreferences(key: string) {
  const [savedSort, onSortChange] = usePreference<TableSort | null>(
    `${key}:sort`,
    null,
  );
  const [savedHidden, onHiddenColumnsChange] = usePreference<string[]>(
    `${key}:hiddenColumns`,
    [],
  );
  const sort =
    savedSort &&
    typeof savedSort.key === 'string' &&
    ['asc', 'desc'].includes(savedSort.direction)
      ? savedSort
      : null;
  const hiddenColumns = Array.isArray(savedHidden)
    ? savedHidden.filter((key) => typeof key === 'string')
    : [];
  return { sort, onSortChange, hiddenColumns, onHiddenColumnsChange };
}
