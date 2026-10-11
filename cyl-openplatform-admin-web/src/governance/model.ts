export type TargetType =
  | "APPLICATION"
  | "API"
  | "TENANT"
  | "TENANT_API"
  | "APPLICATION_API";
export type Mode = "ENFORCE" | "OBSERVE";
export type Algorithm = "NONE" | "TOKEN_BUCKET";
export interface Config {
  target: {
    type: TargetType;
    tenantId: string | null;
    applicationId: string | null;
    apiId: string | null;
  };
  enabled: boolean;
  mode: Mode;
  rate: {
    algorithm: Algorithm;
    perSecond: number;
    burst: number;
  };
  dailyQuota: number;
  ipMode: "UNRESTRICTED" | "ALLOWLIST" | "DENYLIST";
  ipAddresses: string[];
}
export interface Rule extends Config {
  id: string;
  version: number;
}
export interface TargetDisplay {
  applicationName?: string;
  appKey?: string;
  apiName?: string;
  service?: string;
  version?: string;
  method?: string;
}
export interface Draft {
  targetDisplay?: TargetDisplay;
  liveName?: string;
  id: string;
  name: string;
  config: Config;
  draftRevision: number;
  stateVersion: number;
  liveReleaseId: string | null;
  liveRule: Rule | null;
}
export interface Preview {
  id: string;
  name: string;
  beforeName: string;
  draftRevision: number;
  stateVersion: number;
  sourceReleaseId: string | null;
  digest: string;
  before: Rule | null;
  after: Rule;
  change: boolean;
  warnings: string[];
}
export interface Release {
  id: string;
  ruleId: string;
  name: string;
  rule: Rule;
  publishedAt: string;
  sourceReleaseId: string | null;
  previewDigest: string;
}
export const targetNames: Record<TargetType, string> = {
  APPLICATION: "接入凭据",
  API: "API 操作",
  TENANT: "租户",
  TENANT_API: "租户 + API",
  APPLICATION_API: "凭据 + API",
};
export const modeNames = {
  ENFORCE: "执行：超限会拒绝",
  OBSERVE: "观察：只记录，不拦截",
};
export const algorithmNames = {
  NONE: "不限速",
  TOKEN_BUCKET: "令牌桶（每秒补充）",
};
export const ipNames = {
  UNRESTRICTED: "不限制",
  ALLOWLIST: "允许名单",
  DENYLIST: "拒绝名单",
};
export const permitted = (type: TargetType, permissions: string[]) =>
  (!["APPLICATION", "TENANT", "TENANT_API", "APPLICATION_API"].includes(type) ||
    permissions.includes("MANAGE_APPLICATIONS")) &&
  (!["API", "TENANT_API", "APPLICATION_API"].includes(type) ||
    permissions.includes("MANAGE_APIS"));
export const fresh = (type: TargetType): Config => ({
  target: { type, tenantId: null, applicationId: null, apiId: null },
  enabled: true,
  mode: "OBSERVE",
  rate: { algorithm: "TOKEN_BUCKET", perSecond: 10, burst: 20 },
  dailyQuota: 0,
  ipMode: "UNRESTRICTED",
  ipAddresses: [],
});

export const addresses = (text: string) =>
  text
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
export const rateText = (value: Config) =>
  value.rate.algorithm === "NONE"
    ? "不限速"
    : `${value.rate.perSecond} 次/秒 · 突发 ${value.rate.burst} 次`;
export const quotaText = (value: Config) =>
  value.dailyQuota
    ? `${value.dailyQuota.toLocaleString()} 次/UTC日`
    : "不限日配额";
export const targetText = (value: Config["target"]) =>
  [
    value.tenantId && `租户 ${value.tenantId}`,
    value.applicationId && `凭据 ID ${value.applicationId}`,
    value.apiId && `API ID ${value.apiId}`,
  ]
    .filter(Boolean)
    .join(" · ");
export function configOnly(value: Config): Config {
  return {
    target: value.target,
    enabled: value.enabled,
    mode: value.mode,
    rate: value.rate,
    dailyQuota: value.dailyQuota,
    ipMode: value.ipMode,
    ipAddresses: value.ipAddresses,
  };
}
export function validation(name: string, value: Config): string[] {
  const errors: string[] = [];
  if (!name.trim()) errors.push("填写规则名称");
  if (
    ["TENANT", "TENANT_API"].includes(value.target.type) &&
    !/^[A-Za-z0-9_-]{1,64}$/.test(value.target.tenantId ?? "")
  )
    errors.push("填写有效租户 ID");
  if (
    ["APPLICATION", "APPLICATION_API"].includes(value.target.type) &&
    !value.target.applicationId
  )
    errors.push("选择接入凭据");
  if (
    ["API", "TENANT_API", "APPLICATION_API"].includes(value.target.type) &&
    !value.target.apiId
  )
    errors.push("选择 API 操作");
  if (
    value.rate.algorithm === "TOKEN_BUCKET" &&
    [value.rate.perSecond, value.rate.burst].some(
      (n) => !Number.isInteger(n) || n < 1 || n > 1000000,
    )
  )
    errors.push("速率和突发容量须为 1–1000000 的整数");
  if (
    !Number.isInteger(value.dailyQuota) ||
    value.dailyQuota < 0 ||
    value.dailyQuota > 100000000
  )
    errors.push("日配额须为 0–100000000 的整数");
  if (value.ipAddresses.some((value) => !validNetwork(value)))
    errors.push("IP 名单包含无效地址或 CIDR");
  if (value.ipAddresses.length > 100) errors.push("IP 名单最多 100 项");
  return errors;
}

// IPv6字面量交给浏览器URL解析；只校验输入，不发网络请求。最终网络规范化由服务端完成。
function validNetwork(value: string) {
  const [ip, prefix, ...extra] = value.split("/");
  if (extra.length || value.length > 49 || ip.includes("%")) return false;
  const v6 = ip.includes(":");
  if (
    prefix !== undefined &&
    (!/^\d{1,3}$/.test(prefix) || Number(prefix) > (v6 ? 128 : 32))
  )
    return false;
  if (v6) {
    try {
      return new URL(`http://[${ip}]/`).hostname.length > 0;
    } catch {
      return false;
    }
  }
  return (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) &&
    ip.split(".").every((part) => Number(part) <= 255)
  );
}
