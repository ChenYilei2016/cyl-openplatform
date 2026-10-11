import { parseJson } from "@cyl/open-platform-web-shared/json";
import { defaultLifecycle } from "@cyl/open-platform-web-shared/lifecycle";
import type { ApiDefinition } from "../CatalogPanel";
import { adapterForm, responseAdapter } from "../ResponseAdapterEditor";
import { parseSchema } from "./draftModel";
import type { ApiDraft } from "./useApiDraft";

/** 当前输入的可比较形态（与生效版或冲突修订按分区比较）。 */
export function draftComparable(draft: ApiDraft): Record<string, unknown> {
  let adapter: unknown;
  try {
    adapter = responseAdapter(draft.adapter);
  } catch {
    adapter = undefined; // 外壳规则尚未填完整时不计入差异。
  }
  let errors: unknown;
  try {
    errors = parseJson(draft.sections.errorDefinitions);
  } catch {
    errors = undefined;
  }
  return {
    ...draft.metadata,
    scopeCodes: draft.codes,
    employeeRequired: draft.employeeRequired,
    operationKind: draft.operationKind,
    idempotencyField: draft.idempotencyField.trim() || null,
    mcpTool: { enabled: draft.mcpTool.enabled, aiDescription: draft.mcpTool.aiDescription.trim() ? draft.mcpTool.aiDescription : null },
    lifecycle: draft.lifecycle,
    binding: draft.lastBinding,
    requestSchema: parseSchema(draft.sections.requestSchema),
    responseSchema: parseSchema(draft.sections.responseSchema),
    mappings: draft.lastMappings,
    responseAdapter: adapter,
    errorDefinitions: errors,
  };
}
export function snapshotComparable(snapshot: ApiDefinition): Record<string, unknown> {
  const value = snapshot as unknown as Record<string, unknown>;
  return {
    ...value,
    description: snapshot.description ?? "",
    employeeRequired: snapshot.employeeRequired === true,
    operationKind: snapshot.operationKind ?? "MUTATION",
    idempotencyField: snapshot.idempotencyField ?? null,
    mcpTool: { enabled: snapshot.mcpTool?.enabled === true, aiDescription: snapshot.mcpTool?.aiDescription ?? null },
    lifecycle: snapshot.lifecycle ?? defaultLifecycle,
    responseAdapter: responseAdapter(adapterForm(snapshot.responseAdapter)),
    mappings: snapshot.mappings ?? [],
    errorDefinitions: snapshot.errorDefinitions ?? [],
  };
}
