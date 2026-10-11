import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import SchemaView from "@cyl/open-platform-web-shared/documentation/SchemaView";
import { Button } from "antd";
import { useEffect, useState } from "react";
import {
  stringifyJson,
  decimalContent,
} from "@cyl/open-platform-web-shared/json";
import type { ApiDefinition } from "../catalog/CatalogPanel";
import type { AdminApi } from "../access/api";
import { publicationDisplay } from "./publicationDisplay";
import { responseSchemaSuggestion } from "../catalog/responseSchemaGuidance";
import { adapterForm } from "../catalog/ResponseAdapterEditor";
import { isOwnerReference } from "../catalog/CatalogReferenceFields";
import type { OperationKind } from "../catalog/workspace/draftModel";
import { operationKindNames } from "../catalog/workspace/mcpTool";
import "./diff.css";
import type { EmployeeProfileOption } from "@cyl/open-platform-web-shared/employees/EmployeeProfileSearch";

export type PublicationField = Exclude<
  keyof ApiDefinition,
  | "id"
  | "draftRevision"
  | "liveDraftRevision"
  | "hasUnpublishedChanges"
  | "enabled"
  | "pendingReleaseId"
>;
/** 发布内容字段 → [业务分组, 字段名]；差异与固定快照按同一分组阅读。 */
export const publicationFields = {
  service: ["基本信息", "服务标识"],
  version: ["基本信息", "外部版本"],
  method: ["基本信息", "操作标识"],
  owner: ["基本信息", "负责人"],
  name: ["基本信息", "接口名称"],
  category: ["基本信息", "展示分类"],
  employeeRequired: ["调用身份要求", "必须指定调用员工"],
  operationKind: ["调用性质", "调用性质"],
  scopeCodes: ["调用权限", "API绑定的权限组"],
  requestSchema: ["请求参数", "请求结构"],
  idempotencyField: ["请求参数", "幂等字段"],
  protocol: ["内部服务", "内部协议"],
  binding: ["内部服务", "内部绑定"],
  mappings: ["参数映射", "取值规则"],
  responseAdapter: ["返回处理", "提供方返回规则"],
  responseSchema: ["响应与示例", "响应结构"],
  errorDefinitions: ["错误说明", "业务错误"],
  description: ["基本信息", "接口说明"],
  lifecycle: ["维护声明", "生命周期"],
  mcpTool: ["MCP 工具", "MCP 工具"],
} satisfies Record<PublicationField, readonly [string, string]>;
export const publicationFieldNames: Record<string, string> = {
  type: "类型",
  description: "说明",
  required: "必填",
  nullable: "允许 null",
  mode: "处理方式",
  successPath: "成功字段",
  successValues: "成功值",
  dataPath: "业务数据路径",
  messagePath: "失败消息路径",
  items: "数组元素",
  properties: "字段",
  defaultValue: "默认值",
  example: "示例",
  enumValues: "可选值",
  $order: "字段展示顺序",
  http: "HTTP",
  dubbo: "Dubbo",
  url: "地址",
  targetMode: "目标方式",
  serviceName: "服务名",
  sourceClass: "来源类",
  sourceMethod: "来源方法",
  providerApplication: "提供方应用",
  location: "参数位置",
  method: "方法",
  protocol: "协议",
  timeoutMillis: "最长等待毫秒数",
  interfaceName: "接口全限定名",
  version: "内部版本",
  group: "服务组",
  parameterTypes: "参数类型（按顺序）",
  connectionId: "服务连接编号",
  connectionRevision: "连接修订",
  target: "目标参数",
  source: "取值来源",
  path: "来源字段",
  value: "固定值",
  code: "错误码",
  message: "对外说明",
  status: "维护状态",
  compatibility: "兼容性",
  compatibilityNotes: "兼容说明",
  deprecationNotice: "迁移提示",
  replacementVersion: "替代版本",
  sunsetDate: "计划退役日期",
  enabled: "可作为 MCP 工具",
  aiDescription: "面向 AI 的用途说明",
};
/** 老快照缺省按会修改数据、未开放 MCP 处理。 */
const mcpToolOf = (definition: ApiDefinition | null) => ({
  enabled: definition?.mcpTool?.enabled === true,
  aiDescription: definition?.mcpTool?.aiDescription ?? null,
});
interface Change {
  path: string;
  before: unknown;
  after: unknown;
}
type ScopeLabels = Record<string, { name: string; enabled: boolean }>;
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !(
    JSON as typeof JSON & { isRawJSON?: (value: unknown) => boolean }
  ).isRawJSON?.(value);

/** 与后端十进制内容比较一致：不经浮点数转换，也不展开科学计数。 */
/** 发布内容接缝：权限组无序；字段展示和数组有序；普通JSON键顺序无语义。 */
export function publicationChanges(
  before: ApiDefinition | null,
  after: ApiDefinition,
): Change[] {
  const changes: Change[] = [];
  const visit = (baseline: unknown, candidate: unknown, path: string) => {
    if (
      baseline === candidate ||
      (baseline !== undefined &&
        candidate !== undefined &&
        stringifyJson(baseline) === stringifyJson(candidate))
    )
      return;
    const baselineNumber = decimalContent(baseline);
    if (baselineNumber !== null && baselineNumber === decimalContent(candidate))
      return;
    if (
      isObject(baseline) &&
      isObject(candidate) &&
      Array.isArray(baseline) === Array.isArray(candidate)
    ) {
      const oldKeys = Object.keys(baseline),
        newKeys = Object.keys(candidate);
      const sharedOld = oldKeys.filter((key) => key in candidate),
        sharedNew = newKeys.filter((key) => key in baseline);
      // Schema字段名禁止点号；示例/默认值中的普通properties不承载字段展示顺序。
      if (
        /^(requestSchema|responseSchema)(?:\.properties\.[^.]+|\.items)*\.properties$/.test(
          path,
        ) &&
        sharedOld.some((key, index) => key !== sharedNew[index])
      ) {
        changes.push({
          path: `${path}.$order`,
          before: oldKeys,
          after: newKeys,
        });
      }
      for (const key of new Set([...oldKeys, ...newKeys]))
        visit(baseline[key], candidate[key], `${path}.${key}`);
    } else changes.push({ path, before: baseline, after: candidate });
  };
  for (const key of Object.keys(publicationFields) as PublicationField[]) {
    if (key === "scopeCodes") {
      const baseline = before
        ? [...(before.scopeCodes ?? [])].sort()
        : undefined;
      const candidate = [...(after.scopeCodes ?? [])].sort();
      if (stringifyJson(baseline ?? []) !== stringifyJson(candidate))
        changes.push({ path: key, before: baseline, after: candidate });
    } else if (key === "employeeRequired")
      visit(
        before?.employeeRequired === true,
        after.employeeRequired === true,
        key,
      );
    else if (key === "operationKind")
      visit(before?.operationKind ?? "MUTATION", after.operationKind ?? "MUTATION", key);
    else if (key === "idempotencyField")
      visit(before?.idempotencyField ?? null, after.idempotencyField ?? null, key);
    else if (key === "mcpTool") visit(mcpToolOf(before), mcpToolOf(after), key);
    else visit(before?.[key], after[key], key);
  }
  return changes;
}

export default function PublicationDiff({
  api,
  before,
  after,
  beforeLabel,
  afterLabel,
  emptyLabel = "已保存草稿与生效快照没有差异",
}: {
  api?: AdminApi;
  before: ApiDefinition | null;
  after: ApiDefinition;
  beforeLabel: string;
  afterLabel: string;
  emptyLabel?: string;
}) {
  const changes = publicationChanges(before, after);
  const schemaSuggestion = after.responseSchema ? responseSchemaSuggestion(adapterForm(after.responseAdapter), stringifyJson(after.responseSchema)) : null;
  const [owners, setOwners] = useState<Record<string, EmployeeProfileOption>>({});
  const ownerIds = JSON.stringify([...new Set([before?.owner, after.owner].filter((id): id is string => !!id && isOwnerReference(id)))]);
  useEffect(() => {
    setOwners({});
    if (!api) return;
    const controller = new AbortController();
    // 固定两份快照最多两个负责人，名称仅作当前展示，差异仍比较稳定 ID。
    void Promise.all((JSON.parse(ownerIds) as string[]).map(async id => {
      try {
        const profile = await api<EmployeeProfileOption>(`/apis/owners/${encodeURIComponent(id)}`, { signal: controller.signal });
        return profile?.id === id ? [id, profile] as const : null;
      } catch { return null; }
    })).then(values => {
      if (!controller.signal.aborted) setOwners(Object.fromEntries(values.filter(value => value !== null)));
    });
    return () => controller.abort();
  }, [api, ownerIds]);
  const [labels, setLabels] = useState<{
    codesKey: string;
    values: ScopeLabels;
  }>({ codesKey: "", values: {} });
  const [labelsError, setLabelsError] = useState("");
  const [retry, setRetry] = useState(0);
  const codesKey = JSON.stringify(
    [
      ...new Set([...(before?.scopeCodes ?? []), ...(after.scopeCodes ?? [])]),
    ].sort(),
  );
  useEffect(() => {
    if (!api || codesKey === "[]") return;
    const controller = new AbortController();
    setLabelsError("");
    void api<ScopeLabels>("/publications/scope-labels", {
      method: "POST",
      body: { codes: JSON.parse(codesKey) },
      signal: controller.signal,
    })
      .then((values) => {
        if (!controller.signal.aborted) setLabels({ codesKey, values });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLabelsError(error.message);
      });
    return () => controller.abort();
  }, [api, codesKey, retry]);
  const currentLabels = labels.codesKey === codesKey ? labels.values : {};
  const scopeList = (codes: string[], kind: "added" | "removed") =>
    codes.length ? (
      <ul className={`scope-changes ${kind}`}>
        {codes.map((code) => (
          <li key={code}>
            <span className={`tag ${kind === "removed" ? "bad" : ""}`}>
              {kind === "added" ? "新增" : "移除"}
            </span>
            {currentLabels[code] ? (
              <>
                <strong>{currentLabels[code].name}</strong>
                {!currentLabels[code].enabled && (
                  <span className="muted">（当前已停用）</span>
                )}
              </>
            ) : (
              <span className="muted">以代码为准</span>
            )}
            <code>{code}</code>
          </li>
        ))}
      </ul>
    ) : (
      <span className="muted">无{kind === "added" ? "新增" : "移除"}</span>
    );
  const safeBefore = publicationDisplay(before),
    safeAfter = publicationDisplay(after);
  const safeValue = (change: Change, side: "before" | "after") => {
    const safeRoot = side === "before" ? safeBefore : safeAfter;
    return change.path.endsWith(".$order")
      ? change[side]
      : change.path
          .split(".")
          .reduce<unknown>(
            (current, key) => (isObject(current) ? current[key] : undefined),
            safeRoot,
          );
  };
  const displayValue = (change: Change, side: "before" | "after") => {
    if (change.path === "employeeRequired")
      return change[side] === true
        ? "开启：必须有完整有效人员委托"
        : "关闭：允许租户级或人员级调用";
    if (change.path === "operationKind") return operationKindNames[change[side] as OperationKind] ?? String(change[side]);
    if (change.path === "mcpTool.enabled") return change[side] === true ? "开启" : "关闭";
    if (change[side] === null && ["idempotencyField", "mcpTool.aiDescription"].includes(change.path)) return "未配置";
    if (change[side] === undefined)
      return side === "before"
        ? before
          ? "未设置"
          : "无原配置"
        : "已移除";
    const value = safeValue(change, side);
    return value === undefined
      ? "[已隐藏]"
      : typeof value === "string"
        ? value || "空字符串"
        : stringifyJson(value);
  };
  const renderValue = (change: Change, side: "before" | "after") => {
    const value = change[side];
    if (change.path === "owner" && typeof value === "string" && owners[value]) {
      const person = owners[value];
      return <span title={`当前人员名称；快照人员引用 ID：${value}`}>{person.displayName} · 工号 {person.employeeNo}</span>;
    }
    // 只识别真正的Schema节点；默认值/示例中的同名JSON仍按原值展示。
    if (
      value &&
      typeof value === "object" &&
      "type" in value &&
      /^(requestSchema|responseSchema)(\.properties\.[^.]+|\.items)*$/.test(
        change.path,
      )
    ) {
      return (
        <SchemaView
          title={
            change.path.startsWith("requestSchema") ? "请求结构" : "响应结构"
          }
          schema={safeValue(change, side) as SchemaNode}
          showRawSchema={false}
        />
      );
    }
    return value != null && typeof value === "object" ? (
      <pre className="code">{displayValue(change, side)}</pre>
    ) : (
      <span className="diff-scalar">{displayValue(change, side)}</span>
    );
  };
  return (
    <div className="publication-diff">
      {schemaSuggestion && <p className="response-schema-guidance" role="status">请核对返回结构：规则取出 {schemaSuggestion.path}，公开结构仍可能包含外层成功码。请在返回配置中确认业务数据结构后再继续。</p>}
      {!before && <p className="diff-intro">以下为本次新增配置</p>}
      {!changes.length && (
        <p className="empty" role="status">
          {emptyLabel}
        </p>
      )}
      {[
        ...new Set(
          changes.map(
            (change) => publicationFields[change.path.split(".")[0] as PublicationField][0],
          ),
        ),
      ].map((group) => (
        <section className="diff-group" key={group} aria-label={`${group}变更`}>
          <h3>{group}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>变更字段</th>
                  {before && <th>{beforeLabel}</th>}
                  <th>{afterLabel}</th>
                </tr>
              </thead>
              <tbody>
                {changes
                  .filter(
                    (change) =>
                      publicationFields[change.path.split(".")[0] as PublicationField][0] ===
                      group,
                  )
                  .map((change) => {
                    const parts = change.path.split(".");
                    const label = [
                      publicationFields[parts[0] as PublicationField][1],
                      ...parts
                        .slice(1)
                        .map((part, index) =>
                          parts[index] === "properties"
                            ? `字段 ${part}`
                            : /^\d+$/.test(part)
                              ? `第${Number(part) + 1}项`
                              : (publicationFieldNames[part] ?? part),
                        ),
                    ].join(" / ");
                    return (
                      <tr key={change.path}>
                        <td>
                          <strong>{label}</strong>
                          <small>
                            {change.before === undefined
                              ? "新增"
                              : change.after === undefined
                                ? "移除"
                                : "修改"}
                          </small>
                        </td>
                        {change.path === "scopeCodes" ? (
                          <>
                            {before && (
                              <td>
                                {scopeList(
                                  (before.scopeCodes ?? []).filter(
                                    (code) =>
                                      !(after.scopeCodes ?? []).includes(code),
                                  ),
                                  "removed",
                                )}
                              </td>
                            )}
                            <td>
                              {scopeList(
                                (after.scopeCodes ?? []).filter(
                                  (code) =>
                                    !(before?.scopeCodes ?? []).includes(code),
                                ),
                                "added",
                              )}
                            </td>
                          </>
                        ) : (
                          <>
                            {before && <td>{renderValue(change, "before")}</td>}
                            <td>{renderValue(change, "after")}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {group === "调用身份要求" && (
            <p className="diff-explanation">
              开启后，原租户级 Token
              和未指定员工的签名不能调用此接口；关闭后允许租户级调用。不会改变已有
              Token 的主体或其他授权。
            </p>
          )}
          {group === "调用权限" && (
            <div className="diff-explanation">
              <p>
                新增组可能使持有该启用组的有效凭据获得此API调用资格；移除组后仍可能通过其他组获准。具备凭据管理权限时可在影响查询中核对候选；候选不代表实际调用客户。
              </p>
              <details>
                <summary>为什么需要审核？与凭据授权有什么区别？</summary>
                <p>
                  这里改变API绑定的权限范围，随固定发布快照审核。修改权限组定义、启停或AK获授范围是独立授权操作，不属于本次API发布。新凭据默认授予设置不会追补旧凭据。
                </p>
              </details>
              <p className="muted">
                名称和停用状态为当前辅助资料，历史内容以固定代码为准；名称未查到时仍保留代码。
              </p>
              {labelsError && (
                <p role="status" className="muted">
                  权限组名称暂不可用，已按代码显示，差异内容不受影响。
                  <Button
                    type="link"
                    size="small"
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    重试名称查询
                  </Button>
                </p>
              )}
            </div>
          )}
        </section>
      ))}
      {!!changes.length && (
        <details className="diff-paths">
          <summary>高级：变化字段路径（不含凭据正文）</summary>
          <ul>
            {changes.map((change) => (
              <li key={change.path}>
                <code>{change.path}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
