import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import { parseSchema, type DraftContent, type OperationKind } from "./draftModel";

/** 119：调用性质、幂等字段与 MCP 工具的页面规则；与服务端校验一致，仅用于就地说明，最终以服务端为准。 */

export const operationKindNames: Record<OperationKind, string> = { QUERY: "查询（不修改数据）", MUTATION: "会修改数据" };
/** MCP 网关描述字段上限；超出时拒绝，不静默截断。 */
export const MCP_AI_DESCRIPTION_LIMIT = 255;
const MAX_PATH_DEPTH = 8;

/** 工具名 = {service}_{method}_{version}，版本中的 . 和 - 转为 _；只含字母、数字、下划线且不超过 64 字符，否则为 null。 */
export function mcpToolName(service: string, method: string, version: string): string | null {
  const name = `${service.trim()}_${method.trim()}_${version.trim().replace(/[.-]/g, "_")}`;
  return /^[a-zA-Z0-9_]{1,64}$/.test(name) ? name : null;
}

/** 请求结构中可作幂等字段的路径：只沿对象字段下钻（不进数组），叶子为字符串或整数，最多 8 层。 */
export function idempotencyCandidates(schema: SchemaNode | null | undefined, prefix = "", depth = 1): string[] {
  if (!schema || schema.type !== "OBJECT" || depth > MAX_PATH_DEPTH) return [];
  return Object.entries(schema.properties ?? {}).flatMap(([name, child]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    if (child.type === "STRING" || child.type === "INTEGER") return [path];
    return child.type === "OBJECT" ? idempotencyCandidates(child, path, depth + 1) : [];
  });
}

export interface McpBlocker {
  path: string;
  message: string;
}

/** 打开“可作为 MCP 工具”时尚未满足的条件；同服务同操作其他版本的工具名冲突只能由服务端判断。 */
export function mcpToolBlockers(content: DraftContent): McpBlocker[] {
  if (!content.mcpTool.enabled) return [];
  const { metadata } = content;
  const blockers: McpBlocker[] = [];
  if (metadata.service.trim() && metadata.method.trim() && metadata.version.trim() && !mcpToolName(metadata.service, metadata.method, metadata.version))
    blockers.push({ path: "/mcpTool/enabled", message: "按 service_method_版本 生成的工具名超过 64 字符，无法作为 MCP 工具" });
  const request = parseSchema(content.sections.requestSchema);
  if (request && request.type !== "OBJECT") blockers.push({ path: "/mcpTool/enabled", message: "MCP 工具的请求结构根必须是对象" });
  const aiDescription = content.mcpTool.aiDescription.trim() ? content.mcpTool.aiDescription : "";
  const description = metadata.description.trim();
  if (aiDescription.length > MCP_AI_DESCRIPTION_LIMIT)
    blockers.push({ path: "/mcpTool/aiDescription", message: `面向 AI 的用途说明不能超过 ${MCP_AI_DESCRIPTION_LIMIT} 字符` });
  else if (!aiDescription && (!description || metadata.description.length > MCP_AI_DESCRIPTION_LIMIT))
    blockers.push({
      path: "/mcpTool/aiDescription",
      message: description ? `接口说明超过 ${MCP_AI_DESCRIPTION_LIMIT} 字符，请填写面向 AI 的用途说明` : "接口说明为空，请填写面向 AI 的用途说明",
    });
  if (content.operationKind === "MUTATION" && !content.idempotencyField.trim())
    blockers.push({ path: "/idempotencyField", message: "会修改数据的 API 需要在“请求参数”中选择幂等字段" });
  return blockers;
}
