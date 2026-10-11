import type { AdminApi } from "../access/api";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import AnalyticsPage from "./AnalyticsPage";
import OperationsAlerts from "./OperationsAlerts";

/** 运行工作区入口：`/analytics` 调用分析与 `/alerts` 告警是两个独立页面（114）。 */
export default function OperationsPanel({ api, permissions }: { api: AdminApi; permissions: string[] }) {
  const navigation = useAdminNavigation();
  return navigation.route.operationsView === "alerts" ? (
    <OperationsAlerts api={api} canManage={permissions.includes("MANAGE_OPERATIONS")} />
  ) : (
    <AnalyticsPage api={api} />
  );
}
