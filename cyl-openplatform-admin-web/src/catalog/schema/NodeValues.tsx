import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Input } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import type { AdminApi } from "../../access/api";
import { failureIssues } from "../WorkspaceValidation";

const keys = ["defaultValue", "enumValues", "example"] as const;
export type ValueKey = (typeof keys)[number];
const names: Record<ValueKey, string> = { defaultValue: "默认值", enumValues: "枚举", example: "示例" };
const hints: Record<ValueKey, string> = {
  defaultValue: "调用方未传时使用；留空表示未设置",
  enumValues: '只允许这些值，JSON 数组，如 ["A", "B"]',
  example: "只用于文档展示",
};

/**
 * 字段展开行：允许 null 立即生效；默认值 / 枚举 / 示例按原文逐项严格校验后整体应用。
 * 取消或卸载时中止进行中的校验，迟到结果不会覆盖字段。
 */
export default function NodeValues({
  api,
  label,
  node,
  focusKind,
  onNullable,
  onCancel,
  onApply,
  onStateChange,
}: {
  api: AdminApi;
  label: string;
  node: SchemaNode;
  focusKind?: ValueKey | null;
  onNullable: (nullable: boolean) => void;
  onCancel: () => void;
  onApply: (node: SchemaNode) => void;
  onStateChange?: (state: { pending: boolean; busy: boolean }) => void;
}) {
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const initial = {
    defaultValue: node.defaultValue == null ? "" : stringifyJson(node.defaultValue, 2),
    enumValues: node.enumValues?.length ? stringifyJson(node.enumValues, 2) : "",
    example: node.example == null ? "" : stringifyJson(node.example, 2),
  };
  const [values, setValues] = useState(initial);
  const inputs = useRef<Partial<Record<ValueKey, TextAreaRef | null>>>({});
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ValueKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = keys.some((key) => values[key] !== initial[key]);
  const report = useRef(onStateChange);
  report.current = onStateChange;
  useEffect(() => {
    for (const key of keys) inputs.current[key]?.resizableTextArea?.textArea?.setCustomValidity(
      dirty ? fieldErrors[key] || "字段值尚未应用，请先校验并应用，或取消修改。" : "",
    );
    report.current?.({ pending: dirty, busy });
  }, [dirty, busy, fieldErrors]);
  useEffect(() => () => report.current?.({ pending: false, busy: false }), []);
  useEffect(() => {
    if (focusKind) requestAnimationFrame(() => inputs.current[focusKind]?.focus());
  }, [focusKind]);
  const focusFirst = (invalid: Partial<Record<ValueKey, string>>) => {
    const first = keys.find((key) => invalid[key]);
    if (first) requestAnimationFrame(() => inputs.current[first]?.focus());
    return first;
  };
  const apply = async () => {
    setBusy(true);
    setError("");
    setFieldErrors({});
    const controller = new AbortController();
    active.current = controller;
    try {
      const results = await Promise.allSettled(
        keys.map((key) =>
          values[key].trim()
            ? api<unknown>("/apis/validate-json", { method: "POST", bodyText: values[key], signal: controller.signal })
            : Promise.resolve(key === "enumValues" ? [] : null),
        ),
      );
      if (controller.signal.aborted) return;
      const invalid: Partial<Record<ValueKey, string>> = {};
      results.forEach((result, index) => {
        if (result.status === "rejected") invalid[keys[index]] = (result.reason as Error).message;
      });
      if (results[1].status === "fulfilled" && !Array.isArray(results[1].value))
        invalid.enumValues = '请填写 JSON 数组，例如 ["A", "B"]；不限制可留空。';
      if (focusFirst(invalid)) {
        setFieldErrors(invalid);
        return;
      }
      const candidate = {
        ...node,
        ...Object.fromEntries(keys.map((key, index) => [key, (results[index] as PromiseFulfilledResult<unknown>).value])),
      };
      const validated = await api<SchemaNode>("/apis/validate-json?kind=schema&request=false", {
        method: "POST",
        bodyText: stringifyJson(candidate),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) onApply(validated);
    } catch (failure) {
      if (controller.signal.aborted) return;
      const issues = failureIssues(failure);
      const invalid: Partial<Record<ValueKey, string>> = {};
      for (const key of keys) {
        const issue = issues.find((item) => item.path === `/${key}` || item.path.startsWith(`/${key}/`));
        if (issue) invalid[key] = issue.message;
      }
      setFieldErrors(invalid);
      if (!focusFirst(invalid)) setError((failure as Error).message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <section
      className="op-schema-values"
      aria-label={`${label} · 值设置`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <Checkbox aria-label={`${label}允许 null`} checked={Boolean(node.nullable)} disabled={busy} onChange={(event) => onNullable(event.target.checked)}>
        允许 null
      </Checkbox>
      <div className="op-schema-values__grid">
        {keys.map((key) => (
          <label key={key} className="op-schema-values__field">
            <span className="op-schema-values__label">
              {names[key]}
              <small>{hints[key]}</small>
            </span>
            <Input.TextArea
              ref={(element) => {
                inputs.current[key] = element;
              }}
              data-schema-value={key}
              aria-label={names[key]}
              aria-invalid={Boolean(fieldErrors[key])}
              aria-describedby={fieldErrors[key] ? `schema-value-error-${key}` : undefined}
              className="op-json-editor"
              autoSize={{ minRows: 2, maxRows: 8 }}
              spellCheck={false}
              disabled={busy}
              maxLength={262144}
              value={values[key]}
              status={fieldErrors[key] ? "error" : undefined}
              onChange={(event) => {
                setValues((current) => ({ ...current, [key]: event.target.value }));
                setFieldErrors((current) => ({ ...current, [key]: undefined }));
                setError("");
              }}
            />
            {fieldErrors[key] && (
              <span id={`schema-value-error-${key}`} role="alert" className="op-config-issue">
                {names[key]}：{fieldErrors[key]}
              </span>
            )}
          </label>
        ))}
      </div>
      <p className="op-schema-values__help">文本写成 JSON 字符串（如 "DEMO-001"），数字直接填写；false、0、空字符串都是有效值。</p>
      {error && (
        <p role="alert" className="op-config-issue">
          {error}
        </p>
      )}
      <div className="op-schema-values__actions">
        <Button size="small" disabled={busy} onClick={onCancel}>
          取消
        </Button>
        <Button size="small" type="primary" loading={busy} disabled={!dirty && !busy} onClick={() => void apply()}>
          校验并应用
        </Button>
      </div>
    </section>
  );
}
