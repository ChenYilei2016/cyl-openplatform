import type { ApiLifecycle } from "@cyl/open-platform-web-shared/lifecycle";
import type { Binding } from "../BindingEditor";
import { adapterForm, type AdapterForm } from "../ResponseAdapterEditor";
import { bindingShape, stringify, type DraftMetadata, type DraftSections, type McpToolDraft, type OperationKind } from "./draftModel";

/**
 * 把服务端严格解析后的整份配置拆回各分区；先整体校验，再一次性应用，避免部分写入。
 * 已创建的 API 调用标识锁定；尚未创建的草稿（复制、导入候选）可在 JSON 中一并修改。
 */
export function splitWholeJson(value: unknown, metadata: DraftMetadata, identityLocked = true) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请提供完整的 API 配置对象。");
  const input = value as Record<string, unknown>;
  if (identityLocked)
    for (const key of ["service", "version", "method"] as const)
      if (input[key] !== undefined && input[key] !== metadata[key]) throw new Error(`${key} 已锁定，不能在 JSON 中修改。`);
  if (input.binding !== undefined && !bindingShape(input.binding)) throw new Error("binding 结构不完整。");
  const text = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
  const sections: Partial<DraftSections> = {};
  for (const key of ["requestSchema", "responseSchema", "mappings", "errorDefinitions"] as const)
    if (input[key] !== undefined) sections[key] = input[key] === null ? "" : stringify(input[key]);
  const patch: {
    metadata: Partial<DraftMetadata>;
    sections: Partial<DraftSections>;
    binding?: Binding;
    codes?: string[];
    employeeRequired?: boolean;
    operationKind?: OperationKind;
    idempotencyField?: string;
    mcpTool?: McpToolDraft;
    lifecycle?: ApiLifecycle;
    adapter?: AdapterForm;
  } = {
    metadata: {
      ...(identityLocked ? {} : Object.fromEntries((["service", "version", "method"] as const).filter((key) => typeof input[key] === "string").map((key) => [key, text(key)]))),
      ...(text("name") ? { name: text("name") } : {}),
      ...(text("category") ? { category: text("category") } : {}),
      ...(text("owner") ? { owner: text("owner") } : {}),
      ...(input.description !== undefined ? { description: text("description") } : {}),
    },
    sections,
  };
  if (input.binding !== undefined) patch.binding = input.binding as Binding;
  if (Array.isArray(input.scopeCodes)) patch.codes = input.scopeCodes.filter((code): code is string => typeof code === "string");
  if (typeof input.employeeRequired === "boolean") patch.employeeRequired = input.employeeRequired;
  if (input.operationKind === "QUERY" || input.operationKind === "MUTATION") patch.operationKind = input.operationKind;
  if (input.idempotencyField !== undefined) patch.idempotencyField = text("idempotencyField");
  if (input.mcpTool && typeof input.mcpTool === "object") {
    const tool = input.mcpTool as { enabled?: unknown; aiDescription?: unknown };
    patch.mcpTool = { enabled: tool.enabled === true, aiDescription: typeof tool.aiDescription === "string" ? tool.aiDescription : "" };
  }
  if (input.lifecycle && typeof input.lifecycle === "object") patch.lifecycle = input.lifecycle as ApiLifecycle;
  if (input.responseAdapter && typeof input.responseAdapter === "object") patch.adapter = adapterForm(input.responseAdapter as Parameters<typeof adapterForm>[0]);
  return patch;
}
