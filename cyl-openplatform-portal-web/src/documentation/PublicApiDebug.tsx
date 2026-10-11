import { ExperimentOutlined, SendOutlined, StopOutlined } from "@ant-design/icons";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import type { DocumentView, SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import { ApiError } from "@cyl/open-platform-web-shared/http";
import { parseJson, stringifyJson } from "@cyl/open-platform-web-shared/json";
import { Radio } from "antd";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { businessRequest } from "../portal/api";
import BusinessIdentity from "../portal/BusinessIdentity";
import { inputProblem } from "../portal/PublishedInvocation";
import CodeBlock from "../shell/CodeBlock";
import { invocationSamples } from "./PortalDocumentBody";

interface DebugProps {
  view: DocumentView;
  refreshing?: boolean;
  /** 平台公开网关地址，用于“复制为代码”；文档已声明地址时以文档为准。 */
  gatewayBaseUrl?: string;
  initialTenantId?: string;
  constraint?: {
    tenantId: string;
    applicationId: string;
    appKey: string;
    employeeNo?: string;
  };
  renderAuthenticated?: (token: string, onUnauthorized: () => void) => ReactNode;
}

/**
 * 在线调试（API Playground，115）：参数表单 + 请求 JSON → 验证 Token → 调用正式接口 → 状态码、耗时、响应；可复制为多语言代码。
 * 安全约束沿用公开调试：展开不发请求；凭据只在组件内存，收起、切换接口或离开页面即清除；只携带 Bearer，不请求平台会话。
 */
export default function PublicApiDebug(props: DebugProps) {
  const key = stringifyJson([props.view.service, props.view.version, props.view.method, props.view.releaseId, props.view.stateVersion, props.initialTenantId, props.constraint]);
  return <Playground key={key} {...props} />;
}

function Playground(props: DebugProps) {
  const panel = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(() => location.hash === "#document-debug");
  useEffect(() => {
    if (open) panel.current?.scrollIntoView?.({ block: "start" });
  }, [open]);
  return (
    <details ref={panel} id="document-debug" className="document-debug op-playground" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="op-playground__summary">
        <ExperimentOutlined aria-hidden />
        <span className="op-playground__title">在线调试</span>
        <small>API Playground</small>
        <span className="op-playground__hint">展开不调用，点击“调用正式接口”才发起业务请求</span>
      </summary>
      {open && <PlaygroundBody {...props} />}
    </details>
  );
}

const primitive = new Set(["STRING", "INTEGER", "NUMBER", "BOOLEAN"]);
const numberText = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const rawJson = (text: string) => (JSON as typeof JSON & { rawJSON: (text: string) => unknown }).rawJSON(text);

function PlaygroundBody({ view, refreshing = false, gatewayBaseUrl = "", initialTenantId, constraint, renderAuthenticated }: DebugProps) {
  const [input, setInput] = useState(() => stringifyJson(view.document.requestExample, 2));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const problem = inputProblem(input);
  const body = problem ? null : parseJson<Record<string, unknown>>(input);
  // 只为顶层基本类型字段生成表单；嵌套对象、数组仍在 JSON 中编辑，表单与 JSON 始终是同一份正文。
  const fields = Object.entries(view.document.requestSchema.properties ?? {}).filter(([, node]) => primitive.has(node.type));
  const setField = (name: string, node: SchemaNode, text: string) => {
    if (!body) return;
    const numeric = node.type === "INTEGER" || node.type === "NUMBER";
    if (numeric && text && !numberText.test(text)) {
      setDrafts((current) => ({ ...current, [name]: text }));
      return;
    }
    setDrafts(({ [name]: _removed, ...rest }) => rest);
    const next = { ...body };
    if (text === "") delete next[name];
    else next[name] = node.type === "BOOLEAN" ? text === "true" : numeric ? rawJson(text) : text;
    setInput(stringifyJson(next, 2));
  };
  const code = body ? invocationSamples({ ...view.document, requestExample: body }, gatewayBaseUrl) : null;
  return (
    <div className="op-playground__body">
      <section className="op-playground__step" aria-label="请求参数">
        <h3>
          <span className="op-playground__index">1</span>请求参数
        </h3>
        {fields.length > 0 && (
          <div className="op-playground__fields">
            {fields.map(([name, node]) => {
              const value = body?.[name];
              const text = drafts[name] ?? (value === undefined || value === null ? "" : typeof value === "string" ? value : stringifyJson(value));
              const invalid = drafts[name] !== undefined;
              const label = `参数 ${name}${node.required ? "（必填）" : ""}`;
              return (
                <label key={name} className="op-playground__field">
                  <span className="op-playground__field-name">
                    {node.required && <span className="op-required-dot" aria-hidden />}
                    <code>{name}</code>
                    <small>{node.type.toLowerCase()}</small>
                  </span>
                  {node.type === "BOOLEAN" ? (
                    <Radio.Group
                      aria-label={label}
                      size="small"
                      optionType="button"
                      value={text}
                      disabled={!body}
                      onChange={(event) => setField(name, node, event.target.value)}
                      options={[{ label: "不传", value: "" }, { label: "true", value: "true" }, { label: "false", value: "false" }]}
                    />
                  ) : (
                    <input
                      aria-label={label}
                      value={text}
                      disabled={!body}
                      inputMode={node.type === "STRING" ? undefined : "decimal"}
                      placeholder={node.description ?? undefined}
                      aria-invalid={invalid}
                      onChange={(event) => setField(name, node, event.target.value)}
                    />
                  )}
                  {invalid && <small className="op-playground__field-error">请输入数字，未写入请求 JSON。</small>}
                </label>
              );
            })}
            {!body && <p className="op-playground__note">请先修正下方 JSON，再使用表单填写。</p>}
          </div>
        )}
        <label className="op-playground__json">
          <span>请求 JSON</span>
          <textarea
            aria-label="正式调用请求 JSON"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={8}
            required
            maxLength={256 * 1024}
            spellCheck={false}
            aria-invalid={!!problem}
            aria-describedby={problem ? "playground-input-error" : undefined}
          />
        </label>
        {problem && (
          <p id="playground-input-error" role="status" className="op-playground__field-error">
            {problem}
          </p>
        )}
      </section>
      <section className="op-playground__step" aria-label="调用身份与结果">
        <h3>
          <span className="op-playground__index">2</span>调用身份与发送
        </h3>
        <BusinessIdentity
          employeeRequired={!!view.document.employeeRequired}
          initialTenantId={initialTenantId}
          constraint={constraint}
          renderAuthenticated={(token, onUnauthorized) => (
            <>
              {renderAuthenticated?.(token, onUnauthorized)}
              <PlaygroundSend view={view} token={token} input={input} problem={problem} disabled={refreshing} onUnauthorized={onUnauthorized} />
            </>
          )}
        />
      </section>
      <section className="op-playground__step" aria-label="复制为代码">
        <h3>
          <span className="op-playground__index">3</span>复制为代码
        </h3>
        {code && code.samples.length ? (
          <>
            <CodeBlock samples={code.samples} maxHeight={320} />
            <p className="op-playground__note">按当前请求 JSON 生成；Token 读取 OPEN_PLATFORM_TOKEN 环境变量，不写入代码。</p>
          </>
        ) : (
          <p className="op-playground__note">{code?.problem ?? "请求 JSON 有误，修正后生成代码。"}</p>
        )}
      </section>
    </div>
  );
}

type Outcome = { status?: number; elapsed: number; body?: string; error?: string };
const statusTone = (status?: number) => (!status ? "unknown" : status < 300 ? "success" : status < 500 ? "warning" : "error");

/** 发送与结果：切换 Token、接口或生效版本时中止未完成请求，晚到响应不会写入新身份的结果。 */
function PlaygroundSend({ view, token, input, problem, disabled, onUnauthorized }: { view: DocumentView; token: string; input: string; problem: string; disabled: boolean; onUnauthorized: () => void }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const path = `/api/oauth/${[view.service, view.version, view.method].map(encodeURIComponent).join("/")}`;
  const revision = stringifyJson([view.releaseId, view.stateVersion]);
  useEffect(() => {
    setOutcome(null);
    setBusy(false);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [token, path, revision]);
  const retired = view.document.lifecycle?.status === "RETIRED";
  const send = () => {
    if (disabled || problem || pending.current) return;
    const abort = new AbortController();
    pending.current = abort;
    const started = performance.now();
    setOutcome(null);
    setBusy(true);
    void businessRequest(path, { token, bodyText: input, signal: abort.signal, onUnauthorized })
      .then(({ httpStatus, ...response }) => {
        if (!abort.signal.aborted) setOutcome({ status: httpStatus, elapsed: performance.now() - started, body: stringifyJson(response, 2) });
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setOutcome({
            status: error instanceof ApiError ? error.httpStatus : undefined,
            elapsed: performance.now() - started,
            error: `${error instanceof Error ? error.message : "未收到调用结果。"} 请核对业务状态；不会自动重试。`,
          });
      })
      .finally(() => {
        if (!abort.signal.aborted) {
          pending.current = null;
          setBusy(false);
        }
      });
  };
  return (
    <div className="op-playground__send">
      <p className="op-playground__endpoint">
        <code>POST {(view.document.baseUrl ?? "") + path}</code>
      </p>
      {disabled && <p role="status">正在核对生效文档，完成后可继续调用；输入已保留。</p>}
      <div className="op-playground__actions">
        <button type="button" className="op-playground__primary" aria-label="调用正式接口" disabled={disabled || busy || !!problem || retired} onClick={send}>
          <SendOutlined aria-hidden /> {busy ? "正在调用…" : "调用正式接口"}
        </button>
        {busy && (
          <button
            type="button"
            className="op-playground__secondary"
            onClick={() => {
              pending.current?.abort();
              pending.current = null;
              setBusy(false);
              setOutcome({ elapsed: 0, error: "已停止等待响应。服务端可能已执行，请核对业务状态后再决定是否重试。" });
            }}
          >
            <StopOutlined aria-hidden /> 取消等待
          </button>
        )}
      </div>
      {retired && <p className="op-playground__note">当前版本已退役，保留文档可读，正式调用不可用。</p>}
      {busy && <p role="status">正在调用…</p>}
      {outcome && (
        <section className="op-playground__result" aria-label={outcome.body ? "正式调用结果" : "调用响应状态"}>
          <div className="op-playground__meta">
            {outcome.status !== undefined && (
              <span className={`op-http-status op-http-status--${statusTone(outcome.status)}`} aria-label={`HTTP 状态 ${outcome.status}`}>
                {outcome.status}
              </span>
            )}
            {outcome.elapsed > 0 && <span className="op-playground__elapsed">{Math.round(outcome.elapsed)} ms</span>}
          </div>
          <ErrorFeedback error={outcome.error ?? ""} />
          {outcome.body && <CodeBlock title="响应" samples={[{ label: "JSON", language: "json", code: outcome.body }]} maxHeight={360} />}
        </section>
      )}
    </div>
  );
}
