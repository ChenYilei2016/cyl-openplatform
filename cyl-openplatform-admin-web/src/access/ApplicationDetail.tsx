import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { observationRoute } from "../observability/links";
import { Alert, Button, Tabs } from "antd";
import {
  type AdminApi,
  type Application,
  type Credential,
  type CredentialOperationState,
} from "./api";
import ApplicationAudit from "./ApplicationAudit";
import TokensPanel from "../token/TokensPanel";
import TenantGrantsPanel from "./TenantGrantsPanel";
import ScopeSelection from "./ScopeSelection";
import CredentialsPanel from "./CredentialsPanel";
import SigningKeysPanel from "./SigningKeysPanel";
import CredentialTechnicalDetails from "./CredentialTechnicalDetails";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import { ConfirmAction, EntityDrawer, FieldHelp, IdText, TenantTag } from "@cyl/open-platform-web-shared/ui/components";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { credentialStatus, credentialTabs, formatTime, type CredentialTab, type RouteCredentialTab } from "./credentialModel";
import "./credentials.css";

export interface TenantEditState {
  personnelDirty?: boolean;
  dirty: boolean;
  busy: boolean;
  save: () => Promise<boolean>;
}
export default function ApplicationDetail({
  api,
  applicationId,
  onBack,
  initialTab,
  initialTenantGrantId,
  issuedCredential,
  onCredentialClose,
  locateTokenId,
  canReadCalls = false,
}: {
  api: AdminApi;
  applicationId: string;
  onBack: () => void;
  initialTab?: RouteCredentialTab;
  initialTenantGrantId?: string | null;
  issuedCredential?: Credential | null;
  onCredentialClose?: () => void;
  /** 按 Token 记录 ID 搜索命中时定位的记录。 */
  locateTokenId?: string | null;
  canReadCalls?: boolean;
}) {
  const navigation = useAdminNavigation();
  const [application, setApplication] = useState<Application | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<CredentialTab>(initialTab ?? "overview");
  const [scopeCodes, setScopeCodes] = useState<string[]>([]),
    [scopeError, setScopeError] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [signingState, setSigningState] = useState<CredentialOperationState>({ busy: false, unresolved: false, unacknowledged: false });
  const [tokenState, setTokenState] = useState<CredentialOperationState>({ busy: false, unresolved: false, unacknowledged: false });
  const [visited, setVisited] = useState(() => new Set<CredentialTab>([initialTab ?? 'overview']));
  useEffect(() => { setVisited(current => current.has(tab) ? current : new Set([...current, tab])); }, [tab]);
  const sensitivePending = signingState.unacknowledged || signingState.unresolved || tokenState.unresolved;
  const operationBusy = signingState.busy || tokenState.busy;
  const [tenantEdit, setTenantEdit] = useState<TenantEditState | null>(null);
  const receiveTenantEdit = useCallback((value: TenantEditState) => {
    setTenantEdit(value);
    if (value.dirty || value.busy) setMessage("");
  }, []);
  const [rotatedCredential, setRotatedCredential] = useState<Credential | null>(null);
  const credential = rotatedCredential ?? issuedCredential;
  const writing = useRef(false),
    path = `/applications/${encodeURIComponent(applicationId)}`;
  const locked = busy || Boolean(tenantEdit?.busy) || operationBusy;
  const scopeDirty =
    !!application &&
    (scopeCodes.length !== application.scopeCodes.length ||
      scopeCodes.some((code) => !application.scopeCodes.includes(code)));
  // 状态响应也含权限快照；仅保留真正编辑过的选择，不能制造伪未保存权限。
  const receiveApplication = (value: Application) => {
    if (!scopeDirty) setScopeCodes(value.scopeCodes);
    setApplication(value);
  };
  const refreshRelationships = async () => {
    setBusy(true);
    try { receiveApplication(await api<Application>(path)); setRefreshFailed(false); }
    catch(failure) { setRefreshFailed(true); setError(`关联已保存，但凭据摘要刷新失败：${(failure as Error).message}`); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    setTab(initialTab ?? "overview");
  }, [initialTab]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void api<Application>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          setApplication(value);
          setScopeCodes(value.scopeCodes);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError((failure as Error).message);
      });
    return () => controller.abort();
  }, [api, path, retry]);
  const changeTab = (next: CredentialTab) => {
    if (locked) return;
    setMessage("");
    setTab(next);
    navigation.navigate({
      ...navigation.route,
      page: "applications",
      applicationId,
      applicationTab: next === "overview" ? undefined : next,
    });
  };
  // 概览只读取有效 Token 总数（每页 1 条），不加载 Token 明细。
  const activeTokens = useReadPage<unknown>(
    api,
    `${path}/tokens?page=1&pageSize=1&status=ACTIVE`,
    retry,
    tab === "overview",
  );
  const saveScopes = async () => {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setScopeError("");
    setMessage("");
    try {
      const result = await api<Application>(`${path}/scopes`, {
        method: "PUT",
        body: { scopeCodes },
      });
      setApplication(result);
      setScopeCodes(result.scopeCodes);
      setMessage("凭据调用权限已保存。");
      return true;
    } catch (failure) {
      setScopeError((failure as Error).message);
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  useEffect(
    () =>
      navigation.registerDraft({
        applicationId,
        tenantGrantId: initialTenantGrantId,
        protectTenantSwitch: Boolean(tenantEdit?.personnelDirty),
        dirty: () =>
          writing.current ||
          Boolean(credential) || sensitivePending || operationBusy ||
          scopeDirty ||
          Boolean(tenantEdit?.dirty || tenantEdit?.busy),
        busy: () => writing.current || Boolean(tenantEdit?.busy) || operationBusy,
        canSave: !credential && !tenantEdit?.personnelDirty && !sensitivePending,
        leaveMessage: sensitivePending ? (signingState.unacknowledged ? "SigningSecret仅本次显示，离开此凭据将丢失本次交付，请先妥善保存。" : "凭据操作结果尚未确认，请先回到对应分区核对状态。离开不会撤回已提交的变更。") : credential
          ? "AppSecret仅本次显示，离开后无法再次查看。请取消返回并妥善保存；明确放弃后不会保留密钥。"
          : tenantEdit?.personnelDirty ? "人员选择尚未完成。请返回核验并确认委托，或放弃本次人员操作后离开。" : undefined,
        save: async () => {
          if (credential) return false;
          if (scopeDirty && !(await saveScopes())) {
            changeTab("scopes");
            return false;
          }
          if (tenantEdit?.dirty && !(await tenantEdit.save())) {
            changeTab("grants");
            return false;
          }
          return true;
        },
      }),
    [
      navigation.registerDraft,
      applicationId,
      initialTenantGrantId,
      credential,
      scopeDirty,
      tenantEdit,
      sensitivePending,
      operationBusy,
      signingState.unacknowledged,
      busy,
      scopeCodes,
    ],
  );
  async function rotateSecret() {
    if (!application || writing.current || credential) return;
    writing.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setRotatedCredential(await api<Credential>(`${path}/secret/rotate`, { method: "POST" }));
      setMessage("AppSecret已轮换，请更新接入方配置并重新签发Token。");
      try {
        receiveApplication(await api<Application>(path));
        setRefreshFailed(false);
      } catch (failure) {
        setRefreshFailed(true);
        setError(`密钥已轮换，状态刷新失败：${(failure as Error).message}`);
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  async function changeStatus() {
    if (!application || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const enabled = application.status !== "ENABLED";
      receiveApplication(await api<Application>(`${path}/status`, { method: "PUT", body: { enabled } }));
      setMessage(enabled ? "凭据已启用。" : "凭据已停用。");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  // 一次性秘密未关闭、有待核对的操作或未保存修改时不能轮换，避免新 Secret 覆盖未交付结果。
  const rotateBlocked = locked || Boolean(credential) || sensitivePending || scopeDirty || Boolean(tenantEdit?.dirty);
  const close = () => {
    if (!locked) onBack();
  };
  const overview = application && (
    <section className="credential-overview" aria-label="凭据概览">
      {application.activeTenantGrantCount != null && stringifyJson(application.activeTenantGrantCount) === "0" && (
        <Alert
          type="warning"
          showIcon
          title="该凭据没有有效调用租户，换取 Token 会失败。"
          action={<Button size="small" type="link" onClick={() => changeTab("grants")}>无有效调用租户 · 去绑定</Button>}
        />
      )}
      {application.scopeCodes.length === 0 && (
        <Alert
          type="warning"
          showIcon
          title="尚未授予任何权限组，调用任何 API 都会被拒绝。"
          action={<Button size="small" type="link" onClick={() => changeTab("scopes")}>无调用权限 · 去选择</Button>}
        />
      )}
      {application.status === "DISABLED" && <Alert type="info" showIcon title="凭据已停用：全部关联租户都不能换取或使用 Token。" />}
      <dl className="credential-facts">
        <div>
          <dt>AK</dt>
          <dd><IdText value={application.appKey} label="AK" maxChars={40} /></dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd><credentialStatus.Badge value={application.status} /></dd>
        </div>
        <div>
          <dt>
            归属租户 <FieldHelp label="归属租户说明">归属只记录所有者，不代表获得调用授权。获准调用的租户见“授权租户与人员”。</FieldHelp>
          </dt>
          <dd><TenantTag id={application.ownerTenantId} name={application.tenantNames?.[application.ownerTenantId]} /></dd>
        </div>
        <div>
          <dt>有效调用租户</dt>
          <dd>
            <Button type="link" size="small" className="credential-facts__link" onClick={() => changeTab("grants")}>
              {application.activeTenantGrantCount == null ? "查看" : `${stringifyJson(application.activeTenantGrantCount)} 个`}
            </Button>
          </dd>
        </div>
        <div>
          <dt>权限组</dt>
          <dd>
            <Button type="link" size="small" className="credential-facts__link" onClick={() => changeTab("scopes")}>
              {`${application.scopeCodes.length} 个`}
            </Button>
          </dd>
        </div>
        <div>
          <dt>有效 Token</dt>
          <dd>
            <Button type="link" size="small" className="credential-facts__link" onClick={() => changeTab("tokens")}>
              {activeTokens.data ? `${activeTokens.data.total} 个` : activeTokens.error ? "读取失败" : "…"}
            </Button>
          </dd>
        </div>
        <div>
          <dt>最近调用</dt>
          <dd>{application.lastCalledAt ? <time dateTime={application.lastCalledAt}>{formatTime(application.lastCalledAt)}</time> : <span className="op-muted">暂无正式调用记录</span>}</dd>
        </div>
      </dl>
      <CredentialTechnicalDetails
        records={[
          ["凭据记录编号", application.id],
          ["授权版本", stringifyJson(application.authorizationVersion)],
        ]}
      />
    </section>
  );
  const panes: Record<CredentialTab, ReactNode> = {
    overview,
    grants: application && (
      <TenantGrantsPanel
        api={api}
        application={application}
        initialGrantId={initialTenantGrantId}
        disabled={busy}
        onEditState={receiveTenantEdit}
        onRelationshipsChanged={refreshRelationships}
        active={tab === "grants"}
      />
    ),
    scopes: application && (
      <ScopeSelection
        api={api}
        application={application}
        selected={scopeCodes}
        onChange={(value) => {
          setScopeCodes(value);
          setMessage("");
        }}
        onSave={() => void saveScopes()}
        onCancel={() => {
          setScopeCodes(application.scopeCodes);
          setScopeError("");
        }}
        busy={locked}
        error={scopeError}
        active={tab === "scopes"}
      />
    ),
    tokens: application && (tab === "tokens" || visited.has("tokens")) && (
      <TokensPanel
        api={api}
        applicationId={application.id}
        active={tab === "tokens"}
        tokenId={locateTokenId ?? ""}
        locateTokenId={locateTokenId}
        tenantId={navigation.route.tenantId}
        employeeNo={navigation.route.employeeNo}
        onStateChange={setTokenState}
        onOpenRelations={() => changeTab("grants")}
        onOpenCalls={
          canReadCalls
            ? (tenantId, employeeNo) =>
                // 跨页地址约定（114）：日志条件写入 filter.logs.*，不使用路由级字段。
                navigation.navigate(
                  observationRoute("calls", { range: "7d", applicationId: application.id, tenantId, ...(employeeNo ? { employeeNo } : {}) }, navigation.route),
                )
            : undefined
        }
      />
    ),
    signature: application && (tab === "signature" || visited.has("signature")) && (
      <SigningKeysPanel api={api} applicationId={application.id} applicationName={application.appKey} onStateChange={setSigningState} />
    ),
    audit: application && tab === "audit" && <ApplicationAudit api={api} applicationId={application.id} canReadAudits={canReadCalls} />,
  };
  return (
    <EntityDrawer
      open
      width="lg"
      title="接入凭据"
      status={application && <credentialStatus.Badge value={application.status} />}
      subtitle={application && <IdText value={application.appKey} label="AK" maxChars={40} />}
      onClose={close}
      actions={
        application && (
          <div className="credential-drawer__actions">
            <ConfirmAction
              title="轮换 AppSecret？"
              description={`凭据 AK ${application.appKey}：旧 AppSecret 和全部旧 Token 将失效，全部接入方需要更新配置。新 AppSecret 只显示一次。`}
              okText="确认轮换"
              danger
              disabled={rotateBlocked}
              onConfirm={rotateSecret}
            >
              <Button disabled={rotateBlocked}>轮换 AppSecret</Button>
            </ConfirmAction>
            <ConfirmAction
              title={application.status === "ENABLED" ? "停用凭据？" : "启用凭据？"}
              description={`凭据 AK ${application.appKey}：${application.status === "ENABLED" ? "停用影响此凭据的全部关联租户，期间不能换取或使用 Token。" : "只恢复凭据启用状态，不恢复已撤销的租户或人员授权。"}`}
              okText={application.status === "ENABLED" ? "确认停用" : "确认启用"}
              danger={application.status === "ENABLED"}
              disabled={locked}
              onConfirm={changeStatus}
            >
              <Button danger={application.status === "ENABLED"} disabled={locked}>
                {application.status === "ENABLED" ? "停用" : "启用"}凭据
              </Button>
            </ConfirmAction>
          </div>
        )
      }
    >
      <div className="credential-drawer" aria-label="接入凭据详情">
        <ErrorFeedback error={error} />
        {refreshFailed && (
          <Button
            disabled={locked}
            onClick={async () => {
              setBusy(true);
              try {
                receiveApplication(await api<Application>(path));
                setRefreshFailed(false);
                setError("");
              } catch (failure) {
                setError((failure as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            重新读取凭据状态
          </Button>
        )}
        {message && (
          <p className="credential-notice" role="status">
            {message}
          </p>
        )}
        {!application &&
          (error ? (
            <Button onClick={() => setRetry((value) => value + 1)}>重新加载</Button>
          ) : (
            <p role="status">正在加载凭据…</p>
          ))}
        {credential && (
          <CredentialsPanel
            credential={credential}
            onClose={() => {
              setRotatedCredential(null);
              onCredentialClose?.();
            }}
          />
        )}
        {sensitivePending && (
          <div className="credential-pending" role="status">
            <span>{signingState.unacknowledged ? "本次签名凭据尚未确认保存。" : "有凭据操作等待核对结果。"}</span>
            <Button disabled={locked} onClick={() => changeTab(signingState.unacknowledged || signingState.unresolved ? "signature" : "tokens")}>
              返回交付或核对
            </Button>
          </div>
        )}
        {application && (
          <Tabs
            className="op-drawer__tabs"
            activeKey={tab}
            onChange={(value) => changeTab(value as CredentialTab)}
            items={credentialTabs.map(([key, label]) => ({
              key,
              label,
              disabled: locked,
              // 授权与权限组页保持挂载：跨页签保留未保存输入与深链定位。
              forceRender: key === "grants" || key === "scopes",
              children: panes[key],
            }))}
          />
        )}
      </div>
    </EntityDrawer>
  );
}
