import { useState } from 'react';
import { VirtualTable, type VirtualColumn } from '../../components/VirtualTable';
import { Input, Select } from '../../components/ui';
import type { BranchRegistry, RebalanceBranch, RouteConfig, RouteDirection } from '../../domain/rebalancing';
const reverse = (d: RouteDirection): RouteDirection => d === 'A_TO_B' ? 'B_TO_A' : d === 'B_TO_A' ? 'A_TO_B' : d;
export function RoutesMatrix({ registry, value, onChange }: { registry: BranchRegistry; value: RouteConfig; onChange: (c: RouteConfig) => void }) {
  const [query, setQuery] = useState('');
  const branches = registry.filter((b) => b.active), rows = branches.filter((b) => b.name.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));
  const direction = (a: string, b: string): RouteDirection => {
    if (value.mode === 'ALL_ALLOWED') return 'BOTH';
    const pair = value.pairs.find((p) => p.branchAId === a && p.branchBId === b || p.branchAId === b && p.branchBId === a);
    return pair ? pair.branchAId === a ? pair.direction : reverse(pair.direction) : 'BLOCKED';
  };
  const columns: VirtualColumn<RebalanceBranch>[] = [{ key: 'branch', header: 'Из / в', width: '180px', className: 'route-identity', render: (b) => <strong>{b.name}</strong> }, ...branches.map((to) => ({ key: to.id, header: to.name, width: '160px', render: (from: RebalanceBranch) => from.id === to.id ? <span aria-label="Внутри подразделения">—</span> : <Select aria-label={`Маршрут ${from.name} → ${to.name}`} disabled={value.mode === 'ALL_ALLOWED'} value={direction(from.id, to.id)} onChange={(e) => onChange({ mode: 'SELECTIVE', pairs: [...value.pairs.filter((p) => !(p.branchAId === from.id && p.branchBId === to.id || p.branchAId === to.id && p.branchBId === from.id)), { branchAId: from.id, branchBId: to.id, direction: e.target.value as RouteDirection }] })}><option value="BOTH">↔ В обе стороны</option><option value="A_TO_B">→ Только туда</option><option value="B_TO_A">← Только обратно</option><option value="BLOCKED">× Запрещён</option></Select> }))];
  return <section><div className="filters"><label>Режим маршрутов<Select value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as RouteConfig['mode'] })}><option value="ALL_ALLOWED">Все пары разрешены в обе стороны</option><option value="SELECTIVE">Настроить направления</option></Select></label><label>Поиск подразделения<Input value={query} onChange={(e) => setQuery(e.target.value)} /></label>{query && <button className="link" onClick={() => setQuery('')}>Сбросить поиск</button>}</div><p>Строка — отправитель, столбец — получатель. Изменение пары сразу отражается с обеих сторон. В выборочном режиме ненастроенные пары запрещены.</p><div className="route-matrix" style={{ '--matrix-width': `${180 + branches.length * 160}px` } as React.CSSProperties}><VirtualTable rows={rows} columns={columns} getRowKey={(b) => b.id} /></div>{value.pairs.some((p) => !branches.some((b) => b.id === p.branchAId) || !branches.some((b) => b.id === p.branchBId)) && <p className="warning-text">Сохранены маршруты отсутствующих подразделений; они не используются в этом снимке.</p>}</section>;
}
