import type { StatusTone } from "@cyl/open-platform-web-shared/ui/components";
import type { Scope, ScopeApi } from "./api";

/** 三个开关含义不同：启用决定能否调用；默认授予只决定新建凭据时是否自动带上；公共通用决定所有租户在 MCP 与门户中是否可用。 */
export const scopeHelp = {
  enabled: "启用后，持有此组的凭据才能调用组内 API。启用或停用都会使持有此组的全部凭据的旧 Token 失效，接入方需要重新签发。",
  defaultGrant: "只影响之后新建的凭据：创建时自动勾选此组。不会给已有凭据补授权或回收权限；权限组停用期间不授予。",
  publicAccess:
    "打开后所有租户都能在 MCP 工具与门户 API 文档中使用此组的 API，立即生效，关闭即收回。与“新凭据默认授予”不同：不复制到任何凭据，也不改变凭据调用 API 的权限；权限组停用期间不计入。",
  tenantGrants: "把此组开通给指定租户：该租户可在 MCP 工具与门户 API 文档中使用组内 API。普通凭据调用仍按凭据自己的权限组判断，开通或撤销不影响凭据与 Token。",
  apiCount: "已发布生效版本携带此组的 API 数。在权限组中增删 API 修改的是 API 草稿，发布后才计入。",
  credentialCount: "当前持有此组的凭据数。调整某个凭据的权限组请到凭据详情操作。",
};

export const enabledText = (enabled: boolean) => (enabled ? "启用" : "停用");

export const publicAccessText = (scope: Pick<Scope, "enabled" | "publicAccess">) =>
  scope.publicAccess ? (scope.enabled ? "是" : "是 · 停用期间不计入") : "否";

export const defaultGrantText = (scope: Pick<Scope, "enabled" | "defaultForNewApplication">) =>
  scope.defaultForNewApplication ? (scope.enabled ? "是" : "是 · 停用期间不授予") : "否";

/** 草稿与已发布版本是否携带该组的组合，决定行状态与可执行的操作。 */
export function scopeApiState(item: ScopeApi): { tone: StatusTone; label: string; detail?: string } {
  const otherChanges = item.liveDraftRevision !== null && item.liveDraftRevision !== item.draftRevision;
  if (item.liveIncluded && item.draftIncluded)
    return { tone: "success", label: "已生效", detail: otherChanges ? "API 另有未发布修改" : undefined };
  if (item.liveIncluded) return { tone: "warning", label: "草稿已移除", detail: "发布后停止授权" };
  return { tone: "processing", label: "草稿已加入", detail: item.liveDraftRevision === null ? "API 尚未发布" : "发布后生效" };
}
