import { PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ConfirmAction, EmptyState, EntityDrawer, FieldLabel, IdText, PageHeader, StatusBadge, TenantTag } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, FilterBar, useDebouncedCallback, type DataTableColumn } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Alert, Button, Input, Modal, Segmented } from "antd";
import { useEffect, useState } from "react";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { useListQuery } from "../navigation/useListQuery";
import type { AdminApi } from "./api";
import "./scopes.css";
import { associationHelp, RuleAssociationLink, useRuleAssociations } from "../governance/RuleAssociationLink";

interface TenantRow { tenantId: string; tenantName?: string | null; grantedScopeCount: number; updatedAt: string }
interface PermissionRow { id: string; code: string; name: string; enabled: boolean; publicAccess: boolean; grantId: string | null; grantStatus: "ACTIVE" | "REVOKED" | null; available: boolean }

function PermissionSearch({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const search = useDebouncedCallback(onChange, 300);
  return <Input aria-label={label} placeholder={label} prefix={<SearchOutlined />} maxLength={100} value={text}
    onChange={event => { setText(event.target.value); search.run(event.target.value); }} onPressEnter={() => search.flush(text)} />;
}

export default function TenantPermissionsPanel({ api }: { api: AdminApi }) {
  const navigation = useAdminNavigation();
  const query = useListQuery({ namespace: "tenantPermissions", defaults: { search: "" } });
  const [revision, setRevision] = useState(0);
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState("");
  const selected = navigation.route.tenantId;
  const list = useReadPage<TenantRow>(api, `/tenant-permissions?${new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), query: query.filters.search })}`, revision, true, { keepPrevious: true });
  const open = (tenantId: string) => navigation.navigate({ ...navigation.route, tenantId, managementFilters: Object.fromEntries(Object.entries(navigation.route.managementFilters ?? {}).filter(([key]) => !key.startsWith("tenantScopes."))) });
  const items = list.data?.items ?? [];
  const associations = useRuleAssociations(api, "TENANT", items.map(item => item.tenantId), revision);
  const columns: DataTableColumn<TenantRow>[] = [
    { key: "tenant", title: "租户", render: item => <span className="op-cell-main"><button type="button" className="op-cell-main__title is-link" onClick={() => open(item.tenantId)}>{item.tenantName ?? item.tenantId}</button>{item.tenantName && <IdText value={item.tenantId} label="租户 ID" />}</span> },
    { key: "count", title: "直接开通权限组", width: 170, align: "right", render: item => item.grantedScopeCount },
    { key: "governance", title: <FieldLabel label="限流规则" help={associationHelp} />, width: 100, align: "right", render: item => <RuleAssociationLink tenantId={item.tenantId} count={associations.data ? associations.data[item.tenantId] ?? 0 : null} loading={associations.loading} /> },
    { key: "time", title: "最近变更", width: 220, render: item => new Date(item.updatedAt).toLocaleString("zh-CN", { hour12: false }) },
    { key: "actions", title: "操作", width: 150, render: item => <Button type="link" onClick={() => open(item.tenantId)}>管理权限</Button> },
  ];
  return <section className="scope-list" aria-label="租户权限管理">
    <PageHeader title="租户权限" count={list.data?.total} meta="按租户管理 MCP 与门户的权限范围。列表展示已有开通记录的租户，其他租户可通过“选择租户”进入。"
      primaryAction={<Button type="primary" icon={<PlusOutlined />} onClick={() => { setTarget(""); setAdding(true); }}>选择租户</Button>}
      secondaryActions={<Button aria-label="刷新租户权限" icon={<ReloadOutlined />} onClick={() => { list.reload(); if (items.length) associations.reload(); }} />} />
    <div className="op-list-surface">
      <FilterBar chips={query.filters.search ? [{ key: "search", text: `租户：${query.filters.search}`, label: `租户：${query.filters.search}`, onRemove: () => query.setFilter("search", "") }] : []} onClearAll={() => query.clear()} search={<PermissionSearch label="按完整租户 ID 查找" value={query.filters.search} onChange={value => query.setFilter("search", value)} />} />
      <DataTable caption="已管理的租户" rowKey={item => item.tenantId} columns={columns} data={list.error ? [] : items} loading={list.loading}
        summary={`共 ${list.data?.total ?? 0} 个已管理租户`} pagination={list.data ? { page: query.page, pageSize: query.pageSize, total: list.data.total, onChange: (page, size) => size !== query.pageSize ? query.setPageSize(size) : query.setPage(page) } : undefined}
        empty={list.error ? <EmptyState kind="error" title="租户列表加载失败" description={list.error} action={<Button onClick={() => { list.reload(); if (items.length) associations.reload(); }}>重试</Button>} /> : <EmptyState title="暂无已管理租户" description="选择租户并开通专属权限组后，会显示在这里。公共通用权限无需逐租户开通。" />} />
    </div>
    <Modal open={adding} title="选择要管理的租户" okText="查看权限" cancelText="取消" okButtonProps={{ disabled: !target.trim() }} onCancel={() => setAdding(false)} onOk={() => { open(target.trim()); setAdding(false); }}>
      <p>输入完整租户 ID，即可查看权限组并按需开通。这里只选择管理对象，不会创建新的租户。</p>
      <Input aria-label="要管理的租户 ID" value={target} maxLength={64} onChange={event => setTarget(event.target.value)} autoFocus />
    </Modal>
    {selected && <TenantScopeEditor key={selected} api={api} tenantId={selected} tenantName={items.find(item => item.tenantId === selected)?.tenantName}
      onClose={() => navigation.navigate({ ...navigation.route, tenantId: undefined })} onChanged={() => setRevision(value => value + 1)} />}
  </section>;
}

function TenantScopeEditor({ api, tenantId, tenantName, onClose, onChanged }: { api: AdminApi; tenantId: string; tenantName?: string | null; onClose: () => void; onChanged: () => void }) {
  const navigation = useAdminNavigation();
  const query = useListQuery({ namespace: "tenantScopes", defaults: { search: "", filter: "ALL" } });
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const list = useReadPage<PermissionRow>(api, `/tenant-permissions/${encodeURIComponent(tenantId)}/scopes?${new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), query: query.filters.search, filter: query.filters.filter })}`, revision, true, { keepPrevious: true });
  const change = async (item: PermissionRow, revoke: boolean) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/scopes/${item.id}/tenant-grants${revoke ? `/${item.grantId}` : ""}`, revoke ? { method: "DELETE" } : { method: "POST", body: { tenantId } });
      setNotice(revoke ? (item.publicAccess ? "已撤销直接开通；公共通用权限仍然有效。" : "已撤销此权限组。") : (item.enabled ? "已开通此权限组。" : "开通记录已保存；权限组启用后才可使用。"));
      setRevision(value => value + 1); onChanged();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const columns: DataTableColumn<PermissionRow>[] = [
    { key: "scope", title: "权限组 / 代码", render: item => <span className="op-cell-main"><strong>{item.name}</strong><span className="op-cell-sub scope-code">{item.code}</span></span> },
    { key: "source", title: "权限来源", width: 128, render: item => <span>{item.publicAccess ? "公共通用" : item.grantStatus === "ACTIVE" ? "直接开通" : item.grantStatus === "REVOKED" ? "已撤销" : "未开通"}</span> },
    { key: "available", title: "当前可用", width: 128, render: item => <StatusBadge tone={item.available ? "success" : "neutral"}>{!item.enabled ? "权限组停用" : item.available ? "可用" : "不可用"}</StatusBadge> },
    { key: "actions", title: "操作", width: 180, render: item => <div className="op-row-actions">
      {item.grantStatus === "ACTIVE" ? <ConfirmAction title={`撤销「${item.name}」的直接开通？`} description={item.publicAccess ? "公共通用仍然有效；撤销直接开通不会收回这部分权限。" : "立即影响本租户的 MCP 工具与门户文档，不改变普通凭据授权。"} danger okText="撤销" onConfirm={() => change(item, true)} disabled={busy}>
        <Button type="link" danger disabled={busy}>撤销</Button>
      </ConfirmAction> : item.publicAccess ? <span className="op-muted">无需单独开通</span> : <Button type="link" disabled={busy} onClick={() => void change(item, false)}>{item.grantStatus === "REVOKED" ? "重新开通" : "开通"}</Button>}
      <Button type="link" disabled={busy} onClick={() => navigation.navigate({ page: "scopes", scopeId: item.id, scopeTab: "tenants", apiId: null, step: "outer", query: "", pageNo: 1 })}>查看组</Button>
    </div> },
  ];
  return <EntityDrawer open width="lg" title="租户权限" subtitle={<TenantTag id={tenantId} name={tenantName} />} onClose={() => !busy && onClose()}>
    <div className="scope-tenants">
      <p className="scope-note">公共通用权限自动适用，专属权限按需开通。这里的变更只影响 MCP 与门户展示，普通 API 凭据继续使用自身权限。</p>
      <Segmented aria-label="权限范围" value={query.filters.filter} onChange={value => query.setFilter("filter", String(value))} options={[{ label: "全部", value: "ALL" }, { label: "直接开通", value: "DIRECT" }, { label: "公共通用", value: "PUBLIC" }, { label: "未开通", value: "UNGRANTED" }]} />
      <PermissionSearch label="搜索权限组名称或代码" value={query.filters.search} onChange={value => query.setFilter("search", value)} />
      {error && <Alert type="error" showIcon title={error} closable onClose={() => setError("")} />}
      {notice && <Alert type="success" showIcon title={notice} />}
      <DataTable caption="租户可用权限组" rowKey={item => item.id} columns={columns} data={list.error ? [] : list.data?.items ?? []} loading={list.loading}
        pagination={list.data ? { page: query.page, pageSize: query.pageSize, total: list.data.total, onChange: (page, size) => size !== query.pageSize ? query.setPageSize(size) : query.setPage(page) } : undefined}
        empty={list.error ? <EmptyState kind="error" title="权限组读取失败" description={list.error} action={<Button onClick={list.reload}>重试</Button>} /> : <EmptyState title="没有匹配的权限组" />} />
    </div>
  </EntityDrawer>;
}
