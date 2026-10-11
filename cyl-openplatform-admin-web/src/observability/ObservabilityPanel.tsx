import { useEffect } from "react";
import type { AdminApi } from "../access/api";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import AuditLogPage from "./AuditLogPage";
import CallLogPage from "./CallLogPage";
import { legacyCallNamespace, listNamespaces, type CallFilters, type ObservationView } from "./model";
import "./observability.css";

/** 运行“调用日志”（/logs）与设置“管理审计”（/audits）的入口；两页各自独立，条件互不影响。 */
export default function ObservabilityPanel({
  api,
  initialView = "calls",
  initialFilters,
  onOpenCredential,
  permissions = [],
}: {
  api: AdminApi;
  initialView?: ObservationView;
  initialFilters?: Partial<Pick<CallFilters, "applicationId" | "tenantId" | "employeeNo">>;
  onOpenCredential?: (id: string) => void;
  permissions?: string[];
}) {
  const navigation = useAdminNavigation();
  const stored = navigation.route.managementFilters ?? {};
  const legacyKeys = initialView === "calls" ? Object.keys(stored).filter((key) => key.startsWith(`${legacyCallNamespace}.`)) : [];
  // 旧分享链接 `filter.calls.*` 原位迁移为 `filter.logs.*`（替换历史，不新增记录），迁移完成前不发查询。
  useEffect(() => {
    if (!legacyKeys.length) return;
    const managementFilters = { ...stored };
    for (const key of legacyKeys) {
      const field = key.slice(legacyCallNamespace.length + 1);
      const values = managementFilters[key].filter(Boolean);
      delete managementFilters[key];
      if (field !== "page" && values.length && !managementFilters[`${listNamespaces.calls}.${field}`]) managementFilters[`${listNamespaces.calls}.${field}`] = values;
    }
    navigation.navigate({ ...navigation.route, managementFilters }, true);
  }, [legacyKeys.join(",")]);
  if (legacyKeys.length) return null;
  return initialView === "audits" ? (
    <AuditLogPage api={api} permissions={permissions} onOpenCredential={onOpenCredential} />
  ) : (
    <CallLogPage api={api} permissions={permissions} initialFilters={initialFilters} onOpenCredential={onOpenCredential} />
  );
}
