import { useEffect, useRef, useState } from "react";
import { Button, Input } from "antd";
import type { DocumentView } from "@cyl/open-platform-web-shared/documentation/types";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import {
  parseJson,
  stringifyJson,
} from "@cyl/open-platform-web-shared/json";
import { businessRequest } from "./api";
import "./invocation.css";

/** 请求正文校验：门户“我的接入”联调与文档页在线调试共用。 */
export function inputProblem(input: string) {
  try {
    if (new TextEncoder().encode(input).length > 256 * 1024)
      return "请求正文超过 256 KiB 限制。";
    const value = parseJson(input);
    return !value || typeof value !== "object" || Array.isArray(value)
      ? "请求正文必须为 JSON 对象。"
      : "";
  } catch (error) {
    return error instanceof Error ? error.message : "请求正文格式错误。";
  }
}
export default function PublishedInvocation({
  view,
  token,
  onUnauthorized,
  disabled = false,
}: {
  view: DocumentView;
  token: string;
  onUnauthorized: () => void;
  disabled?: boolean;
}) {
  const [input, setInput] = useState(() =>
    stringifyJson(view.document.requestExample, 2),
  );
  const [result, setResult] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const path = `/api/oauth/${[view.service, view.version, view.method].map(encodeURIComponent).join("/")}`;
  const revision = stringifyJson([view.releaseId, view.stateVersion]);
  const example = stringifyJson(view.document.requestExample, 2),
    problem = inputProblem(input);
  useEffect(() => {
    setInput(example);
    setResult("");
    setError("");
    setBusy(false);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [token, path, revision, example]);
  return (
    <section className="portal-invocation" aria-label="正式接口联调">
      <h3>实际调用已发布接口</h3>
      <p className="help-text">
        使用下方请求调用真实业务服务，结果不会自动重试。
      </p>
      <code className="op-invocation__endpoint">POST {(view.document.baseUrl ?? "") + path}</code>
      {disabled && (
        <p role="status">正在核对生效文档，完成后可继续调用；输入已保留。</p>
      )}
      <div className="portal-invocation-columns">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled || problem || pending.current) return;
            setError("");
            setResult("");
            const abort = new AbortController();
            pending.current = abort;
            setBusy(true);
            void businessRequest(path, {
              token,
              bodyText: input,
              signal: abort.signal,
              onUnauthorized,
            })
              .then((response) => {
                if (!abort.signal.aborted)
                  setResult(stringifyJson(response, 2));
              })
              .catch((error) => {
                if (!abort.signal.aborted)
                  setError(
                    `${error instanceof Error ? error.message : "未收到调用结果。"} 请核对业务状态；不会自动重试。`,
                  );
              })
              .finally(() => {
                if (!abort.signal.aborted) {
                  pending.current = null;
                  setBusy(false);
                }
              });
          }}
        >
          <label>
            正式调用请求 JSON
            <Input.TextArea
              aria-label="正式调用请求 JSON"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={12}
              disabled={busy}
              required
              maxLength={256 * 1024}
              spellCheck={false}
              status={problem ? "error" : undefined}
              aria-invalid={!!problem}
              aria-describedby={problem ? "published-input-error" : undefined}
            />
          </label>
          {problem && (
            <p
              id="published-input-error"
              role="status"
              className="document-field-error"
            >
              {problem}
            </p>
          )}
          <div className="form-actions">
            <Button
              aria-label="调用正式接口"
              htmlType="submit"
              type="primary"
              loading={busy}
              disabled={
                disabled ||
                busy ||
                !!problem ||
                view.document.lifecycle?.status === "RETIRED"
              }
            >
              调用正式接口
            </Button>
            {busy && (
              <Button
                onClick={() => {
                  pending.current?.abort();
                  pending.current = null;
                  setBusy(false);
                  setError(
                    "已停止等待响应。服务端可能已执行，请核对业务状态后再决定是否重试。",
                  );
                }}
              >
                取消等待
              </Button>
            )}
          </div>
          {view.document.lifecycle?.status === "RETIRED" && (
            <p className="help-text">
              当前版本已退役，保留文档可读，正式调用不可用。
            </p>
          )}
        </form>
        <section
          className="portal-invocation-result"
          aria-label={result ? "正式调用结果" : "调用响应状态"}
        >
          <h3>调用结果</h3>
          <ErrorFeedback error={error} />
          {busy ? (
            <p role="status">正在调用…</p>
          ) : result ? (
            <pre>{result}</pre>
          ) : (
            <p className="help-text">
              {error
                ? "本次未获得成功结果，可按错误提示核对后重新调用。"
                : "发起调用后在这里查看完整响应与请求号。"}
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
