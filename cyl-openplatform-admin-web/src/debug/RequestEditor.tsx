import { Button, Radio } from "antd";
import { useEffect, useState } from "react";
import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import {
  parseJson,
  stringifyJson,
  decimalContent,
  sameJsonValue,
} from "@cyl/open-platform-web-shared/json";

export interface InputIssue {
  path: string;
  message: string;
}
const rawNumber = (value: unknown) => decimalContent(value) !== null;
export function inputIssues(
  schema: SchemaNode | undefined,
  value: unknown,
  path = "$",
): InputIssue[] {
  const issues: InputIssue[] = [];
  let nodes = 0;
  const visit = (node: SchemaNode, item: unknown, at: string) => {
    if (issues.length >= 20) return;
    if (++nodes > 20000) {
      issues.push({ path: at, message: "参数规模超限" });
      return;
    }
    if (item === null) {
      if (!node.nullable)
        issues.push({
          path: at,
          message: "不允许 null，请移除可选字段或在契约中明确允许 null",
        });
      return;
    }
    const object =
      typeof item === "object" && !Array.isArray(item) && !rawNumber(item);
    const numeric = decimalContent(item);
    const valid =
      node.type === "OBJECT"
        ? object
        : node.type === "ARRAY"
          ? Array.isArray(item)
          : node.type === "STRING"
            ? typeof item === "string"
            : node.type === "BOOLEAN"
              ? typeof item === "boolean"
              : numeric !== null &&
                (node.type === "NUMBER" ||
                  numeric === "0" ||
                  BigInt(numeric.split("e")[1]) >= 0n);
    if (!valid) {
      issues.push({ path: at, message: `需要 ${node.type}，不会自动转换类型` });
      return;
    }
    if (
      node.enumValues?.length &&
      !node.enumValues.some((option) =>
        sameJsonValue(option, withDefaults(node, item)),
      )
    )
      issues.push({ path: at, message: "值不在声明的允许值中" });
    if (typeof item === "string" && item.length > 10000)
      issues.push({ path: at, message: "文本不能超过 10000 字符" });
    if (node.type === "OBJECT") {
      const fields = item as Record<string, unknown>;
      for (const key of Object.keys(fields))
        if (!node.properties?.[key])
          issues.push({
            path: `${at}.${key}`,
            message: "请求结构未声明此字段",
          });
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        if (Object.hasOwn(fields, key))
          visit(child, fields[key], `${at}.${key}`);
        else if (child.required && child.defaultValue == null)
          issues.push({ path: `${at}.${key}`, message: "必填字段尚未提供" });
      }
    } else if (node.type === "ARRAY" && node.items)
      (item as unknown[])
        .slice(0, 20001)
        .forEach((child, index) =>
          visit(node.items!, child, `${at}[${index}]`),
        );
  };
  if (schema) visit(schema, value, path);
  return issues.slice(0, 20);
}

/** 与服务端相同：仅为校验补缺失默认值，绝不改写用户原始输入。 */
function withDefaults(
  schema: SchemaNode,
  value: unknown,
  budget = { remaining: 20000 },
): unknown {
  if (--budget.remaining < 0) return value;
  if (
    schema.type === "OBJECT" &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(schema.properties ?? {})
        .filter(
          ([key, child]) =>
            Object.hasOwn(object, key) || child.defaultValue != null,
        )
        .map(([key, child]) => [
          key,
          withDefaults(
            child,
            Object.hasOwn(object, key) ? object[key] : child.defaultValue,
            budget,
          ),
        ]),
    );
  }
  return schema.type === "ARRAY" && Array.isArray(value) && schema.items
    ? value.map((item) => withDefaults(schema.items!, item, budget))
    : value;
}

/** 所有模式共用原始JSON；数字/容器未输入完整时原文保留并阻止执行。 */
export default function RequestEditor({
  text,
  schema,
  disabled,
  onChange,
  onInvalid,
}: {
  text: string;
  schema?: SchemaNode;
  disabled: boolean;
  onChange: (value: string) => void;
  onInvalid: (invalid: boolean, incomplete: boolean) => void;
}) {
  const [mode, setMode] = useState<"form" | "json">(schema ? "form" : "json");
  const [showOptional, setShowOptional] = useState(false);
  const [pending, setPending] = useState<Record<string, string>>({});
  let value: Record<string, unknown> = {};
  let error = "";
  try {
    const parsed = parseJson(text);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      rawNumber(parsed)
    )
      throw new Error("请求根节点必须是 JSON 对象");
    value = parsed as Record<string, unknown>;
  } catch (failure) {
    error = (failure as Error).message;
  }
  const problems = error
    ? [{ path: "$", message: error }]
    : inputIssues(schema, value);
  const invalid = Boolean(
    error || problems.length || Object.keys(pending).length,
  );
  const incomplete = Boolean(error || Object.keys(pending).length);
  useEffect(
    () => onInvalid(invalid, incomplete),
    [invalid, incomplete, onInvalid],
  );
  const update = (key: string, item: unknown, remove = false) => {
    const next = { ...value };
    if (remove) delete next[key];
    else next[key] = item;
    setPending((current) => {
      const remaining = { ...current };
      delete remaining[key];
      return remaining;
    });
    onChange(stringifyJson(next, 2));
  };
  const updateJson = (key: string, raw: string, number: boolean) => {
    if (!raw.trim()) {
      update(key, null, true);
      return;
    }
    try {
      const parsed = parseJson(raw);
      if (number && !rawNumber(parsed)) throw new Error("请输入JSON数值");
      update(key, parsed);
    } catch {
      setPending((current) => ({ ...current, [key]: raw }));
    }
  };
  const optionalMissing = Object.entries(schema?.properties ?? {}).filter(
    ([key, node]) => !node.required && !Object.hasOwn(value, key),
  ).length;
  return (
    <div className="debug-request-editor">
      <div className="debug-segment" role="group" aria-label="请求编辑方式">
        <button
          type="button"
          aria-pressed={mode === "form"}
          disabled={disabled || !schema || !!error}
          onClick={() => setMode("form")}
        >
          参数表单
        </button>
        <button
          type="button"
          aria-pressed={mode === "json"}
          disabled={disabled || !!Object.keys(pending).length}
          onClick={() => setMode("json")}
        >
          JSON
        </button>
        <small>同一份输入，数字保持原始精度</small>
      </div>
      {mode === "json" || !schema ? (
        <label>
          请求 JSON
          <textarea
            aria-label="调试请求 JSON"
            value={text}
            rows={9}
            maxLength={65536}
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => {
              setPending({});
              onChange(event.target.value);
            }}
          />
        </label>
      ) : (
        <fieldset disabled={disabled} className="debug-parameter-list">
          {Object.entries(schema.properties ?? {}).map(([key, node]) => {
            const field = value[key];
            const missing = !Object.hasOwn(value, key);
            const fieldIssues = problems.filter(
              (issue) =>
                issue.path === `$.${key}` ||
                issue.path.startsWith(`$.${key}.`) ||
                issue.path.startsWith(`$.${key}[`),
            );
            return (
              <div
                className="debug-parameter"
                key={key}
                hidden={
                  !showOptional &&
                  !node.required &&
                  missing &&
                  pending[key] === undefined
                }
              >
                <label>
                  <span>
                    <code>{key}</code>{" "}
                    {node.required ? (
                      <b className="required-mark">必填</b>
                    ) : (
                      <small>可选</small>
                    )}{" "}
                    <small>{node.type}</small>
                  </span>
                  {field === null ? (
                    <input aria-label={`参数 ${key}`} value="null" readOnly />
                  ) : node.type === "STRING" ? (
                    <input
                      aria-label={`参数 ${key}`}
                      value={
                        missing
                          ? ""
                          : typeof field === "string"
                            ? field
                            : stringifyJson(field)
                      }
                      placeholder={
                        node.defaultValue != null
                          ? `默认 ${stringifyJson(node.defaultValue)}`
                          : (node.description ?? "")
                      }
                      onChange={(event) => update(key, event.target.value)}
                    />
                  ) : node.type === "BOOLEAN" ? (
                    <Radio.Group
                      aria-label={`参数 ${key}`}
                      size="small"
                      optionType="button"
                      value={missing ? "" : String(field)}
                      onChange={(event) =>
                        update(
                          key,
                          event.target.value === "true",
                          !event.target.value,
                        )
                      }
                      options={[
                        { label: "未提供", value: "" },
                        { label: "true", value: "true" },
                        { label: "false", value: "false" },
                      ]}
                    />
                  ) : (
                    <textarea
                      aria-label={`参数 ${key}`}
                      rows={
                        node.type === "ARRAY" || node.type === "OBJECT" ? 3 : 1
                      }
                      spellCheck={false}
                      value={
                        pending[key] ?? (missing ? "" : stringifyJson(field, 2))
                      }
                      placeholder={
                        node.defaultValue != null
                          ? `默认 ${stringifyJson(node.defaultValue)}`
                          : node.type === "ARRAY"
                            ? "例如 []；保留数组和嵌套结构"
                            : node.type === "OBJECT"
                              ? "例如 {}；按原始 JSON 编辑嵌套字段"
                              : "输入数值"
                      }
                      onChange={(event) =>
                        updateJson(
                          key,
                          event.target.value,
                          ["NUMBER", "INTEGER"].includes(node.type),
                        )
                      }
                    />
                  )}
                  {node.description && <small>{node.description}</small>}
                  {!!node.enumValues?.length && (
                    <small>允许值：{stringifyJson(node.enumValues)}</small>
                  )}
                  {pending[key] !== undefined && (
                    <small className="error-note">
                      JSON尚未完成，请先修正此字段
                    </small>
                  )}
                  {fieldIssues.map((issue, index) => (
                    <small key={index} className="debug-field-error">
                      {issue.message}
                    </small>
                  ))}
                </label>
                <div className="row">
                  {node.nullable && (
                    <Button
                      type="link"
                      size="small"
                      onClick={() => update(key, null, field === null)}
                    >
                      {field === null ? "移除 null" : "设为 null"}
                    </Button>
                  )}
                  {!missing && !node.required && (
                    <Button
                      type="link"
                      size="small"
                      onClick={() => update(key, null, true)}
                    >
                      不提供此字段
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {optionalMissing > 0 && (
            <Button
              type="link"
              size="small"
              onClick={() => setShowOptional(!showOptional)}
            >
              {showOptional
                ? "收起未填写的可选参数"
                : `展开可选参数（${optionalMissing}）`}
            </Button>
          )}
          {!Object.keys(schema.properties ?? {}).length && (
            <p className="muted">此API没有客户参数，使用空对象即可。</p>
          )}
        </fieldset>
      )}
      {!!problems.length && (
        <div className="debug-input-issues" role="alert">
          {problems.map((issue, index) => (
            <div key={index}>
              <code>{issue.path}</code> · {issue.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 身份失效时只保留普通业务参数；不把Token/Secret带到下一次身份会话。 */
export function withoutSecrets(text: string): string {
  let changed = false;
  const sensitive =
    /(?:tokens?|secret|password|passwd|authorization|credentials?|signature)$/i;
  const clean = (value: unknown): unknown => {
    if (rawNumber(value)) return value;
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => {
            const remove = sensitive.test(key.replace(/[-_]/g, ""));
            changed ||= remove;
            return !remove;
          })
          .map(([key, child]) => [key, clean(child)]),
      );
    if (
      typeof value === "string" &&
      /\bBearer\s+|(?:token|secret|password)\s*[:=]/i.test(value)
    ) {
      changed = true;
      return null;
    }
    return value;
  };
  try {
    const safe = clean(parseJson(text));
    return changed ? stringifyJson(safe, 2) : text;
  } catch {
    return /token|secret|password|authorization|credential|signature/i.test(
      text,
    )
      ? "{}"
      : text;
  }
}
