import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import { parseJson } from "@cyl/open-platform-web-shared/json";
import type { Binding } from "../BindingEditor";
import type { Mapping } from "../SchemaEditor";
import { argumentKind, proposeMappings } from "../defaultMappings";
import { parseDubboSignature } from "../dubboSignature";
import { hasJsonBody, httpTemplate } from "../httpMapping";
import { inferSampleSchema } from "../sampleSchema";

/**
 * 110 快速创建：只收集让草稿合法的最少信息，其余用合法默认值补齐，
 * 生成与手工编辑器完全相同结构的完整定义（后端校验不放宽）。
 */

export type QuickSource = "curl" | "http" | "dubbo" | "dubbo-blank" | "example-http" | "example-dubbo";
export const quickSources: QuickSource[] = ["curl", "http", "dubbo", "dubbo-blank", "example-http", "example-dubbo"];
export type CreateSource = QuickSource | "openapi" | "json" | "copy";
export const createSources: CreateSource[] = [...quickSources, "openapi", "json", "copy"];
export const isQuickSource = (value: unknown): value is QuickSource => quickSources.includes(value as QuickSource);

export const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof httpMethods)[number];

export interface QuickForm {
  protocol: "HTTP" | "DUBBO";
  httpTargetMode: "URL" | "SERVICE_NAME";
  httpMethod: HttpMethod;
  url: string;
  serviceName: string;
  path: string;
  signature: string;
  connectionId: string | null;
  connectionRevision: number | null;
  providerApplication: string;
  dubboVersion: string;
  dubboGroup: string;
  name: string;
  category: string;
  owner: string;
  service: string;
  method: string;
  version: string;
  /** 用户改过对外标识后不再自动推导。 */
  identityEdited: boolean;
  requestSample: string;
  responseSample: string;
}

export const emptyForm = (protocol: QuickForm["protocol"] = "HTTP"): QuickForm => ({
  protocol,
  httpTargetMode: "URL",
  httpMethod: "POST",
  url: "",
  serviceName: "",
  path: "",
  signature: "",
  connectionId: null,
  connectionRevision: null,
  providerApplication: "",
  dubboVersion: "",
  dubboGroup: "",
  name: "",
  category: "",
  owner: "",
  service: "",
  method: "",
  version: "v1",
  identityEdited: false,
  requestSample: "",
  responseSample: "",
});

export const exampleForm = (protocol: QuickForm["protocol"]): QuickForm =>
  protocol === "HTTP"
    ? {
        ...emptyForm("HTTP"),
        httpMethod: "POST",
        url: "http://order-service.example/internal/orders/{orderNo}/detail",
        name: "查询订单详情（示例）",
        service: "order",
        method: "detail",
        requestSample: '{\n  "includeItems": true\n}',
        responseSample: '{\n  "orderNo": "A202610010001",\n  "status": "PAID",\n  "amount": 128.5\n}',
      }
    : {
        ...emptyForm("DUBBO"),
        signature: "com.example.order.api.OrderQueryFacade#queryOrder(java.lang.String)",
        name: "按订单号查询订单（示例）",
        service: "order_query",
        method: "query_order",
        responseSample: '{\n  "orderNo": "A202610010001",\n  "status": "PAID"\n}',
      };

/* ------------------------------ 标识推导 ------------------------------- */

/** 转为对外标识规则 `[a-z][a-z0-9_]{0,63}`：驼峰与短横线转蛇形，去掉开头的非字母。 */
export function toIdentifier(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 64)
    .replace(/_+$/, "");
}

const genericWords = new Set([
  "www", "api", "apis", "gateway", "gw", "internal", "inner", "intra", "open", "openapi", "rest", "rpc", "http", "https",
  "service", "services", "svc", "server", "srv", "app", "web", "backend", "provider", "center", "centre",
  "localhost", "com", "cn", "net", "org", "io", "local", "example", "test", "dev", "prod", "pre", "uat", "sit",
]);
const versionSegment = /^v\d+(?:\.\d+)*$/i;

const meaningfulWords = (label: string) =>
  label
    .split(/[-_]/)
    .map((word) => word.toLowerCase())
    .filter((word) => word && !genericWords.has(word) && !/^\d+$/.test(word));

const pathSegments = (path: string) =>
  path
    .split("?")[0]
    .split("/")
    .filter((segment) => segment && !/[{}]/.test(segment) && !versionSegment.test(segment) && !genericWords.has(segment.toLowerCase()));

/** HTTP：service 取主机或服务名的业务段，method 取路径最后一个非变量段。 */
export function deriveHttpIdentity(form: Pick<QuickForm, "httpTargetMode" | "url" | "serviceName" | "path">) {
  let host = "";
  let path = "";
  if (form.httpTargetMode === "SERVICE_NAME") {
    host = form.serviceName.trim();
    path = form.path.trim();
  } else {
    const match = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(form.url.trim());
    if (match) {
      host = match[1].replace(/:\d+$/, "");
      path = match[2];
    }
  }
  const segments = pathSegments(path);
  const ip = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
  const labels = ip ? [] : host.split(".");
  const hostWords = labels.map(meaningfulWords).find((words) => words.length) ?? [];
  const service = toIdentifier(hostWords.join("_")) || (segments.length > 1 ? toIdentifier(segments[0]) : "");
  const method = segments.length ? toIdentifier(segments[segments.length - 1]) : "";
  return { service, method };
}

const facadeSuffix = /(?:Facade|ServiceApi|Service|Api|API|Rpc|RPC|Provider|Remote|Client|Interface)$/;

/** Dubbo：service 取接口简名去掉 Facade/Service 等后缀，method 取方法名的蛇形。 */
export function deriveDubboIdentity(interfaceName: string, method: string) {
  const simple = interfaceName.split(".").pop() ?? "";
  const base = simple.replace(/^I(?=[A-Z][a-z])/, "").replace(facadeSuffix, "") || simple;
  return { service: toIdentifier(base), method: toIdentifier(method) };
}

export function deriveIdentity(form: QuickForm) {
  if (form.protocol === "HTTP") return deriveHttpIdentity(form);
  try {
    const signature = parseDubboSignature(form.signature);
    return deriveDubboIdentity(signature.interfaceName, signature.method);
  } catch {
    return { service: "", method: "" };
  }
}

/** 当前地址中的路径变量；地址不完整时返回空。 */
export function httpPathVariables(form: Pick<QuickForm, "httpTargetMode" | "url" | "path">) {
  try {
    const url = form.httpTargetMode === "SERVICE_NAME" ? `http://discovery.invalid${form.path.trim()}` : form.url.trim();
    return httpTemplate(url).names;
  } catch {
    return [];
  }
}

/* ------------------------------ 生成定义 ------------------------------- */

export type QuickField =
  | "name" | "category" | "owner" | "service" | "method" | "version"
  | "url" | "serviceName" | "path" | "httpMethod"
  | "signature" | "connection" | "providerApplication" | "dubboVersion" | "dubboGroup"
  | "requestSample" | "responseSample";

export class QuickFieldError extends Error {
  constructor(readonly field: QuickField, message: string) {
    super(message);
  }
}

const emptyObject = (): SchemaNode => ({ type: "OBJECT", properties: {} });

function sampleSchema(text: string, request: boolean, field: QuickField) {
  if (!text.trim()) return { schema: null, excluded: [] as string[] };
  let value: unknown;
  try {
    value = parseJson(text);
  } catch {
    throw new QuickFieldError(field, "不是合法的 JSON，请检查引号、逗号与括号。");
  }
  try {
    const result = inferSampleSchema(value, request);
    if (result.questions.length)
      throw new Error(`${result.questions[0].path.replace(/^\$\.?/, "") || "根节点"} 为 null 或空数组，无法确定类型；请换成代表性的值。`);
    return { schema: result.schema, excluded: result.excluded };
  } catch (failure) {
    throw new QuickFieldError(field, (failure as Error).message);
  }
}

export interface QuickDefinition {
  service: string;
  version: string;
  method: string;
  name: string;
  category: string;
  owner: string;
  description: string;
  scopeCodes: string[];
  employeeRequired: boolean;
  responseAdapter: { mode: "DIRECT" };
  requestSchema: SchemaNode;
  responseSchema: SchemaNode;
  binding: Binding;
  mappings: Mapping[];
  errorDefinitions: [];
}

/** 由快速创建表单生成完整草稿；notes 是保存后建议在配置页完善的事项（非阻断）。 */
export function buildDefinition(form: QuickForm): { definition: QuickDefinition; notes: string[] } {
  const notes: string[] = [];
  const request = sampleSchema(form.requestSample, true, "requestSample");
  const response = sampleSchema(form.responseSample, false, "responseSample");
  if (request.excluded.length) notes.push(`请求样例中的身份字段 ${request.excluded.map((path) => path.replace(/^\$\./, "")).join("、")} 已移除，身份由平台注入。`);
  const requestSchema: SchemaNode = request.schema ?? emptyObject();
  requestSchema.properties ??= {};
  const responseSchema = response.schema ?? emptyObject();
  if (!response.schema) notes.push("尚未提供响应样例，返回结构为空对象；建议在配置页补充响应字段。");
  let binding: Binding;
  let mappings: Mapping[] = [];
  if (form.protocol === "HTTP") {
    const serviceMode = form.httpTargetMode === "SERVICE_NAME";
    const field: QuickField = serviceMode ? "path" : "url";
    let template: ReturnType<typeof httpTemplate>;
    try {
      template = httpTemplate(serviceMode ? `http://discovery.invalid${form.path.trim()}` : form.url.trim());
    } catch (failure) {
      throw new QuickFieldError(field, (failure as Error).message);
    }
    binding = {
      protocol: "HTTP",
      timeoutMillis: 3000,
      http: serviceMode
        ? { targetMode: "SERVICE_NAME", serviceName: form.serviceName.trim(), path: form.path.trim(), url: null, method: form.httpMethod }
        : { targetMode: "URL", url: form.url.trim(), method: form.httpMethod },
    };
    const properties = requestSchema.properties!;
    for (const name of template.names) {
      const existing = properties[name];
      if (existing && ["OBJECT", "ARRAY"].includes(existing.type))
        throw new QuickFieldError("requestSample", `路径参数 ${name} 在请求样例中不是单个值，请改为文本或数字。`);
      if (!existing) properties[name] = { type: "STRING", required: true };
      mappings.push({ target: name, source: "REQUEST", path: name, location: "PATH" });
    }
    const fixedQuery = new Set(new URLSearchParams(template.query).keys());
    const location = hasJsonBody(form.httpMethod) ? "BODY" : "QUERY";
    for (const name of Object.keys(properties)) {
      if (template.names.includes(name)) continue;
      if (location === "QUERY" && fixedQuery.has(name)) {
        notes.push(`字段 ${name} 与地址中的固定查询参数同名，未自动映射。`);
        continue;
      }
      mappings.push({ target: name, source: "REQUEST", path: name, location });
    }
  } else {
    let signature: ReturnType<typeof parseDubboSignature>;
    try {
      signature = parseDubboSignature(form.signature);
    } catch (failure) {
      throw new QuickFieldError("signature", (failure as Error).message);
    }
    if (!form.connectionId || form.connectionRevision == null) throw new QuickFieldError("connection", "请选择注册中心连接。");
    binding = {
      protocol: "DUBBO",
      timeoutMillis: 3000,
      dubbo: {
        ...signature,
        version: form.dubboVersion.trim(),
        group: form.dubboGroup.trim(),
        connectionId: form.connectionId,
        connectionRevision: form.connectionRevision,
        providerApplication: form.providerApplication.trim() || null,
      },
    };
    const types = signature.parameterTypes;
    const objectKind = (type: string) => argumentKind(type).includes("OBJECT") || argumentKind(type).includes("ARRAY");
    if (!request.schema) {
      // 无请求样例：标量参数按顺序生成 argN 请求字段并映射；对象参数留待配置页完善。
      types.forEach((type, index) => {
        const target = `arg${index}`;
        if (objectKind(type)) {
          notes.push(`${target}（${type.split(".").pop()}）是对象参数，尚未映射；可补充请求样例或在配置页完善。`);
          return;
        }
        requestSchema.properties![target] = { type: argumentKind(type)[0], required: true };
        mappings.push({ target, source: "REQUEST", path: target });
      });
    } else {
      const selections: Record<string, string> = {};
      if (types.length === 1 && argumentKind(types[0]).includes("OBJECT")) selections.arg0 = "$";
      types.forEach((type, index) => {
        const field = requestSchema.properties![`arg${index}`];
        if (field && argumentKind(type).includes(field.type)) selections[`arg${index}`] = `arg${index}`;
      });
      const proposed = proposeMappings(requestSchema, binding, selections);
      mappings = proposed.mappings;
      for (const target of proposed.pending) notes.push(`${target} 尚未映射到请求字段，请在配置页完善参数映射。`);
    }
  }
  return {
    definition: {
      service: form.service.trim(),
      version: form.version.trim(),
      method: form.method.trim(),
      name: form.name.trim(),
      category: form.category.trim(),
      owner: form.owner.trim(),
      description: "",
      scopeCodes: [],
      employeeRequired: false,
      responseAdapter: { mode: "DIRECT" },
      requestSchema,
      responseSchema,
      binding,
      mappings,
      errorDefinitions: [],
    },
    notes,
  };
}

/** 服务端字段路径 → 快速创建表单字段；无法定位的返回 null。 */
export function fieldForPath(path: string): QuickField | null {
  const direct: Record<string, QuickField> = {
    "/name": "name", "/category": "category", "/owner": "owner",
    "/service": "service", "/method": "method", "/version": "version",
    "/binding/http/url": "url", "/binding/http/serviceName": "serviceName", "/binding/http/path": "path", "/binding/http/method": "httpMethod",
    "/binding/dubbo/connectionId": "connection", "/binding/dubbo/connectionRevision": "connection",
    "/binding/dubbo/providerApplication": "providerApplication", "/binding/dubbo/version": "dubboVersion", "/binding/dubbo/group": "dubboGroup",
  };
  if (direct[path]) return direct[path];
  if (path.startsWith("/binding/dubbo")) return "signature";
  if (path.startsWith("/requestSchema")) return "requestSample";
  if (path.startsWith("/responseSchema")) return "responseSample";
  return null;
}

/** 本地暂存（sessionStorage）：不保存原始 cURL 文本等可能含秘密的输入。 */
export const draftKey = (source: string) => `op-quick-create:${source}`;
export interface StoredQuickDraft {
  savedAt: number;
  form: QuickForm;
}
export function readQuickDraft(source: string): StoredQuickDraft | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(draftKey(source)) ?? "null");
    if (!value || typeof value.savedAt !== "number" || typeof value.form !== "object") return null;
    return { savedAt: value.savedAt, form: { ...emptyForm(value.form.protocol === "DUBBO" ? "DUBBO" : "HTTP"), ...value.form } };
  } catch {
    return null;
  }
}
export function writeQuickDraft(source: string, form: QuickForm) {
  try {
    window.sessionStorage.setItem(draftKey(source), JSON.stringify({ savedAt: Date.now(), form }));
  } catch {
    /* 存储不可用时只是不暂存。 */
  }
}
export function clearQuickDraft(source: string) {
  try {
    window.sessionStorage.removeItem(draftKey(source));
  } catch {
    /* ignore */
  }
}
export const isBlankForm = (form: QuickForm) => {
  const blank = emptyForm(form.protocol);
  return (Object.keys(blank) as (keyof QuickForm)[]).every((key) => key === "owner" || form[key] === blank[key]);
};
