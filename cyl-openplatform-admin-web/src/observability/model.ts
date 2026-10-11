import { resolveTimeRange, type TimeRangeValue } from "@cyl/open-platform-web-shared/ui/list";
export interface CallRecord {
  id: string;
  requestId: string;
  mode: "PRODUCTION" | "DRAFT_DEBUG";
  channel?: "API" | "MCP";
  toolName?: string | null;
  apiId: string | null;
  service: string | null;
  version: string | null;
  method: string | null;
  protocol: string | null;
  applicationId: string | null;
  tenantId: string | null;
  employeeNo: string | null;
  clientIp: string;
  releaseId: string | null;
  draftRevision: number | null;
  operatorTenantId: string | null;
  operatorEmployeeNo: string | null;
  outcome: string;
  errorCode: number | null;
  httpStatus: number;
  durationMillis: number;
  occurredAt: string;
  governance?: GovernanceDecision | null;
  userId?: string | null;
  employeeId: string | null;
  /** 后端按页批量补充的展示名称，未登记为 null。 */
  tenantName?: string | null;
  employeeName?: string | null;
}
export interface ManagementAudit {
  id: string;
  source: string;
  requestId: string;
  apiId: string | null;
  applicationId: string | null;
  tenantId: string | null;
  targetId: string | null;
  action: string;
  outcome: string;
  actorKind: string;
  operatorTenantId: string | null;
  operatorEmployeeNo: string | null;
  releaseId: string | null;
  draftRevision: number | null;
  occurredAt: string;
  tenantName?: string | null;
  operatorName?: string | null;
}
export const sourceNames: Record<string, string> = {
  ACCESS: "授权与治理",
  TOKEN: "令牌操作",
  CATALOG: "API 草稿",
  PUBLICATION: "发布",
};
/** 两页条件在地址中的命名空间：调用日志 `filter.logs.*`（旧链接 `filter.calls.*` 进入时迁移），管理审计 `filter.audits.*`。 */
export const listNamespaces: Record<ObservationView, string> = { calls: "logs", audits: "audits" };
/** 旧版调用日志命名空间，只用于迁移旧分享链接。 */
export const legacyCallNamespace = "calls";
/** 调用日志条件（地址 `filter.logs.<字段>`，只写非默认值）；字段名沿用旧链接，旧分享地址仍能还原。 */
export const callDefaults = {
  requestId: "",
  range: "24h",
  from: "",
  to: "",
  outcome: [] as string[],
  apiId: "",
  applicationId: "",
  tenantId: "",
  employeeNo: "",
  employeeId: "",
  mode: [] as string[],
  channel: "",
  toolName: "",
  identityKind: "",
  governanceOutcome: "",
  denialReason: "",
  ruleId: "",
  ruleVersion: "",
  durationMin: "",
  durationMax: "",
  id: "",
};
/** “更多筛选”中一次“应用”的组合条件；时间、结果、API 与请求号即时生效。 */
export const callApplyKeys = [
  "applicationId",
  "tenantId",
  "employeeNo",
  "employeeId",
  "mode",
  "channel",
  "toolName",
  "identityKind",
  "governanceOutcome",
  "denialReason",
  "ruleId",
  "ruleVersion",
  "durationMin",
  "durationMax",
  "id",
] as const;
/** 管理审计条件（地址 `filter.audits.<字段>`）。 */
export const auditDefaults = {
  requestId: "",
  range: "24h",
  from: "",
  to: "",
  outcome: [] as string[],
  source: [] as string[],
  operatorEmployeeNo: "",
  operatorTenantId: "",
  targetId: "",
  apiId: "",
  applicationId: "",
  tenantId: "",
  id: "",
};
export const auditApplyKeys = [
  "operatorEmployeeNo",
  "operatorTenantId",
  "targetId",
  "apiId",
  "applicationId",
  "tenantId",
  "id",
] as const;
export type CallFilters = typeof callDefaults;
export type AuditFilters = typeof auditDefaults;
/** 跳转入口可写入的全部条件字段。 */
export const emptyFilters = { ...callDefaults, ...auditDefaults };

export interface GovernanceDecision {
  allowed: boolean;
  denialReason: string;
  retryAfterSeconds: number;
  hits: {
    ruleId: string;
    version: number;
    targetType: string;
    mode: string;
    algorithm: string;
    reason: string;
    retryAfterSeconds: number;
  }[];
}
export type ObservationView = "calls" | "audits";
export type ObservationRecord = CallRecord | ManagementAudit;
export type ObservationFilters = typeof emptyFilters;

export const auditActions: Record<string, string> = {
  CREATE_APPLICATION: "创建接入凭据",
  CREATE_BOUND_APPLICATION: "生成并绑定凭据",
  RENAME_APPLICATION: "修改凭据名称",
  SET_APPLICATION_SCOPES: "调整调用权限",
  SET_APPLICATION_STATUS: "调整凭据状态",
  ROTATE_APPLICATION_SECRET: "轮换AppSecret",
  BIND_TENANT: "绑定租户",
  REVOKE_TENANT: "解除租户关联",
  UPDATE_TENANT_NOTE: "修改租户备注",
  GRANT_USER: "授予人员委托",
  REVOKE_USER: "撤销人员委托",
  CREATE_SCOPE: "创建权限组",
  UPDATE_SCOPE: "修改权限组",
  CREATE_SIGNING_KEY: "生成签名密钥",
  ROTATE_SIGNING_KEY: "轮换签名密钥",
  REVOKE_SIGNING_KEY: "撤销签名密钥",
  CREATE_MCP_GATEWAY_CREDENTIAL: "创建MCP网关凭据",
  SET_MCP_GATEWAY_STATUS: "调整MCP网关凭据状态",
  OPEN_MCP_ACTIVATION: "开通MCP",
  SET_MCP_ACTIVATION_STATUS: "调整MCP开通状态",
  CREATE_GOVERNANCE_DRAFT: "创建治理草稿",
  SAVE_GOVERNANCE_DRAFT: "保存治理草稿",
  PUBLISH_GOVERNANCE: "发布治理规则",
  ROLLBACK_GOVERNANCE: "回滚治理规则",
  CREATE_DRAFT: "创建API草稿",
  UPDATE_DRAFT: "更新API草稿",
  RESTORE_API_DRAFT: "恢复API草稿",
  SUBMIT: "提交发布",
  APPROVE: "审核通过",
  REJECT: "审核拒绝",
  ROLLBACK: "回滚发布",
  ENABLE: "启用",
  DISABLE: "停用",
  ISSUE: "签发Token",
  REVOKE: "撤销Token",
  REFRESH: "刷新Token",
  DEBUG_AS_APP: "以凭据身份调试草稿",
};
export const modeNames: Record<string, string> = {
  PRODUCTION: "正式调用",
  DRAFT_DEBUG: "草稿调试",
};
export const actorNames: Record<string, string> = {
  ADMIN: "管理员",
  APPLICATION_CREDENTIALS: "凭据持有方",
  PORTAL: "门户人员",
  SYSTEM: "系统",
};
export const reasonNames: Record<string, string> = {
  NONE: "通过",
  IP_DENIED: "IP 不在允许范围",
  TOKEN_BUCKET_LIMIT: "请求速率超限",
  DAILY_QUOTA: "日配额已用尽",
};
export const timeText = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "无效时间";
export const recordKey = (entry: ObservationRecord) =>
  ("source" in entry ? entry.source : entry.mode) + ":" + entry.id;
const presets = ["1h", "24h", "7d"] as const;
/** 地址条件 → 时间范围：只带 from/to 的旧链接与跳转入口视为自定义。 */
export function timeRangeOf(filters: { range: string; from: string; to: string }): TimeRangeValue {
  const preset = presets.find((value) => value === filters.range);
  if (filters.range === "custom" || ((filters.from || filters.to) && (!preset || preset === "24h")))
    return { preset: "custom", from: filters.from || undefined, to: filters.to || undefined };
  return { preset: preset ?? "24h" };
}
/** 按服务端默认补全自定义端点（缺结束为当前，缺开始为结束前 24 小时），校验 31 天上限。 */
export function queryWindow(range: TimeRangeValue, now: number) {
  const resolved = resolveTimeRange(range, now);
  const to = resolved.to ? Date.parse(resolved.to) : now;
  const from = resolved.from ? Date.parse(resolved.from) : to - 86400000;
  const error =
    !Number.isFinite(to) || !Number.isFinite(from) || to <= from || to - from > 31 * 86400000
      ? "结束时间须晚于开始时间，范围最多31天。"
      : "";
  return { from: error ? "" : new Date(from).toISOString(), to: error ? "" : new Date(to).toISOString(), error };
}
const callFields = ["channel", "toolName", "id", "requestId", "apiId", "applicationId", "tenantId", "employeeNo", "employeeId", "identityKind", "ruleId", "ruleVersion", "governanceOutcome", "denialReason", "durationMin", "durationMax"] as const;
const auditFields = ["id", "requestId", "apiId", "applicationId", "tenantId", "targetId", "operatorTenantId", "operatorEmployeeNo"] as const;
export function queryParameters(
  filters: Partial<CallFilters & AuditFilters>,
  view: ObservationView,
  window: { from: string; to: string },
  page: number,
  pageSize = 20,
) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), from: window.from, to: window.to });
  for (const key of view === "calls" ? callFields : auditFields) {
    const value = (filters[key] ?? "").trim();
    // 人员 ID 必须与租户同时提供；规则版本必须带规则 ID，避免服务端拒绝整页查询。
    if (!value || (key === "employeeId" && !filters.tenantId?.trim()) || (key === "ruleVersion" && !filters.ruleId?.trim())) continue;
    params.set(key, value);
  }
  for (const key of ["outcome", view === "calls" ? "mode" : "source"] as const)
    (filters[key] ?? []).forEach((value) => params.append(key, value));
  return params;
}
