import { ReloadOutlined } from "@ant-design/icons";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import { ConfirmAction, EmptyState, FieldHelp, IdText, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { useRead } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Alert, Button, Tooltip } from "antd";
import { useEffect, useRef, useState } from "react";
import type { AdminApi } from "../access/api";
import { formatTime } from "../access/credentialModel";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { gatewayStatus, type GatewayOverview, type IssuedGatewayCredential } from "./model";

/**
 * 网关凭据：每个环境只创建一次，签名密钥只在创建或轮换时显示一次，确认已保存后才能关闭；
 * 未关闭前离开页面会提示。停用即关闭整个 MCP 渠道。
 */
export default function GatewayCredentialTab({ api }: { api: AdminApi }) {
  const navigation = useAdminNavigation();
  const [revision, setRevision] = useState(0);
  const overview = useRead<GatewayOverview>(api, "/mcp/gateway-credential", revision);
  const [issued, setIssued] = useState<IssuedGatewayCredential | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const writing = useRef(false);
  const credential = overview.data?.credential ?? null;

  useEffect(() => {
    if (!issued) return;
    const unregister = navigation.registerDraft({
      mcpSecret: true,
      dirty: () => true,
      busy: () => false,
      save: async () => false,
      canSave: false,
      leaveMessage: "签名密钥仅本次显示，离开后无法再次查看。请取消返回并妥善保存；明确放弃后只能重新轮换。",
    });
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      unregister();
      window.removeEventListener("beforeunload", guard);
    };
  }, [issued, navigation.registerDraft]);

  const run = async (action: () => Promise<void>) => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      writing.current = false;
      setBusy(false);
      setRevision((value) => value + 1);
    }
  };
  const create = () =>
    run(async () => setIssued(await api<IssuedGatewayCredential>("/mcp/gateway-credential", { method: "POST", body: {} })));
  const rotate = () =>
    run(async () =>
      setIssued(await api<IssuedGatewayCredential>("/mcp/gateway-credential/rotate", { method: "POST", body: { expectedRevision: credential?.key?.revision ?? 0 } })),
    );
  const setEnabled = (enabled: boolean) =>
    run(async () => {
      await api("/mcp/gateway-credential/status", { method: "PUT", body: { enabled } });
      setNotice(enabled ? "网关凭据已启用，MCP 网关可以继续调用。" : "网关凭据已停用，MCP 网关的新调用将被拒绝。");
    });

  const locked = busy || overview.loading || Boolean(issued);
  const signingMissing = overview.data ? !overview.data.signingConfigured : false;

  return (
    <section className="mcp-gateway" aria-label="网关凭据">
      <div className="mcp-section__head">
        <p className="mcp-section__intro">
          网关凭据证明请求来自MCP 网关，不配置权限组、不绑定租户；能用哪些工具由租户开通与租户权限决定。每个环境只有一个。
        </p>
        <Tooltip title="刷新">
          <Button icon={<ReloadOutlined />} aria-label="刷新网关凭据" disabled={busy} onClick={overview.reload} />
        </Tooltip>
      </div>
      <ErrorFeedback error={error || overview.error} />
      {notice && <p role="status" className="credential-notice">{notice}</p>}
      {signingMissing && <Alert type="warning" showIcon title="签名密钥服务尚未配置，暂不能创建或轮换网关凭据，请联系平台运维。" />}
      {overview.data && !credential && (
        <EmptyState
          title="本环境尚未创建 MCP 网关凭据"
          description="创建后立即显示 Key ID 与签名密钥（仅显示一次），交给网关团队配置到“开放平台签名”上游。"
          action={
            <ConfirmAction
              title="创建 MCP 网关凭据？"
              description="每个环境只能创建一个。签名密钥仅本次显示，请准备好安全的保存位置。"
              okText="确认创建"
              disabled={locked || signingMissing}
              onConfirm={create}
            >
              <Button type="primary" disabled={locked || signingMissing} loading={busy}>
                创建网关凭据
              </Button>
            </ConfirmAction>
          }
        />
      )}
      {credential && (
        <>
          <dl className="credential-facts">
            <div>
              <dt>状态</dt>
              <dd><gatewayStatus.Badge value={credential.status} /></dd>
            </div>
            <div>
              <dt>Key ID</dt>
              <dd>{credential.key ? <IdText value={credential.key.keyId} label="Key ID" maxChars={40} /> : <span className="op-muted">无有效密钥</span>}</dd>
            </div>
            <div>
              <dt>密钥修订</dt>
              <dd>{credential.key ? `r${credential.key.revision}` : "—"}</dd>
            </div>
            <div>
              <dt>密钥更新时间</dt>
              <dd>{credential.key ? <time dateTime={credential.key.changedAt}>{formatTime(credential.key.changedAt)}</time> : "—"}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{credential.key ? <time dateTime={credential.key.createdAt}>{formatTime(credential.key.createdAt)}</time> : "—"}</dd>
            </div>
            <div>
              <dt>
                最近使用
                <FieldHelp label="最近使用">保留期内最近一次经 MCP 入口的正式调用时间；目录发现（tools/list）不计入。</FieldHelp>
              </dt>
              <dd>{credential.lastCalledAt ? <time dateTime={credential.lastCalledAt}>{formatTime(credential.lastCalledAt)}</time> : <span className="op-muted">暂无调用</span>}</dd>
            </div>
          </dl>
          <div className="credential-actions">
            <ConfirmAction
              title="轮换签名密钥？"
              description="旧签名密钥立即失效，网关更新配置前的调用都会被拒绝；请在维护窗口执行。新签名密钥仅显示一次。"
              okText="确认轮换"
              danger
              disabled={locked || signingMissing || credential.key?.status !== "ACTIVE"}
              onConfirm={rotate}
            >
              <Button disabled={locked || signingMissing || credential.key?.status !== "ACTIVE"}>轮换签名密钥</Button>
            </ConfirmAction>
            {credential.status === "ENABLED" ? (
              <ConfirmAction
                title="停用网关凭据？"
                description="停用后MCP 网关的所有新调用立即被拒绝（关闭整个 MCP 渠道）；租户开通与工具配置保持不变，可随时重新启用。"
                okText="确认停用"
                danger
                disabled={locked}
                onConfirm={() => setEnabled(false)}
              >
                <Button danger disabled={locked}>停用</Button>
              </ConfirmAction>
            ) : (
              <ConfirmAction title="启用网关凭据？" description="启用后MCP 网关可使用当前签名密钥继续调用。" okText="确认启用" disabled={locked} onConfirm={() => setEnabled(true)}>
                <Button disabled={locked}>启用</Button>
              </ConfirmAction>
            )}
          </div>
        </>
      )}
      {issued && (
        <section className="credential-secret" aria-label="一次性网关签名凭据">
          <h3>保存网关签名凭据</h3>
          <p>签名密钥仅本次显示；关闭或离开本页后无法再次查看。请交给网关团队配置到“开放平台签名”上游（Key ID + 签名密钥）。</p>
          <dl>
            <dt>Key ID · r{issued.credential.key?.revision}</dt>
            <dd><IdText value={issued.keyId} label="Key ID" maxChars={64} /></dd>
            <dt>签名密钥</dt>
            <dd><IdText value={issued.signingSecret} label="签名密钥" maxChars={96} /></dd>
          </dl>
          <p>
            <StatusBadge tone="warning">只显示一次</StatusBadge> 确认已安全保存后再关闭。
          </p>
          <Button
            type="primary"
            className="credential-secret__close"
            onClick={() => {
              setIssued(null);
              setNotice("本次签名密钥显示已关闭。需要重新交付时，请轮换生成新密钥。");
            }}
          >
            已妥善保存，关闭签名密钥
          </Button>
        </section>
      )}
    </section>
  );
}
