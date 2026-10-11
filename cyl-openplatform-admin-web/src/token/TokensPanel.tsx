import { useEffect, useRef, useState } from "react";
import { Button, Descriptions, Input, Select, Table } from "antd";
import { useManagementFilters } from "../navigation/useManagementFilters";
import {
  AdminApiError,
  type AdminApi,
  type Page,
  type CredentialOperationState,
} from "../access/api";
import { ErrorFeedback, LoadFeedback } from "@cyl/open-platform-web-shared/components";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import {
  ConfirmAction,
  defineStatusMap,
  EmptyState,
  EntityDrawer,
  FieldHelp,
  FieldLabel,
  IdText,
  PersonTag,
  TenantTag,
} from "@cyl/open-platform-web-shared/ui/components";
import "../access/credentials.css";

interface TokenSummary {
  tokenId: string;
  applicationId: string;
  appKey: string;
  tenantId: string;
  tenantName?: string | null;
  userId?: string | null;
  employeeId?: string | null;
  employeeNo?: string | null;
  scopeCodes: string[];
  expiresAt: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED" | "INVALIDATED";
}
const tokenStatus = defineStatusMap<TokenSummary["status"]>({
  ACTIVE: { tone: "success", label: "有效" },
  REVOKED: { tone: "neutral", label: "已撤销" },
  EXPIRED: { tone: "warning", label: "已过期" },
  INVALIDATED: { tone: "error", label: "授权失效" },
});
const subject = (token: TokenSummary) =>
  token.userId
    ? `员工代调用 · 工号 ${token.employeeNo || "未记录"}`
    : "凭据自主调用";
const formatTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });
const emptyFilters = {
  tokenId: "",
  tenantId: "",
  employeeNo: "",
  subjectType: [] as string[],
  status: [] as string[],
};
/**
 * 凭据抽屉的 Token 页（原“Token 排障”全部能力）：按记录 ID、租户、员工、身份与状态筛选，查看详情或撤销。
 * locateTokenId 来自凭据搜索命中，打开时按该记录筛选并展开详情。
 */
export default function TokensPanel({
  api,
  applicationId,
  tokenId = "",
  locateTokenId,
  tenantId = "",
  employeeNo = "",
  onOpenRelations,
  onOpenCalls,
  onStateChange,
  active = true,
}: {
  api: AdminApi;
  applicationId: string;
  tokenId?: string;
  locateTokenId?: string | null;
  tenantId?: string;
  employeeNo?: string;
  active?: boolean;
  onOpenRelations?: () => void;
  onOpenCalls?: (tenant: string, employee?: string | null) => void;
  onStateChange?: (state: CredentialOperationState) => void;
}) {
  const { page, filters, setFilters, applied, apply, reset, onPage } =
    useManagementFilters("tokens", { ...emptyFilters, tokenId, tenantId, employeeNo });
  const [revision, setRevision] = useState(0),
    [detailId, setDetailId] = useState<string | null>(locateTokenId ?? null);
  const [busy, setBusy] = useState(false),
    [pendingId, setPendingId] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const inFlight = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onStateChange?.({
      busy,
      unresolved: Boolean(pendingId),
      unacknowledged: false,
    });
  }, [busy, pendingId, onStateChange]);
  useEffect(
    () => () =>
      onStateChange?.({
        busy: false,
        unresolved: false,
        unacknowledged: false,
      }),
    [onStateChange],
  );
  useEffect(() => { if (!active) setNotice(''); }, [active]);
  useEffect(() => {
    if (locateTokenId) setDetailId(locateTokenId);
  }, [locateTokenId]);
  const path = `/applications/${encodeURIComponent(applicationId)}/tokens`;
  const params = new URLSearchParams({ page: String(page), pageSize: "20" });
  for (const key of ["tokenId", "tenantId", "employeeNo"] as const)
    if (applied[key].trim()) params.set(key, applied[key].trim());
  for (const key of ["subjectType", "status"] as const)
    applied[key].forEach((value) => params.append(key, value));
  const tokens = useReadPage<TokenSummary>(
    api,
    `${path}?${params}`,
    revision,
    active,
  );
  const details = useReadPage<TokenSummary>(
    api,
    `${path}?page=1&pageSize=20&tokenId=${encodeURIComponent(detailId ?? "")}`,
    revision,
    Boolean(active && detailId),
  );
  const detail = detailId
    ? details.data?.items.find((item) => item.tokenId === detailId)
    : null;
  const locked = busy || Boolean(pendingId);
  async function revoke(selected: TokenSummary) {
    if (inFlight.current || pendingId) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/tokens/${encodeURIComponent(selected.tokenId)}`, {
        method: "DELETE",
      });
      if (!mounted.current) return;
      setNotice("Token 已撤销，仅该调用凭证失效，管理登录会话不受影响。");
      setRevision((value) => value + 1);
    } catch (failure) {
      if (!mounted.current) return;
      setError((failure as Error).message);
      const status =
        failure instanceof AdminApiError
          ? (failure.httpStatus ??
            (failure.code < 1000
              ? failure.code
              : Math.floor(failure.code / 100000)))
          : 0;
      if (status < 400 || status >= 500) setPendingId(selected.tokenId);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function reconcile() {
    if (!pendingId || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api<Page<TokenSummary>>(
        `${path}?page=1&pageSize=20&tokenId=${encodeURIComponent(pendingId)}`,
      );
      if (!mounted.current) return;
      const current = result.items.find((item) => item.tokenId === pendingId);
      setNotice(
        current
          ? `已核对 Token 当前状态：${tokenStatus.get(current.status).label}。`
          : "当前凭据下已无此Token记录。",
      );
      setPendingId(null);
      setRevision((value) => value + 1);
    } catch (failure) {
      if (mounted.current) setError((failure as Error).message);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const revokeAction = (token: TokenSummary, disabled: boolean, link: boolean) => (
    <ConfirmAction
      title="撤销 Token？"
      description={`撤销租户 ${token.tenantName ? `${token.tenantName}（${token.tenantId}）` : token.tenantId} 的${subject(token)}记录（${token.tokenId}），该 Token 后续调用被拒绝；其他 Token、签名密钥和管理会话不受影响。`}
      okText="确认撤销"
      danger
      disabled={disabled}
      onConfirm={() => {
        setError("");
        return revoke(token);
      }}
    >
      <Button type={link ? "link" : "default"} size={link ? "small" : undefined} danger disabled={disabled}>
        撤销 Token
      </Button>
    </ConfirmAction>
  );
  const feedback = (
    <>
      <ErrorFeedback error={error} />
      {pendingId && (
        <div className="credential-pending" role="status">
          撤销结果未确认，暂不能再次提交。
          <Button size="small" disabled={busy} onClick={() => void reconcile()}>
            核对 Token 状态
          </Button>
        </div>
      )}
    </>
  );
  const filterLabels = {
    tokenId: "Token 记录 ID（精确）",
    tenantId: "租户 ID（精确）",
    employeeNo: "员工号（精确）",
  } as const;
  return (
    <section className="credential-section" aria-label="Token 记录">
      <div className="credential-section__head">
        <h2>Token 记录</h2>
        <FieldHelp label="Token 记录">
          不同筛选条件同时满足，同一身份/状态多选为任一匹配。完整 Token 无法恢复，仅显示非秘密记录。重新绑定授权不复活旧 Token，签名密钥与 Token 各自独立。
        </FieldHelp>
        <div className="credential-section__actions">
          <Button
            disabled={busy || tokens.loading}
            onClick={() => {
              setNotice("");
              tokens.reload();
            }}
          >
            刷新 Token 列表
          </Button>
        </div>
      </div>
      <form
        className="credential-query"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice("");
          apply();
          setRevision((value) => value + 1);
        }}
      >
        {(["tokenId", "tenantId", "employeeNo"] as const).map((key) => (
          <label key={key}>
            <FieldLabel label={filterLabels[key]} />
            <Input
              aria-label={filterLabels[key]}
              maxLength={key === "tokenId" ? 36 : 64}
              value={filters[key]}
              placeholder={key === "tokenId" ? "记录 ID，不是完整 Token" : undefined}
              onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}
            />
          </label>
        ))}
        <label>
          <FieldLabel label="调用身份" />
          <Select
            mode="multiple"
            className="credential-query__select"
            aria-label="调用身份"
            placeholder="全部身份"
            value={filters.subjectType}
            onChange={(subjectType) => setFilters({ ...filters, subjectType })}
            options={[
              { value: "APPLICATION", label: "凭据自主调用" },
              { value: "USER", label: "员工代调用" },
            ]}
          />
        </label>
        <label>
          <FieldLabel label="状态" />
          <Select
            mode="multiple"
            className="credential-query__select"
            aria-label="Token 状态"
            placeholder="全部状态"
            value={filters.status}
            onChange={(status) => setFilters({ ...filters, status })}
            options={Object.entries(tokenStatus.map).map(([value, state]) => ({ value, label: state.label }))}
          />
        </label>
        <Button type="primary" htmlType="submit" disabled={busy}>
          查询
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            setNotice("");
            reset();
          }}
        >
          重置筛选
        </Button>
      </form>
      {!detailId && feedback}
      {notice && (
        <p role="status" className="credential-notice">
          {notice}
        </p>
      )}
      <LoadFeedback {...tokens} retry={tokens.reload} />
      {tokens.data && (
        <Table<TokenSummary>
          rowKey="tokenId"
          size="small"
          tableLayout="fixed"
          dataSource={tokens.data.items}
          pagination={{
            current: page,
            pageSize: 20,
            total: tokens.data.total,
            showSizeChanger: false,
            size: "small",
            disabled: busy || tokens.loading,
            showTotal: (total) => `共 ${total} 条`,
            onChange: onPage,
          }}
          locale={{
            emptyText: <EmptyState kind="noResult" title="当前条件没有匹配记录" description="可清除筛选或调整查询条件。" />,
          }}
          columns={[
            {
              title: "Token 记录",
              width: "29%",
              render: (_, token) => <IdText value={token.tokenId} label="Token 记录 ID" maxChars={40} />,
            },
            {
              title: "租户 / 调用身份",
              width: "26%",
              render: (_, token) => (
                <div className="op-cell-main">
                  <TenantTag id={token.tenantId} name={token.tenantName} />
                  <span className="op-cell-sub">
                    {token.userId ? (
                      <>
                        员工代调用 · <PersonTag employeeNo={token.employeeNo} id={token.employeeId} />
                      </>
                    ) : (
                      subject(token)
                    )}
                  </span>
                </div>
              ),
            },
            {
              title: "到期时间",
              width: 170,
              render: (_, token) => <time dateTime={token.expiresAt}>{formatTime(token.expiresAt)}</time>,
            },
            {
              title: "状态",
              width: 110,
              render: (_, token) => <tokenStatus.Badge value={token.status} />,
            },
            {
              title: "操作",
              width: 180,
              render: (_, token) => (
                <div className="op-row-actions">
                  <Button
                    type="link"
                    size="small"
                    disabled={busy}
                    onClick={() => {
                      setDetailId(token.tokenId);
                      setError("");
                    }}
                  >
                    详情 / 排障
                  </Button>
                  {revokeAction(token, locked || token.status !== "ACTIVE", true)}
                </div>
              ),
            },
          ]}
        />
      )}
      <EntityDrawer
        open={Boolean(detailId && active)}
        title="Token 详情与排障"
        status={detail && <tokenStatus.Badge value={detail.status} />}
        subtitle={detailId && <IdText value={detailId} label="Token 记录 ID" maxChars={40} />}
        onClose={() => {
          if (!locked) setDetailId(null);
        }}
      >
        <div className="credential-section">
          {feedback}
          <LoadFeedback {...details} retry={details.reload} />
          {detail && (
            <>
              <Descriptions
                column={1}
                size="small"
                bordered
                items={[
                  { key: "id", label: "记录 ID", children: <IdText value={detail.tokenId} label="记录 ID" maxChars={48} /> },
                  { key: "ak", label: "AK", children: <IdText value={detail.appKey} label="AK" maxChars={48} /> },
                  { key: "tenant", label: "租户", children: <TenantTag id={detail.tenantId} name={detail.tenantName} /> },
                  {
                    key: "subject",
                    label: "调用身份",
                    children: detail.userId ? (
                      <>
                        员工代调用 · <PersonTag employeeNo={detail.employeeNo} id={detail.employeeId} />
                      </>
                    ) : (
                      subject(detail)
                    ),
                  },
                  { key: "expires", label: "到期时间", children: formatTime(detail.expiresAt) },
                  { key: "scope", label: "调用权限组", children: detail.scopeCodes.join("、") || "无" },
                ]}
              />
              <p className="credential-hint">
                {detail.status === "INVALIDATED"
                  ? "授权已失效：核对凭据、租户及人员授权。重新绑定不会复活此Token。"
                  : detail.status === "ACTIVE"
                    ? "记录当前有效；若调用仍失败，核对API权限、生命周期和治理策略。"
                    : "此Token已不能调用；需要继续调用时，按当前有效授权重新签发。"}
              </p>
              <div className="credential-actions">
                <Button
                  disabled={busy || details.loading}
                  onClick={() => {
                    setNotice("");
                    details.reload();
                  }}
                >
                  刷新记录状态
                </Button>
                {onOpenRelations && (
                  <Button disabled={locked} onClick={onOpenRelations}>
                    查看租户与人员授权
                  </Button>
                )}
                {onOpenCalls && (
                  <Button disabled={locked} onClick={() => onOpenCalls(detail.tenantId, detail.employeeNo)}>
                    查询调用日志
                  </Button>
                )}
                {revokeAction(detail, locked || details.loading || detail.status !== "ACTIVE", false)}
              </div>
            </>
          )}
          {detailId && !details.loading && !details.error && details.data && !detail && (
            <p className="credential-hint">该记录不存在或不属于当前凭据。</p>
          )}
        </div>
      </EntityDrawer>
    </section>
  );
}
