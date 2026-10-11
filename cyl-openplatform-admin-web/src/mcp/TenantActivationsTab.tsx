import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import { ConfirmAction, EmptyState, FieldLabel, PersonTag, StatusBadge, TenantTag } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, FilterBar, QuickSelect, type DataTableColumn, type FilterChip } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Button, Input, Tooltip } from "antd";
import { useEffect, useState } from "react";
import type { AdminApi } from "../access/api";
import { formatTime } from "../access/credentialModel";
import { useListQuery } from "../navigation/useListQuery";
import { activationStatus, activationStatusFilters, type TenantActivation } from "./model";

const defaults = { tenantId: "", status: [] as string[] };

function TenantSearch({ value, onSearch }: { value: string; onSearch: (text: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Input
      allowClear
      aria-label="按租户 ID 查找"
      prefix={<SearchOutlined aria-hidden />}
      placeholder="输入完整租户 ID"
      maxLength={64}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        if (!event.target.value) onSearch("");
      }}
      onPressEnter={(event) => {
        if (!(event.nativeEvent as KeyboardEvent).isComposing) onSearch(text.trim());
      }}
    />
  );
}

/** 租户开通：由租户员工在门户自助开通；平台管理员可查看并停用/启用，平台停用后租户不能自行启用。 */
export default function TenantActivationsTab({ api }: { api: AdminApi }) {
  const query = useListQuery({ namespace: "mcpTenants", defaults });
  const { filters } = query;
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const parameters = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (filters.tenantId) parameters.set("tenantId", filters.tenantId);
  // 两种状态都选等于不筛选。
  if (filters.status.length === 1) parameters.set("status", filters.status[0]);
  const list = useReadPage<TenantActivation>(api, `/mcp/tenant-activations?${parameters}`, revision, true, { keepPrevious: true });
  const items = list.data?.items ?? [];

  const change = async (item: TenantActivation, enabled: boolean) => {
    setBusyId(item.id);
    setError("");
    setNotice("");
    try {
      await api(`/mcp/tenant-activations/${encodeURIComponent(item.id)}/status`, { method: "PUT", body: { enabled } });
      setNotice(enabled ? `已启用租户 ${item.tenantName || item.tenantId} 的 MCP。` : `已停用租户 ${item.tenantName || item.tenantId} 的 MCP，该租户的新调用将被拒绝。`);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusyId(null);
      setRevision((value) => value + 1);
    }
  };

  const chips: FilterChip[] = [];
  if (filters.tenantId)
    chips.push({ key: "tenantId", text: `租户：${filters.tenantId}`, label: `租户：${filters.tenantId}`, onRemove: () => query.setFilter("tenantId", "") });
  for (const value of filters.status) {
    const label = activationStatusFilters.find((option) => option.value === value)?.label ?? value;
    chips.push({ key: `status:${value}`, text: `状态：${label}`, label: `状态：${label}`, onRemove: () => query.setFilter("status", filters.status.filter((item) => item !== value)) });
  }
  const filtered = chips.length > 0;

  const columns: DataTableColumn<TenantActivation>[] = [
    { key: "tenant", title: "租户", hideable: false, render: (item) => <TenantTag name={item.tenantName} id={item.tenantId} /> },
    { key: "keyCode", title: "开通编号", width: 200, render: (item) => <span className="op-code">{item.keyCode}</span> },
    {
      key: "status",
      title: <FieldLabel label="状态" help="“平台已停用”由平台管理员停用，租户不能在门户自行启用；“租户已停用”可由租户自行启用。" />,
      label: "状态",
      width: 128,
      render: (item) => {
        const status = activationStatus(item);
        return <StatusBadge tone={status.tone}>{status.label}</StatusBadge>;
      },
    },
    { key: "activatedBy", title: "开通人", width: 200, render: (item) => <PersonTag name={item.activatedByName} employeeNo={item.activatedByEmployeeNo} stacked /> },
    { key: "createdAt", title: "开通时间", width: 136, render: (item) => <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time> },
    { key: "updatedAt", title: "更新时间", width: 136, render: (item) => <time dateTime={item.updatedAt}>{formatTime(item.updatedAt)}</time> },
    {
      key: "actions",
      title: "操作",
      width: 96,
      hideable: false,
      render: (item) =>
        item.status === "ENABLED" ? (
          <ConfirmAction
            title="停用该租户的 MCP？"
            description={`租户「${item.tenantName || item.tenantId}」经MCP 网关的新调用将被拒绝；平台停用后租户不能在门户自行启用。`}
            okText="确认停用"
            danger
            disabled={busyId !== null}
            onConfirm={() => change(item, false)}
          >
            <Button type="link" size="small" danger disabled={busyId !== null}>
              停用<span className="sr-only"> {item.tenantName || item.tenantId}</span>
            </Button>
          </ConfirmAction>
        ) : (
          <ConfirmAction
            title="启用该租户的 MCP？"
            description={`租户「${item.tenantName || item.tenantId}」可重新经MCP 网关调用工具。`}
            okText="确认启用"
            disabled={busyId !== null}
            onConfirm={() => change(item, true)}
          >
            <Button type="link" size="small" disabled={busyId !== null}>
              启用<span className="sr-only"> {item.tenantName || item.tenantId}</span>
            </Button>
          </ConfirmAction>
        ),
    },
  ];

  return (
    <section className="mcp-tenants" aria-label="租户开通">
      <div className="mcp-section__head">
        <p className="mcp-section__intro">每个租户由本租户员工在客户门户“我的接入”自助开通一次；这里查看全部开通并可停用或启用。</p>
        <Tooltip title="刷新">
          <Button icon={<ReloadOutlined />} aria-label="刷新租户开通列表" onClick={list.reload} />
        </Tooltip>
      </div>
      <ErrorFeedback error={error} />
      {notice && <p role="status" className="credential-notice">{notice}</p>}
      <div className="op-list-surface">
        <FilterBar
          search={<TenantSearch value={filters.tenantId} onSearch={(text) => text !== filters.tenantId && query.setFilter("tenantId", text)} />}
          quick={
            <QuickSelect
              label="状态"
              mode="multiple"
              value={filters.status}
              onChange={(values: string[]) => query.setFilter("status", values)}
              options={activationStatusFilters}
              style={{ width: 168 }}
            />
          }
          chips={chips}
          onClearAll={() => query.clear()}
        />
        <DataTable<TenantActivation>
          caption="租户开通列表"
          rowKey={(item) => item.id}
          columns={columns}
          data={list.error ? [] : items}
          loading={list.loading}
          settingsKey="mcpTenants"
          summary={list.data ? (filtered ? `筛选出 ${list.data.total} 个租户` : `共 ${list.data.total} 个租户已开通`) : undefined}
          pagination={
            list.data
              ? { page: query.page, pageSize: query.pageSize, total: list.data.total, onChange: (page, size) => (size !== query.pageSize ? query.setPageSize(size) : query.setPage(page)) }
              : undefined
          }
          empty={
            list.error ? (
              <EmptyState kind="error" title="租户开通列表加载失败" description={list.error} action={<Button onClick={list.reload}>重新加载</Button>} />
            ) : filtered ? (
              <EmptyState kind="noResult" title="没有符合条件的租户" description="租户 ID 需完整输入。" action={<Button onClick={() => query.clear()}>清除筛选</Button>} />
            ) : (
              <EmptyState title="还没有租户开通 MCP" description="租户员工在客户门户“我的接入”点击“开通 MCP”后会出现在这里。" />
            )
          }
        />
      </div>
    </section>
  );
}
