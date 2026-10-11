import { defineStatusMap } from "@cyl/open-platform-web-shared/ui/components";

/** 凭据抽屉页签；地址中不写 tab 时为概览（沿用 route.applicationTab）。 */
export type CredentialTab = "overview" | "grants" | "scopes" | "tokens" | "signature" | "audit";
export type RouteCredentialTab = Exclude<CredentialTab, "overview">;

export const credentialTabs: [CredentialTab, string][] = [
  ["overview", "概览"],
  ["grants", "授权租户与人员"],
  ["scopes", "权限组"],
  ["tokens", "Token"],
  ["signature", "签名密钥"],
  ["audit", "操作记录"],
];

export const credentialStatus = defineStatusMap<"ENABLED" | "DISABLED">({
  ENABLED: { tone: "success", label: "启用" },
  DISABLED: { tone: "neutral", label: "停用" },
});

/** 租户关联与签名密钥共用“有效 / 已撤销”两态。 */
export const grantStatus = defineStatusMap<"ACTIVE" | "REVOKED">({
  ACTIVE: { tone: "success", label: "有效" },
  REVOKED: { tone: "neutral", label: "已撤销" },
});

export const delegationStatus = defineStatusMap<"ACTIVE" | "REVOKED">({
  ACTIVE: { tone: "success", label: "有效委托" },
  REVOKED: { tone: "neutral", label: "已撤销" },
});

/**
 * 粘贴的完整 Token（43 位 base64url 或 Bearer 前缀）不能进入地址与查询；
 * 与后端 CredentialSearch 的判断一致，AK 与 Token 记录 ID 先按各自格式识别。
 */
export function looksLikeRawToken(text: string) {
  const value = text.trim();
  if (/^[a-f0-9]{32}$/.test(value) || /^TOK_[0-9a-f]{32}$/.test(value)) return false;
  return /^bearer\s+/i.test(value) || /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function formatTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString("zh-CN", { ...(sameYear ? {} : { year: "numeric" }), month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
