import { useEffect, useRef, useState } from "react";
import { Button } from "antd";
import {
  AdminApiError,
  type AdminApi,
  type CredentialOperationState,
} from "./api";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import { ConfirmAction, FieldHelp, IdText } from "@cyl/open-platform-web-shared/ui/components";
import { formatTime, grantStatus } from "./credentialModel";
import "./credentials.css";

interface SigningKey {
  keyId: string;
  applicationId: string;
  revision: number;
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
  changedAt: string;
}
interface KeyView {
  configured: boolean;
  key: SigningKey | null;
}
interface IssuedKey {
  key: SigningKey;
  signingSecret: string;
}
type Action = "create" | "rotate" | "revoke";
const confirmations: Record<Action, { title: string; okText: string; impact: string }> = {
  create: { title: "生成签名密钥？", okText: "确认生成", impact: "生成独立签名凭据，SigningSecret 仅显示一次。" },
  rotate: { title: "轮换签名密钥？", okText: "确认轮换", impact: "旧签名密钥将立即失效，接入方需要更新签名配置；已有 Token 不受影响。新 SigningSecret 仅显示一次。" },
  revoke: { title: "撤销签名密钥？", okText: "确认撤销", impact: "旧签名密钥将立即失效，旧签名后续调用会被拒绝；已有 Token 不受影响。" },
};
export default function SigningKeysPanel(props: {
  api: AdminApi;
  applicationId: string;
  applicationName?: string;
  onStateChange?: (state: CredentialOperationState) => void;
}) {
  return <SigningKeyEditor key={props.applicationId} {...props} />;
}
function SigningKeyEditor({
  api,
  applicationId,
  applicationName,
  onStateChange,
}: {
  api: AdminApi;
  applicationId: string;
  applicationName?: string;
  onStateChange?: (state: CredentialOperationState) => void;
}) {
  const [view, setView] = useState<KeyView | null>(null),
    [issued, setIssued] = useState<IssuedKey | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reloadNeeded, setReloadNeeded] = useState(false);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false),
    mounted = useRef(true);
  const path = `/applications/${encodeURIComponent(applicationId)}/signing-key`;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onStateChange?.({
      busy,
      unresolved: Boolean(pending),
      unacknowledged: Boolean(issued),
    });
  }, [busy, pending, issued, onStateChange]);
  useEffect(
    () => () =>
      onStateChange?.({
        busy: false,
        unresolved: false,
        unacknowledged: false,
      }),
    [onStateChange],
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void api<KeyView>(path, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setView(result);
        setError("");
        setReloadNeeded(false);
        if (pending) {
          setNotice(
            pending !== "revoke" && result.key?.status === "ACTIVE"
              ? `已核对：当前签名密钥 r${result.key.revision} 有效。本次未收到的 SigningSecret 无法找回；如需交付，请明确执行轮换。`
              : `已核对当前状态：${result.key?.status === "REVOKED" ? "已撤销" : result.key ? "有效" : "尚未生成"}。请核对后决定是否继续。`,
          );
          setPending(null);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError((reason as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // pending由显式刷新读取后消解，不能触发自动重试。
  }, [api, path, reload]);
  async function change(action: Action) {
    if (!view || inFlight.current || issued || pending || reloadNeeded) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<SigningKey | IssuedKey>(
        `${path}${action === "create" ? "" : `/${action}`}`,
        { method: "POST", body: { expectedRevision: view.key?.revision ?? 0 } },
      );
      if (!mounted.current) return;
      if ("signingSecret" in result) {
        setView({ ...view, key: result.key });
        setIssued(result);
      } else {
        setView({ ...view, key: result });
        setNotice(
          "签名密钥已撤销，旧签名后续调用将被拒绝；已有 Token 保持独立。",
        );
      }
    } catch (failure) {
      if (!mounted.current) return;
      setError((failure as Error).message);
      setReloadNeeded(true);
      const status =
        failure instanceof AdminApiError
          ? (failure.httpStatus ??
            (failure.code < 1000
              ? failure.code
              : Math.floor(failure.code / 100000)))
          : 0;
      if (status < 400 || status >= 500) setPending(action);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const locked =
    busy || loading || Boolean(issued) || Boolean(pending) || reloadNeeded;
  const action = (kind: Action, button: { label: string; primary?: boolean; danger?: boolean; disabled: boolean }) => (
    <ConfirmAction
      title={confirmations[kind].title}
      description={`凭据「${applicationName || applicationId}」：${confirmations[kind].impact}`}
      okText={confirmations[kind].okText}
      danger={kind !== "create"}
      disabled={button.disabled}
      onConfirm={() => change(kind)}
    >
      <Button type={button.primary ? "primary" : "default"} danger={button.danger} disabled={button.disabled}>
        {button.label}
      </Button>
    </ConfirmAction>
  );
  return (
    <section className="credential-section" aria-label="请求签名密钥">
      <div className="credential-section__head">
        <h2>请求签名密钥</h2>
        <FieldHelp label="请求签名密钥">
          HMAC 用于验证正式请求的来源与完整性。它与 AppSecret 和 Token 独立；轮换或撤销签名密钥，不会撤销已有 Token。生成或轮换的 SigningSecret 只交付一次。
        </FieldHelp>
        <div className="credential-section__actions">
          <Button disabled={busy || loading} onClick={() => setReload((value) => value + 1)}>
            刷新签名密钥状态
          </Button>
        </div>
      </div>
      <ErrorFeedback error={error} />
      {loading && <p role="status" className="credential-hint">正在读取签名密钥…</p>}
      {(pending || reloadNeeded) && (
        <div className="credential-pending" role="status">
          <span>{pending ? "操作结果未确认，暂不能再次生成或轮换。" : "先读取最新状态，再决定下一步。"}</span>
          <Button size="small" disabled={busy || loading} onClick={() => setReload((value) => value + 1)}>
            核对签名密钥状态
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="credential-notice">
          {notice}
        </p>
      )}
      {view && (
        <>
          {!view.configured && (
            <p role="status" className="credential-pending">
              签名密钥服务尚未配置，请联系平台运维。
            </p>
          )}
          {view.key ? (
            <dl className="credential-facts">
              <div>
                <dt>Key ID</dt>
                <dd><IdText value={view.key.keyId} label="Key ID" maxChars={40} /></dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd><grantStatus.Badge value={view.key.status} /></dd>
              </div>
              <div>
                <dt>当前修订</dt>
                <dd>r{view.key.revision}</dd>
              </div>
              <div>
                <dt>更新时间</dt>
                <dd><time dateTime={view.key.changedAt}>{formatTime(view.key.changedAt)}</time></dd>
              </div>
            </dl>
          ) : (
            <p className="credential-hint">尚未生成签名密钥。需要 HMAC 调用时，在此生成并交付给接入方。</p>
          )}
          <div className="credential-actions">
            {view.key?.status === "ACTIVE" ? (
              <>
                {action("rotate", { label: "轮换签名密钥", disabled: locked || !view.configured })}
                {action("revoke", { label: "撤销签名密钥", danger: true, disabled: locked })}
              </>
            ) : (
              action("create", { label: "生成签名密钥", primary: true, disabled: locked || !view.configured })
            )}
          </div>
        </>
      )}
      {issued && (
        <section className="credential-secret" aria-label="一次性签名凭据">
          <h3>保存本次签名凭据</h3>
          <p>SigningSecret 仅本次显示；关闭或离开此凭据后无法找回。普通分区切换和刷新状态会保留本次交付。</p>
          {view?.key?.keyId !== issued.key.keyId && (
            <p role="alert">当前密钥已变化，下方是旧交付记录，请勿作为当前有效签名凭据使用。</p>
          )}
          <dl>
            <dt>Key ID · r{issued.key.revision}</dt>
            <dd><IdText value={issued.key.keyId} label="Key ID" maxChars={64} /></dd>
            <dt>SigningSecret</dt>
            <dd><IdText value={issued.signingSecret} label="SigningSecret" maxChars={96} /></dd>
          </dl>
          <Button
            type="primary"
            className="credential-secret__close"
            onClick={() => {
              setIssued(null);
              setNotice("本次秘密显示已关闭。后续需要重新交付时，请轮换生成新密钥。");
            }}
          >
            已保存，关闭签名密钥
          </Button>
        </section>
      )}
    </section>
  );
}
