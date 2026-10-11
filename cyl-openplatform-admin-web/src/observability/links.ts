import type { AdminRoute } from "../navigation/AdminNavigation";
import {
  emptyFilters,
  legacyCallNamespace,
  listNamespaces,
  type ObservationFilters,
  type ObservationView,
} from "./model";

/** 集中排障入口：只接受查询字段，重置目标视图旧筛选及详情，不携带凭据/正文。 */
export function observationRoute(
  view: ObservationView,
  filters: Partial<ObservationFilters> = {},
  current?: AdminRoute,
): AdminRoute {
  const namespace = listNamespaces[view];
  const managementFilters = { ...current?.managementFilters };
  for (const key of Object.keys(managementFilters))
    if (key.startsWith(namespace + ".") || (view === "calls" && key.startsWith(legacyCallNamespace + "."))) delete managementFilters[key];
  // 只写入有值的条件（地址只含设置过的条件）。
  for (const key of Object.keys(emptyFilters) as (keyof ObservationFilters)[]) {
    const value = filters[key];
    if (value !== undefined && value.length)
      managementFilters[namespace + "." + key] = Array.isArray(value)
        ? value
        : [value];
  }
  return {
    page: view,
    apiId: null,
    step: "outer",
    query: "",
    pageNo: 1,
    managementFilters,
  };
}
