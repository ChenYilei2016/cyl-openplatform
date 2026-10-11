import { useEffect, useMemo, useState } from "react";
import { useAdminNavigation } from "./AdminNavigation";

export type ListValue = string | string[];
type Values = Record<string, ListValue>;

const PAGE_SIZES = [20, 50, 100];
const same = (a: ListValue | undefined, b: ListValue | undefined) =>
  Array.isArray(a) || Array.isArray(b) ? JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort()) : (a ?? "") === (b ?? "");

/**
 * 106 列表条件（113/114）：条件保存在地址的命名空间参数 `filter.<namespace>.<key>`，只写入与默认值不同的条件，
 * 刷新、前进后退与分享都能还原。即时条件改动立即生效（替换历史）；`applyKeys` 中的组合条件先改草稿，“应用”后才生效。
 * 翻页写入历史，其他条件变化回到第 1 页。
 * `legacyKeys`：字段改名前的旧键 → 新键。旧链接打开时还原到新字段（新键已有值时以新键为准），并把地址替换为新键名。
 */
export function useListQuery<T extends Values>({ namespace, defaults, applyKeys = [], legacyKeys = {} }: { namespace: string; defaults: T; applyKeys?: (keyof T)[]; legacyKeys?: Record<string, keyof T & string> }) {
  const navigation = useAdminNavigation();
  const route = navigation.route;
  const keyOf = (key: string) => `${namespace}.${key}`;
  const stored = useMemo(() => {
    const source = route.managementFilters ?? {};
    const legacy = Object.keys(legacyKeys).filter((key) => source[keyOf(key)]);
    if (!legacy.length) return source;
    const canonical = { ...source };
    for (const key of legacy) {
      const target = keyOf(legacyKeys[key]);
      if (!canonical[target]?.some(Boolean)) canonical[target] = source[keyOf(key)];
      delete canonical[keyOf(key)];
    }
    return canonical;
  }, [JSON.stringify(route.managementFilters), namespace, JSON.stringify(legacyKeys)]);
  const hasLegacy = Object.keys(legacyKeys).some(key => Boolean(route.managementFilters?.[keyOf(key)]));
  useEffect(() => {
    if (hasLegacy) navigation.navigate({ ...navigation.route, managementFilters: stored }, true);
  }, [hasLegacy, stored]);
  const applied = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(defaults).map(([key, fallback]) => {
          const values = stored[keyOf(key)]?.filter(Boolean);
          return [key, values?.length ? (Array.isArray(fallback) ? values : values[0]) : fallback];
        }),
      ) as T,
    // 默认值按内容比较，调用方可以内联书写。
    [JSON.stringify(stored), namespace, JSON.stringify(defaults)],
  );
  const page = Math.max(1, Number(stored[keyOf("page")]?.[0]) || 1);
  const pageSize = PAGE_SIZES.includes(Number(stored[keyOf("pageSize")]?.[0])) ? Number(stored[keyOf("pageSize")]![0]) : 20;
  const [draft, setDraftState] = useState<T>(applied);
  const appliedKey = JSON.stringify(applied);
  useEffect(() => setDraftState(applied), [appliedKey]);

  const write = (next: Partial<T>, options: { page?: number; pageSize?: number; push?: boolean } = {}) => {
    const managementFilters = { ...(navigation.route.managementFilters ?? {}) };
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || same(value as ListValue, defaults[key])) delete managementFilters[keyOf(key)];
      else managementFilters[keyOf(key)] = Array.isArray(value) ? value : [value as string];
    }
    const nextPage = options.page ?? 1;
    if (nextPage > 1) managementFilters[keyOf("page")] = [String(nextPage)];
    else delete managementFilters[keyOf("page")];
    const nextSize = options.pageSize ?? pageSize;
    if (nextSize !== 20) managementFilters[keyOf("pageSize")] = [String(nextSize)];
    else delete managementFilters[keyOf("pageSize")];
    navigation.navigate({ ...navigation.route, managementFilters }, !options.push);
  };
  const applyValues = Object.fromEntries(applyKeys.map((key) => [key, draft[key]])) as Partial<T>;
  const changedDraft = applyKeys.some((key) => !same(draft[key], applied[key]));

  return {
    /** 已生效条件（来自地址）。 */
    filters: applied,
    /** “更多筛选”面板中编辑中的组合条件。 */
    draft,
    page,
    pageSize,
    /** 即时条件：立即生效并回到第 1 页。 */
    setFilter: <K extends keyof T>(key: K, value: T[K]) => write({ [key]: value } as unknown as Partial<T>),
    setFilters: (patch: Partial<T>) => write(patch),
    setDraft: <K extends keyof T>(key: K, value: T[K]) => setDraftState((current) => ({ ...current, [key]: value })),
    /** 应用草稿中的组合条件。 */
    apply: () => write(applyValues),
    discardDraft: () => setDraftState(applied),
    /** 草稿与已生效条件不同（面板关闭前可提示）。 */
    changedDraft,
    /** 恢复默认值；不传时清除全部条件。 */
    clear: (keys: (keyof T)[] = Object.keys(defaults) as (keyof T)[]) =>
      write(Object.fromEntries(keys.map((key) => [key, defaults[key]])) as Partial<T>),
    setPage: (next: number) => write({}, { page: next, push: true }),
    setPageSize: (next: number) => write({}, { pageSize: next }),
    /** 与默认值不同的条件。 */
    isActive: (key: keyof T) => !same(applied[key], defaults[key]),
    activeCount: (keys: (keyof T)[]) => keys.filter((key) => !same(applied[key], defaults[key])).length,
  };
}
