import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import { parseJson, stringifyJson } from "@cyl/open-platform-web-shared/json";
import type { ApiLifecycle } from "@cyl/open-platform-web-shared/lifecycle";
import type { Binding } from "../BindingEditor";
import { adapterForm, responseAdapter, type AdapterForm } from "../ResponseAdapterEditor";
import { newBinding } from "../BindingEditor";
import type { ApiDefinition } from "../CatalogPanel";
import type { ApiCopyDraft } from "../create/ApiCopyDialog";
import { defaultLifecycle } from "@cyl/open-platform-web-shared/lifecycle";
import type { Mapping } from "../SchemaEditor";
import { switchHttpMethodMappings } from "../httpMapping";
import { isOwnerReference } from "../CatalogReferenceFields";
import type { FieldIssue } from "../WorkspaceValidation";

/** 111：已有 API 配置页的纯函数与常量（分区、路径定位、建议完善、本地暂存）。 */

export const stringify = (value: unknown) => stringifyJson(value, 2);
export const emptyRequest: SchemaNode = { type: "OBJECT", properties: {} };

export interface DraftMetadata {
  service: string;
  version: string;
  method: string;
  name: string;
  category: string;
  owner: string;
  description: string;
}
export interface DraftSections {
  requestSchema: string;
  responseSchema: string;
  binding: string;
  mappings: string;
  errorDefinitions: string;
}
export type OperationKind = "QUERY" | "MUTATION";
export interface McpToolDraft {
  enabled: boolean;
  aiDescription: string;
}
export const defaultMcpTool: McpToolDraft = { enabled: false, aiDescription: "" };
/** 页面上全部可编辑内容；原始 JSON 片段保持文本，不丢重复键与大数精度。 */
export interface DraftContent {
  metadata: DraftMetadata;
  sections: DraftSections;
  lifecycle: ApiLifecycle;
  adapter: AdapterForm;
  codes: string[];
  employeeRequired: boolean;
  /** 119：调用性质、幂等字段（空串表示未配置）与 MCP 工具；老定义读取为会修改数据 / 未配置 / 未开放。 */
  operationKind: OperationKind;
  idempotencyField: string;
  mcpTool: McpToolDraft;
}

export const bindingShape = (value: unknown): value is Binding => {
  if (!value || typeof value !== "object") return false;
  const item = value as Binding;
  return (
    ["HTTP", "DUBBO"].includes(item.protocol) &&
    typeof item.timeoutMillis === "number" &&
    (item.protocol === "HTTP"
      ? Boolean(
          item.http &&
            (item.http.targetMode == null || ["URL", "SERVICE_NAME"].includes(item.http.targetMode)) &&
            (["url", "serviceName", "path", "sourceClass", "sourceMethod"] as const).every((field) => item.http![field] == null || typeof item.http![field] === "string") &&
            typeof item.http.method === "string",
        )
      : Boolean(
          item.dubbo &&
            typeof item.dubbo.interfaceName === "string" &&
            typeof item.dubbo.method === "string" &&
            Array.isArray(item.dubbo.parameterTypes) &&
            item.dubbo.parameterTypes.every((type) => typeof type === "string"),
        ))
  );
};
export const mappingsShape = (value: unknown): value is Mapping[] =>
  Array.isArray(value) &&
  value.length <= 100 &&
  value.every(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof item.target === "string" &&
      ["REQUEST", "FIXED", "CONTEXT"].includes(item.source) &&
      (item.path == null || typeof item.path === "string") &&
      (item.location == null || ["PATH", "QUERY", "BODY"].includes(item.location)),
  );
export const errorsShape = (value: unknown): value is { code: string; message: string }[] =>
  Array.isArray(value) && value.every((item) => item && typeof item.code === "string" && typeof item.message === "string");

export const tryParse = <T>(text: string, accepts: (value: unknown) => value is T): T | null => {
  try {
    const value = parseJson<unknown>(text);
    return accepts(value) ? value : null;
  } catch {
    return null;
  }
};
export const parseSchema = (text: string): SchemaNode | null => {
  try {
    const value = text ? parseJson<SchemaNode>(text) : null;
    return value && typeof value === "object" && value.type ? value : null;
  } catch {
    return null;
  }
};

/* --------------------------------- 分区 ---------------------------------- */

export type SectionKey = "basic" | "target" | "request" | "response" | "doc" | "mcp";
export const sections: { key: SectionKey; title: string }[] = [
  { key: "basic", title: "基本信息" },
  { key: "request", title: "请求参数" },
  { key: "target", title: "调用目标与映射" },
  { key: "response", title: "响应处理" },
  { key: "doc", title: "文档与错误" },
  { key: "mcp", title: "MCP 配置（可选）" },
];
export const sectionTitle = (key: SectionKey) => sections.find((item) => item.key === key)!.title;

/** 服务端字段路径或改动字段名 → 所属分区。 */
export function sectionOf(path: string): SectionKey {
  const root = path.replace(/^\//, "").split("/")[0];
  if (["binding", "mappings"].includes(root)) return "target";
  if (["requestSchema", "idempotencyField"].includes(root)) return "request";
  if (["responseSchema", "responseAdapter"].includes(root)) return "response";
  if (root === "mcpTool") return "mcp";
  if (["description", "errorDefinitions"].includes(root)) return "doc";
  return "basic";
}
/** 旧地址的步骤（对内配置 / 返回与文档）定位到单页中的分区。 */
export const legacyStepSection: Record<string, SectionKey> = { inner: "target", doc: "response" };

/* -------------------------------- 改动字段 -------------------------------- */

export function changedFields(content: DraftContent, baseline: DraftContent): string[] {
  const same = (a: unknown, b: unknown) => stringifyJson(a) === stringifyJson(b);
  return [
    ...(Object.keys(content.metadata) as (keyof DraftMetadata)[]).filter((key) => content.metadata[key] !== baseline.metadata[key]),
    ...(Object.keys(content.sections) as (keyof DraftSections)[]).filter((key) => content.sections[key] !== baseline.sections[key]),
    ...(same(content.lifecycle, baseline.lifecycle) ? [] : ["lifecycle"]),
    ...(same(content.adapter, baseline.adapter) ? [] : ["responseAdapter"]),
    ...(same(content.codes, baseline.codes) ? [] : ["scopeCodes"]),
    ...(content.employeeRequired === baseline.employeeRequired ? [] : ["employeeRequired"]),
    ...(content.operationKind === baseline.operationKind ? [] : ["operationKind"]),
    ...(content.idempotencyField === baseline.idempotencyField ? [] : ["idempotencyField"]),
    ...(same(content.mcpTool, baseline.mcpTool) ? [] : ["mcpTool"]),
  ];
}

/* -------------------------------- 建议完善 -------------------------------- */

export interface Suggestion {
  path: string;
  message: string;
}
const undocumented = (node: SchemaNode | null | undefined, prefix = ""): string[] =>
  Object.entries(node?.properties ?? {}).flatMap(([name, child]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    return [...(child.description?.trim() ? [] : [path]), ...undocumented(child, path), ...(child.items ? undocumented(child.items, `${path}[]`) : [])];
  });
const list = (names: string[]) => (names.length > 3 ? `${names.slice(0, 3).join("、")} 等 ${names.length} 个` : names.join("、"));

/** 不阻止保存的完善建议：让接入方读懂文档、让维护者能联系到人。 */
export function suggestions(content: DraftContent, ownerLinked: boolean): Suggestion[] {
  const result: Suggestion[] = [];
  const request = parseSchema(content.sections.requestSchema);
  const response = parseSchema(content.sections.responseSchema);
  if (!ownerLinked) result.push({ path: "/owner", message: "负责人只有名称，请选择具体人员，便于联系维护者" });
  if (!content.codes.length) result.push({ path: "/scopeCodes", message: "尚未选择调用权限组，调用方无法获准访问" });
  const requestMissing = undocumented(request);
  if (requestMissing.length) result.push({ path: "/requestSchema", message: `请求字段 ${list(requestMissing)} 缺少说明` });
  if (response && response.type === "OBJECT" && !Object.keys(response.properties ?? {}).length)
    result.push({ path: "/responseSchema", message: "响应结构还没有字段，接入方看不到返回内容" });
  const responseMissing = undocumented(response);
  if (responseMissing.length) result.push({ path: "/responseSchema", message: `响应字段 ${list(responseMissing)} 缺少说明` });
  if (response && response.example == null) result.push({ path: "/responseSchema", message: "还没有公开的响应示例，可在调试成功后选取" });
  if (!content.metadata.description.trim()) result.push({ path: "/description", message: "接口说明为空，建议写明用途、适用场景与限制" });
  return result;
}

/* -------------------------------- 本地暂存 -------------------------------- */

export const stashKey = (apiId: string, revision: number | string) => `op-api-draft:${apiId}:${stringifyJson(revision)}`;
export interface DraftStash {
  savedAt: number;
  content: DraftContent;
}
export function readStash(key: string): DraftStash | null {
  try {
    const value = parseJson<DraftStash>(window.sessionStorage.getItem(key) ?? "null");
    if (!(value && typeof value.savedAt === "number" && value.content?.metadata && value.content.sections)) return null;
    // 119 之前的暂存没有这三项，按老定义默认值补齐，避免误报为未保存修改。
    const stashed: Partial<DraftContent> = value.content;
    return { ...value, content: { operationKind: "MUTATION", idempotencyField: "", mcpTool: defaultMcpTool, ...stashed } as DraftContent };
  } catch {
    return null;
  }
}
export function writeStash(key: string, content: DraftContent) {
  try {
    window.sessionStorage.setItem(key, stringifyJson({ savedAt: Date.now(), content }));
  } catch {
    /* 存储不可用时只是不暂存。 */
  }
}
export function clearStash(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** 与生效版本比较时按分区计数差异（只比较对外有意义的内容）。 */
export function sectionDiffs(current: Record<string, unknown>, live: Record<string, unknown>): SectionKey[] {
  const keys: Record<SectionKey, string[]> = {
    basic: ["name", "category", "owner", "scopeCodes", "employeeRequired", "operationKind", "lifecycle"],
    target: ["binding", "mappings"],
    request: ["requestSchema", "idempotencyField"],
    response: ["responseSchema", "responseAdapter"],
    doc: ["description", "errorDefinitions"],
    mcp: ["mcpTool"],
  };
  const normalize = (value: unknown) => stringifyJson(value ?? null);
  return (Object.keys(keys) as SectionKey[]).filter((section) => keys[section].some((key) => normalize(current[key]) !== normalize(live[key])));
}

/** HTTP 方法变化时调整映射位置；只转换规范化模型，原文无效或非规范时不改写。 */
export function repositionMappings(
  bindingText: string,
  previous: Binding,
  mappingsText: string,
  saved: { mappings: unknown; binding: unknown },
): string | undefined {
  try {
    const value = parseJson(bindingText);
    const mappings = parseJson(mappingsText);
    if (
      !bindingShape(value) ||
      previous.protocol !== "HTTP" ||
      value.protocol !== "HTTP" ||
      previous.http?.method === value.http?.method ||
      !mappingsShape(mappings) ||
      mappingsText !== stringify(mappings)
    )
      return undefined;
    return stringify(
      switchHttpMethodMappings(
        mappings,
        previous.http?.method ?? "POST",
        value.http?.method ?? "POST",
        mappingsShape(saved.mappings) ? saved.mappings : [],
        bindingShape(saved.binding) ? saved.binding.http?.method : undefined,
      ),
    );
  } catch {
    return undefined; // 原文无效时保留全部输入，等待严格校验。
  }
}

/**
 * 页面内容 → 保存 / 校验请求正文。原始 JSON 片段（结构、绑定、映射、错误）原样拼入，
 * 交由服务端严格解析，不丢重复键与大数精度；expectedRevision 为 null 时省略。
 */
export function requestBody(content: DraftContent, expectedRevision: ApiDefinition["draftRevision"] | null): string {
  const { metadata } = content;
  const fields = {
    ...metadata,
    service: metadata.service.trim(),
    version: metadata.version.trim(),
    method: metadata.method.trim(),
    name: metadata.name.trim(),
    category: metadata.category.trim(),
    owner: metadata.owner.trim(),
    scopeCodes: content.codes,
    employeeRequired: content.employeeRequired,
    operationKind: content.operationKind,
    // 空串表示明确清除；省略会被服务端视为未携带。
    idempotencyField: content.idempotencyField.trim(),
    mcpTool: { enabled: content.mcpTool.enabled, aiDescription: content.mcpTool.aiDescription.trim() ? content.mcpTool.aiDescription : null },
    responseAdapter: responseAdapter(content.adapter),
    lifecycle: content.lifecycle,
    ...(expectedRevision === null ? {} : { expectedRevision }),
  };
  return `{${stringifyJson(fields).slice(1, -1)},${Object.entries(content.sections)
    .map(([key, text]) => `${JSON.stringify(key)}:${text.trim() ? text : "null"}`)
    .join(",")}}`;
}

/** 已保存定义 → 页面可编辑内容。 */
export const contentOf = (definition: ApiDefinition): DraftContent => ({
  metadata: {
    service: definition.service ?? "",
    version: definition.version ?? "1.0",
    method: definition.method ?? "",
    name: definition.name ?? "",
    category: definition.category ?? "",
    owner: definition.owner ?? "",
    description: definition.description ?? "",
  },
  sections: {
    requestSchema: stringify(definition.requestSchema ?? emptyRequest),
    responseSchema: definition.responseSchema ? stringify(definition.responseSchema) : "",
    binding: stringify(definition.binding ?? newBinding("HTTP")),
    mappings: stringify(definition.mappings ?? []),
    errorDefinitions: stringify(definition.errorDefinitions ?? []),
  },
  lifecycle: definition.lifecycle ?? defaultLifecycle,
  adapter: adapterForm(definition.responseAdapter),
  codes: definition.scopeCodes ?? [],
  employeeRequired: definition.employeeRequired === true,
  operationKind: definition.operationKind === "QUERY" ? "QUERY" : "MUTATION",
  idempotencyField: definition.idempotencyField ?? "",
  mcpTool: { enabled: definition.mcpTool?.enabled === true, aiDescription: definition.mcpTool?.aiDescription ?? "" },
});

/* ------------------------------ 尚未创建的草稿 ------------------------------ */

/**
 * 尚未创建的草稿：
 * - copy：从固定来源快照复制，保存时以幂等创建键调用 /api-copies，结果未知时先查询原结果；
 * - candidate：导入候选，只做只读校验，确认后把完整正文交回导入批次，不创建草稿。
 * 二者都没有服务端修订、本地暂存与修订冲突。
 */
export type DraftCreation =
  | { kind: "copy"; copy: ApiCopyDraft }
  | { kind: "candidate"; onPrepared: (bodyText: string) => boolean | void | Promise<boolean | void> };

/** 复制预填或导入候选在页面上以占位定义承载：没有 id，修订为 0，协议取自绑定。 */
export const placeholderDefinition = (initial: Partial<ApiDefinition>): ApiDefinition =>
  ({
    ...initial,
    id: "",
    draftRevision: 0,
    protocol: bindingShape(initial.binding) ? initial.binding.protocol : initial.protocol ?? "HTTP",
  }) as ApiDefinition;

/** 导入候选在请求服务端前一次列出已知必填缺项（候选只做只读校验，不创建草稿）。 */
export function missingCandidateFields(metadata: DraftMetadata, responseSchemaText: string): FieldIssue[] {
  const labels = [
    ["service", "服务标识"],
    ["version", "外部版本"],
    ["method", "操作标识"],
    ["name", "接口名称"],
    ["category", "分类"],
    ["owner", "负责人"],
  ] as const;
  const issues: FieldIssue[] = labels
    .filter(([key]) => !metadata[key].trim() || (key === "owner" && !isOwnerReference(metadata.owner)))
    .map(([key, label]) => ({ path: `/${key}`, reason: "REQUIRED", message: `请填写${label}` }));
  const response = responseSchemaText.trim();
  if (!response || response === "null") issues.push({ path: "/responseSchema", reason: "REQUIRED", message: "请补充真实响应结构" });
  return issues;
}
