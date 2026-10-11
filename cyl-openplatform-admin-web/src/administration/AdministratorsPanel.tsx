import { PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import { EmptyState, EntityDrawer, FieldHelp, FieldLabel, PageHeader, StatusBadge, TenantTag } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, FilterBar, QuickSelect, useDebouncedCallback, type DataTableColumn, type FilterChip } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Button, Drawer, Input, Tooltip } from "antd";
import { useEffect, useState } from "react";
import type { AdminApi } from "../access/api";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { useListQuery } from "../navigation/useListQuery";
import AdministratorEditor from "./AdministratorEditor";
import AdministratorHistory from "./AdministratorHistory";
import { isLastSuper, lastSuperReason, permissionText, roleText, type AdministratorStatus } from "./administratorModel";
import type { Administrator } from "./types";
import "./administrators.css";

const defaults = { search: "", superAdministrator: "", enabled: "", tenantId: "" };
const manageOnly = "仅总管理员可核验员工、分配或撤销管理资格。";
type Tab = "permissions" | "audit";

function AdministratorSearch({ value, onSearch }: { value: string; onSearch: (text: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const debounced = useDebouncedCallback((next: string) => onSearch(next.trim()));
  return (
    <Input
      allowClear
      aria-label="搜索管理员"
      prefix={<SearchOutlined aria-hidden />}
      placeholder="搜索姓名或完整工号"
      maxLength={64}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        debounced.run(event.target.value);
      }}
      onPressEnter={(event) => {
        if (!(event.nativeEvent as KeyboardEvent).isComposing) debounced.flush(text);
      }}
    />
  );
}

/** 113 管理员：统一列表范式 + 抽屉（权限、变更记录）；抽屉地址沿用 `administrator=<id>&administratorView=…`。 */
export default function AdministratorsPanel({
  api,
  canManage,
  canRead,
  onChanged,
  currentTenantId = "",
}: {
  api: AdminApi;
  canManage: boolean;
  canRead: boolean;
  onChanged: () => void;
  currentTenantId?: string;
}) {
  const navigation = useAdminNavigation(),
    route = navigation.route;
  const query = useListQuery({ namespace: "administrators", defaults, legacyKeys: { name: "search" } });
  const { filters } = query;
  const [revision, setRevision] = useState(0),
    [message, setMessage] = useState("");
  const [status, setStatus] = useState<AdministratorStatus | null>(null),
    [statusError, setStatusError] = useState("");
  const [current, setCurrent] = useState<Administrator | null>(null),
    [detailError, setDetailError] = useState(""),
    [loading, setLoading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const id = route.administratorId ?? null,
    view = route.administratorView;
  const [tab, setTab] = useState<Tab>(view === "audit" ? "audit" : "permissions");
  useEffect(() => setTab(view === "audit" ? "audit" : "permissions"), [id, view]);

  const parameters = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  for (const [key, value] of Object.entries(filters)) if (value.trim()) parameters.set(key, value.trim());
  const list = useReadPage<Administrator>(api, `/administrators?${parameters}`, revision, canRead, { keepPrevious: true });

  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    setStatusError("");
    void api<AdministratorStatus>("/administrators/status", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setStatus(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setStatus(null);
          setStatusError((failure as Error).message);
        }
      });
    return () => controller.abort();
  }, [api, revision, canRead]);
  useEffect(() => {
    setCurrent((value) => (value?.id === id ? value : null));
    setDetailError("");
    setLoading(Boolean(canRead && id && id !== "new"));
    if (!canRead || !id || id === "new") return;
    const controller = new AbortController();
    void api<Administrator>(`/administrators/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setCurrent(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setDetailError((failure as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, id, canRead, revision]);
  const selected = current?.id === id ? current : null;

  const close = () => navigation.navigate({ ...route, administratorId: null, administratorView: undefined });
  const open = (administratorId: string | null, administratorView: "edit" | "revoke" | "audit") => {
    setMessage("");
    navigation.navigate({ ...route, administratorId, administratorView });
  };

  const chips: FilterChip[] = [];
  const chip = (key: keyof typeof defaults, text: string) => chips.push({ key, text, label: text, onRemove: () => query.setFilter(key, "") });
  if (filters.search) chip("search", `搜索：${filters.search}`);
  if (filters.superAdministrator) chip("superAdministrator", `角色：${roleText(filters.superAdministrator === "true")}`);
  if (filters.enabled) chip("enabled", `状态：${filters.enabled === "true" ? "启用" : "停用"}`);
  if (filters.tenantId) chip("tenantId", `租户 ID：${filters.tenantId}`);
  const filtered = chips.length > 0;

  const columns: DataTableColumn<Administrator>[] = [
    {
      key: "person",
      title: "人员",
      hideable: false,
      render: (item) => (
        <span className="op-cell-main">
          <Tooltip title={<span className="op-code">员工编号 {item.employeeId}</span>}>
            <button type="button" className="op-cell-main__title is-link" onClick={() => open(item.id, canManage ? "edit" : "audit")}>
              {item.displayName}
            </button>
          </Tooltip>
          <span className="op-cell-sub">工号 {item.employeeNo}</span>
        </span>
      ),
    },
    { key: "tenant", title: "租户", width: "16%", render: (item) => <TenantTag id={item.tenantId} name={item.tenantName} /> },
    {
      key: "role",
      title: "角色",
      width: 112,
      render: (item) => <StatusBadge tone={item.superAdministrator ? "info" : "neutral"}>{roleText(item.superAdministrator)}</StatusBadge>,
    },
    {
      key: "permissions",
      title: "业务能力",
      ellipsis: true,
      render: (item) => <span title={permissionText(item.permissions)}>{permissionText(item.permissions)}</span>,
    },
    {
      key: "enabled",
      title: "状态",
      width: 88,
      render: (item) => <StatusBadge tone={item.enabled ? "success" : "neutral"}>{item.enabled ? "启用" : "停用"}</StatusBadge>,
    },
    {
      key: "actions",
      title: "操作",
      width: 168,
      hideable: false,
      render: (item) => (
        <div className="op-row-actions">
          <Tooltip title={canManage ? undefined : manageOnly}>
            <Button type="link" size="small" disabled={!canManage} onClick={() => open(item.id, "edit")}>
              调整权限<span className="sr-only"> {item.displayName}</span>
            </Button>
          </Tooltip>
          <Tooltip title={canRead ? undefined : "需要审计查看权限（VIEW_AUDIT）"}>
            <Button type="link" size="small" disabled={!canRead} onClick={() => open(item.id, "audit")}>
              变更记录<span className="sr-only"> {item.displayName}</span>
            </Button>
          </Tooltip>
        </div>
      ),
    },
  ];

  const lastSuper = isLastSuper(selected, status);
  const revokeAction = selected?.enabled && (
    <Tooltip title={!canManage ? manageOnly : lastSuper ? lastSuperReason : undefined}>
      <Button danger disabled={!canManage || lastSuper || view === "revoke"} onClick={() => open(selected.id, "revoke")}>
        撤销管理资格
      </Button>
    </Tooltip>
  );
  const editor = (administrator: Administrator | null) => (
    <AdministratorEditor
      key={`${id}:${view === "revoke" ? "revoke" : "edit"}`}
      api={api}
      initialTenantId={currentTenantId}
      administrator={administrator}
      revoking={view === "revoke"}
      canManage={canManage}
      status={status}
      onClose={close}
      onSaved={() => {
        close();
        setRevision((value) => value + 1);
        setMessage("管理员权限已更新；后续管理请求立即使用新权限，门户自助资格不受影响。");
        onChanged();
      }}
    />
  );

  return (
    <section className="administrator-list" aria-labelledby="administrators-title">
      <PageHeader
        title={<span id="administrators-title">管理员</span>}
        count={list.data?.total}
        meta={
          status && (
            <span className="administrator-health">
              启用的总管理员 <strong>{status.enabledSuperAdministratorCount}</strong> 人
              <FieldHelp label="资格与权限">
                平台启用数量不代表平台人员仍然有效；登录还须核验本地账号身份。总管理员负责分配管理资格，不自动获得业务权限。没有有效总管理员时请联系运维核验并恢复。
              </FieldHelp>
            </span>
          )
        }
        secondaryActions={
          <>
            <Button disabled={!canRead} onClick={() => open(null, "audit")}>
              授权变更记录
            </Button>
            <Tooltip title="刷新">
              <Button icon={<ReloadOutlined />} aria-label="刷新管理员列表" onClick={() => setRevision((value) => value + 1)} />
            </Tooltip>
          </>
        }
        primaryAction={
          <Tooltip title={canManage ? undefined : manageOnly}>
            <Button type="primary" icon={<PlusOutlined />} disabled={!canManage} onClick={() => open("new", "edit")}>
              分配管理员
            </Button>
          </Tooltip>
        }
      />
      {!canManage && (
        <p className="administrator-callout">
          {manageOnly}请联系总管理员。
          {canRead ? "当前可只读查看名单与变更记录。" : "当前已无查看权限，未保存输入仍保留。"}
        </p>
      )}
      {status?.enabledSuperAdministratorCount === 0 && (
        <p className="administrator-callout administrator-callout--warning" role="alert">
          暂无启用的总管理员，请联系运维核验和恢复。
        </p>
      )}
      {statusError && (
        <div className="administrator-callout administrator-callout--warning">
          <ErrorFeedback error={`无法读取管理员健康状态：${statusError}`} />
          <Button onClick={() => setRevision((value) => value + 1)}>重新检查</Button>
        </div>
      )}
      {message && (
        <p role="status" className="administrator-callout administrator-callout--success">
          {message}
        </p>
      )}
      <div className="op-list-surface">
        <FilterBar
          search={<AdministratorSearch value={filters.search} onSearch={(text) => text !== filters.search && query.setFilter("search", text)} />}
          quick={
            <>
              <QuickSelect
                label="角色"
                allowClear
                value={filters.superAdministrator || undefined}
                onChange={(value?: string) => query.setFilter("superAdministrator", value ?? "")}
                options={[
                  { value: "true", label: "总管理员" },
                  { value: "false", label: "普通管理员" },
                ]}
                style={{ width: 168 }}
              />
              <QuickSelect
                label="状态"
                allowClear
                value={filters.enabled || undefined}
                onChange={(value?: string) => query.setFilter("enabled", value ?? "")}
                options={[
                  { value: "true", label: "启用" },
                  { value: "false", label: "停用" },
                ]}
                style={{ width: 140 }}
              />
            </>
          }
          moreCount={query.activeCount(["tenantId"])}
          onMore={() => setMoreOpen(true)}
          chips={chips}
          onClearAll={() => query.clear()}
        />
        <DataTable<Administrator>
          caption="管理员列表"
          rowKey={(item) => item.id}
          columns={columns}
          data={list.error ? [] : (list.data?.items ?? [])}
          loading={list.loading}
          settingsKey="administrators"
          onRowClick={(item) => open(item.id, canManage ? "edit" : "audit")}
          rowClassName={(item) => (item.id === id ? "administrator-row--active" : "")}
          summary={list.data ? (filtered ? `筛选出 ${list.data.total} 名管理员` : `共 ${list.data.total} 名管理员`) : undefined}
          pagination={
            list.data
              ? { page: query.page, pageSize: query.pageSize, total: list.data.total, onChange: (page, size) => (size !== query.pageSize ? query.setPageSize(size) : query.setPage(page)) }
              : undefined
          }
          empty={
            list.error ? (
              <EmptyState kind="error" title="管理员名单加载失败" description={list.error} action={<Button onClick={list.reload}>重新加载</Button>} />
            ) : filtered ? (
              <EmptyState kind="noResult" title="没有符合条件的管理员" description="姓名按包含匹配，工号需完整输入。" action={<Button onClick={() => query.clear()}>清除筛选</Button>} />
            ) : (
              <EmptyState title="暂无管理员" />
            )
          }
        />
      </div>
      <Drawer
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="更多筛选"
        size={400}
        destroyOnHidden
        footer={
          <div className="administrator-drawer-footer">
            <Button onClick={() => query.clear(["tenantId"])}>清除这些条件</Button>
            <Button type="primary" onClick={() => setMoreOpen(false)}>
              完成
            </Button>
          </div>
        }
      >
        <label className="administrator-field">
          <FieldLabel label="租户 ID" help="按员工所属租户精确匹配。" />
          <Input
            aria-label="租户 ID"
            maxLength={64}
            defaultValue={filters.tenantId}
            onPressEnter={(event) => query.setFilter("tenantId", event.currentTarget.value.trim())}
            onBlur={(event) => event.target.value.trim() !== filters.tenantId && query.setFilter("tenantId", event.target.value.trim())}
          />
        </label>
      </Drawer>
      {id === "new" && (
        <EntityDrawer open width="lg" title="分配管理员" onClose={close}>
          {editor(null)}
        </EntityDrawer>
      )}
      {id && id !== "new" && (
        <EntityDrawer
          open
          width="lg"
          title={selected?.displayName ?? "管理员"}
          status={selected && <StatusBadge tone={selected.enabled ? "success" : "neutral"}>{selected.enabled ? "启用" : "停用"}</StatusBadge>}
          subtitle={
            selected && (
              <span className="administrator-subtitle">
                <span>工号 {selected.employeeNo}</span>
                <TenantTag id={selected.tenantId} name={selected.tenantName} />
                <span>{roleText(selected.superAdministrator)}</span>
              </span>
            )
          }
          actions={revokeAction}
          loading={!selected && loading}
          onClose={close}
          tabs={
            selected
              ? [
                  { key: "permissions", label: "权限", children: editor(selected) },
                  { key: "audit", label: "变更记录", children: <AdministratorHistory api={api} administratorId={selected.id} canRead={canRead} /> },
                ]
              : undefined
          }
          activeTab={tab}
          onTabChange={(key) => setTab(key as Tab)}
        >
          {detailError && (
            <div className="administrator-callout administrator-callout--warning">
              <ErrorFeedback error={detailError} />
              <Button onClick={() => setRevision((value) => value + 1)}>重新加载</Button>
            </div>
          )}
        </EntityDrawer>
      )}
      {!id && view === "audit" && (
        <EntityDrawer open width="lg" title="授权变更记录" subtitle="全部管理员的资格分配、调整与撤销" onClose={close}>
          <AdministratorHistory api={api} canRead={canRead} />
        </EntityDrawer>
      )}
    </section>
  );
}
