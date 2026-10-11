import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import { ConfirmAction, EmptyState, IdText, PersonTag, StatusBadge, TenantTag } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, type DataTableColumn } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Button, Input } from "antd";
import { useState } from "react";
import type { AdminApi, Scope, TenantScopeGrant } from "./api";
import { scopeHelp } from "./scopeModel";

const formatTime = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });

/** 权限组抽屉“已开通租户”：按租户 ID 开通、撤销（保留记录）、重新开通；不影响凭据与 Token。 */
export default function ScopeTenantGrants({ api, scope, onChanged }: { api: AdminApi; scope: Scope; onChanged: () => void }) {
  const base = `/scopes/${encodeURIComponent(scope.id)}/tenant-grants`;
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const list = useReadPage<TenantScopeGrant>(api, `${base}?page=${page}&pageSize=20`, revision, true, { keepPrevious: true });
  const [tenantId, setTenantId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const run = async (action: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setNotice(await action());
      setRevision((value) => value + 1);
      onChanged();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const grant = (target: string) =>
    run(async () => {
      const saved = await api<TenantScopeGrant>(base, { method: "POST", body: { tenantId: target } });
      setTenantId("");
      setPage(1);
      return `已为租户 ${saved.tenantName ?? saved.tenantId} 开通此权限组。`;
    });

  const revoke = (item: TenantScopeGrant) =>
    run(async () => {
      await api<TenantScopeGrant>(`${base}/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      return `已撤销租户 ${item.tenantName ?? item.tenantId} 的此权限组，记录保留。`;
    });

  const columns: DataTableColumn<TenantScopeGrant>[] = [
    {
      key: "tenant",
      title: "租户",
      hideable: false,
      render: (item) => (
        <span className="op-cell-main">
          <TenantTag id={item.tenantId} name={item.tenantName} />
          {item.tenantName && (
            <span className="op-cell-sub">
              <IdText value={item.tenantId} label="租户 ID" maxChars={24} />
            </span>
          )}
        </span>
      ),
    },
    {
      key: "status",
      title: "状态",
      width: 96,
      render: (item) => <StatusBadge tone={item.status === "ACTIVE" ? "success" : "neutral"}>{item.status === "ACTIVE" ? "已开通" : "已撤销"}</StatusBadge>,
    },
    {
      key: "grantedBy",
      title: "开通人",
      width: 160,
      render: (item) => <PersonTag name={item.grantedByName} employeeNo={item.grantedByEmployeeNo} stacked />,
    },
    {
      key: "time",
      title: "时间",
      width: 200,
      render: (item) => `${item.status === "ACTIVE" ? "开通于" : "撤销于"} ${formatTime(item.updatedAt)}`,
    },
    {
      key: "actions",
      title: "操作",
      width: 104,
      hideable: false,
      render: (item) => (
        <div className="op-row-actions">
          {item.status === "ACTIVE" ? (
            <ConfirmAction
              title={`撤销租户 ${item.tenantName ?? item.tenantId} 的此权限组？`}
              description={
                scope.publicAccess
                  ? "此组当前是公共通用，撤销后该租户仍可使用；关闭公共通用后才不再可用。记录保留，可再次开通。"
                  : "撤销后该租户不能再在 MCP 工具与门户中使用此组的 API。记录保留，可再次开通；不影响凭据与 Token。"
              }
              okText="撤销"
              danger
              disabled={busy}
              onConfirm={() => revoke(item)}
            >
              <Button type="link" size="small" danger disabled={busy}>
                撤销<span className="sr-only"> {item.tenantId}</span>
              </Button>
            </ConfirmAction>
          ) : (
            <Button type="link" size="small" disabled={busy} onClick={() => void grant(item.tenantId)}>
              重新开通<span className="sr-only"> {item.tenantId}</span>
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="scope-tenants">
      <p className="scope-note">
        {scopeHelp.tenantGrants}
        {scope.publicAccess && " 此组当前是公共通用，所有租户都可使用；这里的开通记录在关闭公共通用后才起作用。"}
        {!scope.enabled && " 权限组已停用，开通记录暂不计入。"}
      </p>
      <form
        className="scope-add"
        aria-label="按租户 ID 开通"
        onSubmit={(event) => {
          event.preventDefault();
          if (tenantId.trim()) void grant(tenantId.trim());
        }}
      >
        <Input
          aria-label="租户 ID"
          placeholder="输入租户 ID"
          maxLength={64}
          disabled={busy}
          value={tenantId}
          onChange={(event) => setTenantId(event.target.value)}
          className="scope-add__input"
        />
        <Button type="primary" htmlType="submit" loading={busy} disabled={!tenantId.trim()}>
          开通
        </Button>
      </form>
      <ErrorFeedback error={error} />
      {notice && (
        <p className="scope-success" role="status">
          {notice}
        </p>
      )}
      <DataTable<TenantScopeGrant>
        caption="已开通此权限组的租户"
        rowKey={(item) => item.id}
        columns={columns}
        data={list.error ? [] : (list.data?.items ?? [])}
        loading={list.loading}
        pagination={list.data ? { page, pageSize: 20, total: list.data.total, onChange: (next) => setPage(next) } : undefined}
        empty={
          list.error ? (
            <EmptyState kind="error" title="租户列表加载失败" description={list.error} action={<Button onClick={list.reload}>重新加载</Button>} />
          ) : (
            <EmptyState title="还没有开通给任何租户" description="输入租户 ID 开通后，该租户即可在 MCP 工具与门户中使用此组的 API。" />
          )
        }
      />
    </div>
  );
}
