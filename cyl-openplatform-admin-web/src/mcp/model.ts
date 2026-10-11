import { defineStatusMap, type StatusDefinition } from "@cyl/open-platform-web-shared/ui/components";

export interface McpSigningKey {
  keyId: string;
  applicationId: string;
  revision: number;
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
  changedAt: string;
}

/** 网关凭据不含任何秘密；lastCalledAt 为最近一次经 MCP 入口的正式调用。 */
export interface GatewayCredential {
  id: string;
  appKey: string;
  name: string;
  status: "ENABLED" | "DISABLED";
  key: McpSigningKey | null;
  lastCalledAt?: string | null;
}

export interface GatewayOverview {
  signingConfigured: boolean;
  credential: GatewayCredential | null;
}

/** 签名密钥只出现在创建或轮换的响应中，只保存在页面内存。 */
export interface IssuedGatewayCredential {
  credential: GatewayCredential;
  keyId: string;
  signingSecret: string;
}

export interface TenantActivation {
  id: string;
  tenantId: string;
  tenantName?: string | null;
  keyCode: string;
  status: "ENABLED" | "DISABLED";
  disabledByPlatform: boolean;
  activatedByEmployeeNo: string;
  activatedByName?: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export const gatewayStatus = defineStatusMap<"ENABLED" | "DISABLED">({
  ENABLED: { tone: "success", label: "启用" },
  DISABLED: { tone: "neutral", label: "已停用" },
});

/** 停用分两种来源：平台停用后租户不能在门户自行启用。 */
export function activationStatus(item: Pick<TenantActivation, "status" | "disabledByPlatform">): StatusDefinition {
  if (item.status === "ENABLED") return { tone: "success", label: "启用" };
  return item.disabledByPlatform ? { tone: "warning", label: "平台已停用" } : { tone: "neutral", label: "租户已停用" };
}

export const activationStatusFilters = [
  { value: "ENABLED", label: "启用" },
  { value: "DISABLED", label: "已停用" },
];

export interface McpTool { apiId: string; name: string; title: string; description: string; operationKind: "QUERY" | "MUTATION"; scopeCodes: string[]; toolSets: { code: string; name: string; enabled: boolean; total: number }[] }
export interface McpToolPage { items: McpTool[]; nextCursor: string | null }
export interface McpToolSet { id: string; code: string; name: string; description: string; enabled: boolean; revision: number }
export interface McpToolSetDetail { toolSet: McpToolSet; apiIds: string[]; apiNames: Record<string, string> }
