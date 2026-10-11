import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import type { AdminRoute } from "../navigation/AdminNavigation";
import type { OperationsStatistics } from "./types";
export type StatisticsFilters = {
  from: string;
  to: string;
  mode: string;
  bucket: string;
  apiId: string;
  applicationId: string;
  tenantId: string;
  employeeId: string;
  identityKind: string;
  ruleId: string;
  ruleVersion: string;
  ruleName: string;
  dimension: string;
  sort: string;
  top: string;
};
export const bucketMinutes: Record<string, number> = {
  MINUTE: 1,
  FIVE_MINUTES: 5,
  HOUR: 60,
};
export const modeNames = { PRODUCTION: "正式调用", DRAFT_DEBUG: "草稿调试" };
export function recentFilters(hours = 1): StatisticsFilters {
  const to = Math.floor(Date.now() / 60000) * 60000;
  return {
    from: new Date(to - hours * 3600000).toISOString(),
    to: new Date(to).toISOString(),
    mode: "PRODUCTION",
    bucket: hours > 24 ? "HOUR" : "FIVE_MINUTES",
    apiId: "",
    applicationId: "",
    tenantId: "",
    employeeId: "",
    identityKind: "",
    ruleId: "",
    ruleVersion: "",
    ruleName: "",
    dimension: "TENANT",
    sort: "REQUESTS",
    top: "10",
  };
}
export const localInput = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
};
export const displayTime = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "时间无效";
export function statisticsQuery(filters: StatisticsFilters) {
  const from = new Date(filters.from),
    to = new Date(filters.to),
    span = to.getTime() - from.getTime(),
    bucket = bucketMinutes[filters.bucket];
  if (!Number.isFinite(span)) throw new Error("请填写有效的开始和结束时间。");
  if (span <= 0) throw new Error("结束时间须晚于开始时间，请调整时间范围。");
  if (span > 31 * 86400000) throw new Error("时间范围最多31天，请缩短范围。");
  if (!bucket) throw new Error("请选择有效的聚合粒度。");
  if (from.getTime() % 60000 !== 0 || to.getTime() % 60000 !== 0)
    throw new Error("开始和结束时间须精确到整分钟。");
  if (
    Math.ceil(to.getTime() / (bucket * 60000)) -
      Math.floor(from.getTime() / (bucket * 60000)) >
    1440
  )
    throw new Error("当前范围超过1440个分桶，请缩短范围或选择更大粒度。");
  if (!["PRODUCTION", "DRAFT_DEBUG"].includes(filters.mode))
    throw new Error("请选择有效调用方式。");
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    mode: filters.mode,
    bucket: filters.bucket,
  });
  for (const key of ["apiId", "applicationId"] as const)
    if (filters[key].trim()) {
      if (!/^[A-Za-z0-9_-]{1,36}$/.test(filters[key].trim()))
        throw new Error("API和凭据ID最多36个字母、数字、下划线或短横线。");
      params.set(key, filters[key].trim());
    }
  for (const key of ['tenantId', 'employeeId'] as const) if (filters[key]) {
    if (filters[key].length > 64 || /[\x00-\x1f\x7f]/.test(filters[key])) throw new Error('租户/人员编号最多64字符。');
    params.set(key, filters[key]);
  }
  if (filters.employeeId && !filters.tenantId) throw new Error('请先选择调用人员所在租户。');
  for (const key of ['identityKind', 'ruleId', 'ruleVersion', 'dimension', 'sort', 'top'] as const) if (filters[key]) params.set(key, filters[key]);
  return params.toString();
}
export const count = (value: number) => stringifyJson(value);
export const failures = (data: OperationsStatistics) =>
  (
    BigInt(count(data.summary.requests)) - BigInt(count(data.summary.successes))
  ).toString();
export function bucketRange(
  data: OperationsStatistics,
  start: string,
  end?: string,
) {
  return {
    from: new Date(
      Math.max(Date.parse(start), Date.parse(data.from)),
    ).toISOString(),
    to: new Date(
      Math.min(
        end
          ? Date.parse(end)
          : Date.parse(start) + bucketMinutes[data.bucket] * 60000,
        Date.parse(data.to),
      ),
    ).toISOString(),
  };
}
/** 图形最多60段，连续合并覆盖整个查询区间；原始精确数值仍在分页明细里。 */
export function chartGroups(data: OperationsStatistics) {
  const size = Math.max(1, Math.ceil(data.points.length / 60));
  return Array.from(
    { length: Math.ceil(data.points.length / size) },
    (_, index) => {
      const points = data.points.slice(index * size, (index + 1) * size),
        first = points[0],
        last = points[points.length - 1];
      return {
        ...bucketRange(
          data,
          first.bucketStart,
          new Date(
            Date.parse(last.bucketStart) + bucketMinutes[data.bucket] * 60000,
          ).toISOString(),
        ),
        failures: points.reduce((sum, p) => sum + BigInt(count(p.totals.requests)) - BigInt(count(p.totals.successes)), 0n).toString(),
        rejected: points.reduce((sum, p) => sum + BigInt(count(p.totals.governanceRejected)), 0n).toString(),
        observed: points.reduce((sum, p) => sum + BigInt(count(p.totals.observedRequests)), 0n).toString(),
        requests: points
          .reduce((sum, p) => sum + BigInt(count(p.totals.requests)), 0n)
          .toString(),
      };
    },
  );
}

/**
 * 114 调用分析页的地址条件（`filter.analytics.<key>`，只写非默认值）。
 * 时间范围、调用方式、排行维度/排序/条数即时生效；对象条件与聚合粒度在“更多筛选”中一次应用。
 */
export const analyticsDefaults = {
  range: "1h",
  from: "",
  to: "",
  mode: "PRODUCTION",
  bucket: "",
  tenantId: "",
  employeeId: "",
  apiId: "",
  applicationId: "",
  identityKind: "",
  ruleId: "",
  ruleVersion: "",
  ruleName: "",
  dimension: "TENANT",
  sort: "REQUESTS",
  top: "10",
};
export type AnalyticsFilters = typeof analyticsDefaults;
export const analyticsApplyKeys: (keyof AnalyticsFilters)[] = ["tenantId", "employeeId", "apiId", "applicationId", "bucket"];
const rangeHours: Record<string, number> = { "1h": 1, "24h": 24, "7d": 168 };

/** 地址条件 → 统计查询窗口：快捷范围按当前整分钟往前计算；未指定粒度时 24 小时以内 5 分钟、更长 1 小时。 */
export function analyticsWindow(filters: AnalyticsFilters, now = Date.now()): StatisticsFilters {
  const custom = filters.range === "custom";
  const end = Math.floor(now / 60000) * 60000;
  const from = custom ? filters.from : new Date(end - (rangeHours[filters.range] ?? 1) * 3600000).toISOString();
  const to = custom ? filters.to : new Date(end).toISOString();
  const span = Date.parse(to) - Date.parse(from);
  const { range: _range, ...rest } = filters;
  return { ...rest, from, to, bucket: filters.bucket || (span > 86400000 ? "HOUR" : "FIVE_MINUTES") };
}

/** 调用日志地址条件（114 日志页 `filter.logs.<字段>`）。 */
export type LogConditions = {
  from: string;
  to: string;
  outcome?: "FAILURE";
  mode?: string;
  tenantId?: string;
  employeeNo?: string | null;
  employeeId?: string;
  apiId?: string;
  applicationId?: string;
  identityKind?: string;
  ruleId?: string;
  ruleVersion?: string;
  governanceOutcome?: string;
  denialReason?: string;
};
/**
 * 下钻到调用日志：时间固定为已查询的绝对范围（range=custom），其余条件只写设置过的。
 * 统计按调用方式分开，日志默认不限方式，所以 mode 总是写入；人员优先用工号，缺少工号时带 employeeId（需同时有 tenantId）。
 */
export function logsRoute({ from, to, outcome, employeeNo, employeeId, ...rest }: LogConditions): AdminRoute {
  const managementFilters: Record<string, string[]> = {
    "logs.range": ["custom"],
    "logs.from": [from],
    "logs.to": [to],
  };
  if (outcome) managementFilters["logs.outcome"] = [outcome];
  if (employeeNo) managementFilters["logs.employeeNo"] = [employeeNo];
  else if (employeeId && rest.tenantId) managementFilters["logs.employeeId"] = [employeeId];
  for (const [key, value] of Object.entries(rest)) if (value) managementFilters["logs." + key] = [value];
  return { page: "calls", apiId: null, step: "outer", query: "", pageNo: 1, managementFilters };
}
