import { useEffect, useState } from 'react';
import { useAdminNavigation } from './AdminNavigation';

type Filters = Record<string, string | string[]>;
/** 管理查询只保存命名空间内的非秘密条件；编辑输入在查询后才进入 URL。 */
export function useManagementFilters<T extends Filters>(namespace: string, defaults: T) {
  const navigation = useAdminNavigation();
  const route = navigation.route;
  const saved = route.managementFilters ?? {};
  const snapshot = JSON.stringify(
    Object.fromEntries(Object.entries(saved).filter(([key]) => key.startsWith(`${namespace}.`))),
  );
  const read = () =>
    Object.fromEntries(
      Object.entries(defaults).map(([key, value]) => {
        const stored = saved[`${namespace}.${key}`];
        return [
          key,
          stored ? (Array.isArray(value) ? stored.filter(Boolean) : (stored[0] ?? '')) : value,
        ];
      }),
    ) as T;
  const restoredSnapshot = JSON.stringify(read());
  const savedPage = Number(saved[`${namespace}.page`]?.[0]) || 1;
  const [filters, setFilters] = useState(read);
  const [applied, setApplied] = useState(read);
  const [page, setPage] = useState(() => Number(saved[`${namespace}.page`]?.[0]) || 1);
  useEffect(() => {
    const restored = read();
    setFilters(restored);
    setApplied(restored);
  }, [namespace, restoredSnapshot]);
  useEffect(() => setPage(savedPage), [namespace, savedPage]);
  const commit = (next: T, nextPage = 1, preserveInput = false) => {
    if (!preserveInput) setFilters(next);
    setApplied(next);
    setPage(nextPage);
    const managementFilters = { ...saved };
    for (const [key, value] of Object.entries(next))
      managementFilters[`${namespace}.${key}`] = Array.isArray(value)
        ? value.length
          ? value
          : ['']
        : [value.trim()];
    managementFilters[`${namespace}.page`] = [String(nextPage)];
    navigation.navigate({ ...route, managementFilters });
  };
  return {
    filters,
    setFilters,
    applied,
    page,
    hasSavedQuery: snapshot !== '{}',
    apply: (next = filters) => commit(next),
    reset: () => commit(defaults),
    onPage: (next: number) => commit(applied, next, true),
  };
}
