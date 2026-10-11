import { responseSchemaSuggestion } from "./responseSchemaGuidance";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import { useEffect, useRef, useState } from "react";
import { Button, Input, Popover, Radio, Tabs, Typography } from "antd";
import {
  parseJson,
  stringifyJson,
} from "@cyl/open-platform-web-shared/json";
import type { AdminApi } from "../access/api";
import "./editors.css";

export interface ResponseAdapter {
  mode: "DIRECT" | "ENVELOPE";
  successPath?: string | null;
  successValues?: unknown[];
  dataPath?: string | null;
  messagePath?: string | null;
}
export interface AdapterForm {
  mode: ResponseAdapter["mode"];
  successPath: string;
  successValues: string;
  dataPath: string;
  messagePath: string;
}
/**
 * 常见成功规则；第一项 default 也是改为“从 Response 提取”时的预填值。
 * default 对应通用返回信封：成功时 errCode 为字符串 "0"，消息 errMessage，数据 data。
 */
const adapterPresets: { label: string; title?: string; successPath: string; successValues: string; dataPath: string; messagePath: string }[] = [
  { label: "default", title: '标准 Response：errCode = "0"', successPath: "errCode", successValues: '["0"]', dataPath: "data", messagePath: "errMessage" },
  { label: "code = 200", successPath: "code", successValues: "[200]", dataPath: "data", messagePath: "message" },
  { label: "code = 0", successPath: "code", successValues: "[0]", dataPath: "data", messagePath: "message" },
  { label: "success = true", successPath: "success", successValues: "[true]", dataPath: "data", messagePath: "errMessage" },
];
const defaultPreset = adapterPresets[0];

export const adapterForm = (value?: ResponseAdapter): AdapterForm => ({
  mode: value?.mode ?? "DIRECT",
  successPath: value?.successPath ?? defaultPreset.successPath,
  successValues: value?.successValues?.length ? stringifyJson(value.successValues) : defaultPreset.successValues,
  dataPath: value?.dataPath ?? defaultPreset.dataPath,
  messagePath: value?.messagePath ?? (value?.mode === "ENVELOPE" ? "" : defaultPreset.messagePath),
});
export function responseAdapter(form: AdapterForm): ResponseAdapter {
  if (form.mode === "DIRECT") return { mode: "DIRECT" };
  const path =
    /^[a-zA-Z][a-zA-Z0-9_]{0,63}(?:\.[a-zA-Z][a-zA-Z0-9_]{0,63}){0,7}$/;
  if (
    !path.test(form.successPath) ||
    (form.dataPath !== "" && !path.test(form.dataPath)) ||
    (form.messagePath !== "" && !path.test(form.messagePath))
  )
    throw new Error(
      "路径请填写最多8层的点分字段名，例如 result.code；数据路径可留空表示根节点。",
    );
  let values: unknown;
  try {
    values = parseJson(form.successValues);
  } catch {
    throw new Error('成功值请填写 JSON 数组，例如 [200]、["0"] 或 [true]。');
  }
  const scalarType = (value: unknown) => {
    if (
      (
        JSON as typeof JSON & { isRawJSON?: (value: unknown) => boolean }
      ).isRawJSON?.(value)
    )
      return "number";
    return ["string", "number", "boolean"].includes(typeof value)
      ? typeof value
      : null;
  };
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.length > 10 ||
    !scalarType(values[0]) ||
    values.some((value) => scalarType(value) !== scalarType(values[0]))
  )
    throw new Error(
      '成功值需为1至10个同类型的字符串、数值或布尔值；数字0与文本"0"不同。',
    );
  return {
    mode: "ENVELOPE",
    successPath: form.successPath,
    successValues: values,
    dataPath: form.dataPath,
    ...(form.messagePath ? { messagePath: form.messagePath } : {}),
  };
}
type Content = {
  value: unknown;
  available: boolean;
  redacted: boolean;
  truncated: boolean;
};
export type ResponseIssue = {
  stage: string;
  reason: string;
  path: string;
  expectedType?: string;
  actualType?: string;
};
type Preview = {
  succeeded: boolean;
  providerResponse: Content;
  adaptedData: Content;
  publicResponse: Content;
  issue?: ResponseIssue;
  warnings: ResponseIssue[];
  providerMessage?: { value: string; truncated: boolean };
};
const reasonNames: Record<string, string> = {
  FIELD_NOT_ALLOWED: "请求中存在未声明字段",
  PATH_MISSING: "找不到字段",
  TYPE_MISMATCH: "字段类型不符",
  REQUIRED_MISSING: "缺少必填字段",
  NULL_NOT_ALLOWED: "该字段不允许 null",
  VALUE_NOT_ALLOWED: "值不在声明枚举内",
  LIMIT_EXCEEDED: "返回规模超限",
  PROVIDER_BUSINESS_REJECTED: "提供方业务拒绝",
  FIELD_PROJECTED: "未声明字段已移除",
  MESSAGE_UNAVAILABLE: "业务消息不可用",
};
export const responseIssueText = (issue: ResponseIssue) =>
  `${issue.path} · ${reasonNames[issue.reason] ?? issue.reason}${issue.expectedType && issue.reason !== "PROVIDER_BUSINESS_REJECTED" ? ` · 预期 ${issue.expectedType}，实际 ${issue.actualType}` : ""}`;
export default function ResponseAdapterEditor({
  api,
  apiId,
  form,
  schemaText,
  onChange,
  sampleSource,
  onSchemaChange,
}: {
  api: AdminApi;
  apiId?: string;
  sampleSource?: { text: string };
  form: AdapterForm;
  schemaText: string;
  onChange: (form: AdapterForm) => void;
  onSchemaChange?: (schemaText: string) => void;
}) {
  const suggestion = responseSchemaSuggestion(form, schemaText);
  const [sample, setSample] = useState("");
  const [previewOpen, setPreviewOpen] = useState(Boolean(sampleSource));
  useEffect(() => {
    if (sampleSource) {
      setSample(sampleSource.text);
      setPreviewOpen(true);
    }
  }, [sampleSource]);
  const [result, setResult] = useState<{ key: string; value: Preview } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const schemaRequest = useRef<AbortController | null>(null);
  useEffect(() => () => schemaRequest.current?.abort(), []);
  const currentKey = stringifyJson([form, schemaText, sample]);
  const current = useRef(currentKey);
  current.current = currentKey;
  let ruleError = "";
  try {
    responseAdapter(form);
  } catch (failure) {
    ruleError = (failure as Error).message;
  }
  const preview = result?.key === currentKey ? result.value : null;
  const change = (patch: Partial<AdapterForm>) => {
    onChange({ ...form, ...patch });
    setError("");
  };
  async function adoptSchema() {
    if (!suggestion || !onSchemaChange || busy) return;
    const controller = new AbortController();
    schemaRequest.current = controller;
    const key = currentKey;
    setBusy(true);
    setError("");
    try {
      // 先严格检查完整原文，避免高级 JSON 的重复键被本地解析静默覆盖。
      await api('/apis/validate-json?kind=schema&request=false', { method:'POST', bodyText:schemaText, signal:controller.signal });
      if (!controller.signal.aborted && current.current === key) onSchemaChange(stringifyJson(suggestion.schema, 2));
    } catch (failure) {
      if (!controller.signal.aborted && current.current === key) setError((failure as Error).message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className="contract-section response-adapter">
      <div className="contract-heading">
        <h3 aria-label="先确定从返回中取什么">先确定从返回中取什么 <Popover trigger={['hover', 'click']} content={<div style={{maxWidth:420}}>必填约束字段是否存在，允许null需单独勾选。未声明字段不会对外公开。数字0与文本“0”不互转；业务拒绝使用50200002，原始消息仅供管理诊断。</div>}><Button type="text" size="small" className="connection-help" aria-label="字段、null与统一返回说明">?</Button></Popover></h3>
        <span className="help-text">规则随草稿保存，发布后生效</span>
      </div>
      <div className="contract-body">
        <Radio.Group
          className="adapter-choice"
          aria-label="返回处理方式"
          value={form.mode}
          onChange={(event) => change({ mode: event.target.value })}
          optionType="button"
          buttonStyle="solid"
          options={[
            { value: "DIRECT", label: "直接使用业务对象" },
            { value: "ENVELOPE", label: "从 Response 提取" },
          ]}
        />
        <span className="adapter-mode-hint">
          {form.mode === "DIRECT"
            ? "只公开响应结构中声明的业务字段。"
            : `先判断业务成功，再取 ${form.dataPath || "整个返回"}；下方结构只描述取出的业务数据。`}
        </span>
        {form.mode === "ENVELOPE" && (
          <>
            <div className="row adapter-presets">
              <span>填入常见规则</span>
              {adapterPresets.map(({ label, title, ...rule }) => {
                const active = form.successPath === rule.successPath && form.successValues.replace(/\s/g, "") === rule.successValues && form.dataPath === rule.dataPath;
                return (
                  <Button key={label} size="small" type={active ? "primary" : "default"} ghost={active} aria-pressed={active} title={title} onClick={() => change(rule)}>
                    {label}
                  </Button>
                );
              })}
            </div>
            <div className="adapter-fields">
              <label>
                成功字段路径
                <Input
                  data-field-path="/responseAdapter/successPath"
                  value={form.successPath}
                  maxLength={520}
                  onChange={(e) => change({ successPath: e.target.value })}
                  placeholder="例如 code"
                />
              </label>
              <label>
                成功值（JSON 数组）
                <Input
                  data-field-path="/responseAdapter/successValues"
                  value={form.successValues}
                  maxLength={6000}
                  onChange={(e) => change({ successValues: e.target.value })}
                  placeholder={'例如 [200] 或 ["0"]'}
                />
              </label>
              <label>
                业务数据路径
                <Input
                  data-field-path="/responseAdapter/dataPath"
                  value={form.dataPath}
                  maxLength={520}
                  onChange={(e) => change({ dataPath: e.target.value })}
                  placeholder="留空表示整个返回对象"
                />
              </label>
              <label>
                失败消息路径（可选）
                <Input
                  data-field-path="/responseAdapter/messagePath"
                  value={form.messagePath}
                  maxLength={520}
                  onChange={(e) => change({ messagePath: e.target.value })}
                  placeholder="仅管理诊断可见"
                />
              </label>
            </div>
            {ruleError && (
              <p className="error-note" role="alert">
                {ruleError}
              </p>
            )}
          </>
        )}
        {form.mode === "ENVELOPE" && <div className="response-data-flow"><span>提供方完整返回</span><span aria-hidden="true">→</span><strong>取 {form.dataPath || "根节点"}</strong><span aria-hidden="true">→</span><span>按公开结构检查这些业务字段</span></div>}
        {suggestion && <div className="response-schema-guidance" role="status"><strong>公开结构可能还保留了提供方外壳</strong><p>已选择提取 <code>{suggestion.path}</code>，当前结构却仍包含外层字段。通常应把 <code>{suggestion.path}</code> 内的结构提升为公开结构。</p><small>将保留{suggestion.fields.length ? ` ${suggestion.fields.slice(0,5).join("、")}${suggestion.fields.length>5?" 等":""} ${suggestion.fields.length} 个字段` : ` ${suggestion.schema.type} 结构`}的类型、必填、允许null和说明；不自动保存。</small>{onSchemaChange && <Button loading={busy} onClick={()=>void adoptSchema()}>使用 {suggestion.path} 内的结构</Button>}</div>}
        <details className="response-preview-disclosure" open={previewOpen} onToggle={event=>setPreviewOpen(event.currentTarget.open)}>
          <summary>用返回样例验证规则（无需调用）</summary>
        <div className="adapter-preview-toolbar">
          <Button
            type="primary"
            disabled={
              busy || !sample.trim() || !schemaText.trim() || !!ruleError
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              const key = currentKey;
              try {
                const bodyText = `{"responseAdapter":${stringifyJson(responseAdapter(form))},"responseSchema":${schemaText},"sample":${sample}}`;
                parseJson(bodyText);
                const value = await api<Preview>(
                  apiId
                    ? `/apis/${encodeURIComponent(apiId)}/response-preview`
                    : "/apis/response-preview",
                  { method: "POST", bodyText },
                );
                if (current.current === key) setResult({ key, value });
              } catch (failure) {
                if (current.current === key)
                  setError((failure as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在预览…" : "预览返回处理"}
          </Button>
          <span>
            {!schemaText.trim()
              ? "先填写下方响应结构"
              : !sample.trim()
                ? "粘贴提供方JSON后可预览"
                : "只检查当前样例，不调用提供方"}
          </span>
        </div>
        <div className="adapter-preview-grid">
          <label>
            提供方返回样例
            <Input.TextArea
              aria-label="提供方返回样例"
              className="response-adapter__sample"
              rows={9}
              value={sample}
              spellCheck={false}
              maxLength={262144}
              placeholder={
                '粘贴真实返回，例如 {"code":200,"data":{"name":"示例"}}'
              }
              onChange={(e) => {
                setSample(e.target.value);
                setError("");
              }}
            />
          </label>
          <div className="adapter-result" aria-live="polite">
            <strong>客户最终收到的响应</strong>
            {preview ? (
              <>
                <p
                  className={preview.succeeded ? "success-note" : "error-note"}
                >
                  {preview.succeeded
                    ? "规则校验通过"
                    : responseIssueText(preview.issue!)}
                  {!preview.succeeded && preview.issue?.stage === "SCHEMA" && form.mode === "ENVELOPE" && <small className="response-schema-context">这里的 $ 指提取后的业务数据（原始返回的 {form.dataPath || "根节点"}），不是提供方完整返回。</small>}
                </p>
                <Tabs
                  size="small"
                  items={[
                    {
                      key: "public",
                      label: "公开响应",
                      children: (
                        <PreviewContent content={preview.publicResponse} />
                      ),
                    },
                    {
                      key: "data",
                      label: "提取后 data",
                      children: (
                        <PreviewContent content={preview.adaptedData} />
                      ),
                    },
                    {
                      key: "provider",
                      label: "提供方原始",
                      children: (
                        <PreviewContent content={preview.providerResponse} />
                      ),
                    },
                  ]}
                />
                {preview.providerMessage && (
                  <p>
                    提供方消息：{preview.providerMessage.value}
                    {preview.providerMessage.truncated ? "（已截短）" : ""}
                  </p>
                )}
              </>
            ) : (
              <p className="help-text">
                预览后在此核对客户真正收到的code、data和错误；不需要Token。
              </p>
            )}
          </div>
        </div>
        </details>
        <ErrorFeedback error={error} />
        {preview && (
          <details>
            <summary>
              查看提取结果与字段诊断
              {preview.warnings.length
                ? `（${preview.warnings.length} 项）`
                : ""}
            </summary>
            {preview.warnings.map((warning, i) => (
              <p key={i}>{responseIssueText(warning)}</p>
            ))}
          </details>
        )}
      </div>
    </section>
  );
}

function PreviewContent({ content }: { content: Content }) {
  if (!content.available)
    return <p className="help-text">当前阶段尚无此结果。</p>;
  const text = stringifyJson(content.value, 2);
  return (
    <>
      <Typography.Paragraph copyable={{ text }}>
        <pre>{text}</pre>
      </Typography.Paragraph>
      {(content.redacted || content.truncated) && (
        <small>
          展示内容已{content.redacted ? "脱敏" : ""}
          {content.truncated ? "截短" : ""}，不改写正式业务值。
        </small>
      )}
    </>
  );
}
