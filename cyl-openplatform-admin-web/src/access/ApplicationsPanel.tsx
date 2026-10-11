import { EllipsisOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { CopyButton, EmptyState, FieldLabel, IdText, PageHeader, TenantTag } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, FilterBar, QuickSelect, useDebouncedCallback, type DataTableColumn, type FilterChip } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Button, Checkbox, Drawer, Dropdown, Input, Tooltip } from "antd";
import { useEffect, useRef, useState } from "react";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { useListQuery } from "../navigation/useListQuery";
import type { AdminApi, Application, Credential } from "./api";
import ApplicationDetail from "./ApplicationDetail";
import CreateCredentialDrawer from "./CreateCredentialDrawer";
import { credentialStatus, formatTime, looksLikeRawToken, type CredentialTab, type RouteCredentialTab } from "./credentialModel";
import "./credentials.css";
import { associationHelp, RuleAssociationLink, useRuleAssociations } from "../governance/RuleAssociationLink";

const relationNames: Record<string, string> = { ACTIVE: "有效关联", REVOKED: "已解绑" };
const defaults = { search: "", tokenId: "", status: [] as string[], tenantId: "", relationStatus: [] as string[] };

/** 主搜索框：AK（兼容旧名称查询）。输入完整 Token 时不提交（不进入地址与请求），提示改用 Token 记录 ID 输入框。 */
function CredentialSearch({ value, onSearch }: { value: string; onSearch: (text: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const rawToken = looksLikeRawToken(text);
  const debounced = useDebouncedCallback((next: string) => {
    if (!looksLikeRawToken(next)) onSearch(next.trim());
  });
  return (
    <Tooltip open={rawToken} title="不要粘贴完整 Token；请在右侧“Token 记录 ID”中输入记录 ID（TOK_ 开头）。" placement="bottomLeft">
      <Input
        allowClear
        aria-label="搜索凭据"
        status={rawToken ? "error" : undefined}
        prefix={<SearchOutlined aria-hidden />}
        placeholder="搜索 AK"
        maxLength={100}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          debounced.run(event.target.value);
        }}
        onPressEnter={(event) => {
          if (!(event.nativeEvent as KeyboardEvent).isComposing) debounced.flush(text);
        }}
      />
    </Tooltip>
  );
}

/** Token 记录 ID 精确定位（量大、语义不同，独立于主搜索）：回车或失焦后生效，格式不对时就地提示且不发请求。 */
function TokenIdSearch({ value, onSearch }: { value: string; onSearch: (tokenId: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const trimmed = text.trim();
  const invalid = trimmed !== "" && !/^TOK_[0-9a-f]{32}$/i.test(trimmed) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
  const submit = () => {
    if (!invalid && trimmed !== value) onSearch(trimmed);
  };
  return (
    <Tooltip open={invalid && trimmed.length > 4} title="请输入 Token 记录 ID（TOK_ 开头）；不要粘贴完整 Token。" placement="bottomLeft">
      <Input
        allowClear
        aria-label="Token 记录 ID"
        className="credential-token-search"
        status={invalid ? "error" : undefined}
        placeholder="Token 记录 ID 定位"
        maxLength={64}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (!event.target.value) onSearch("");
        }}
        onPressEnter={submit}
        onBlur={submit}
      />
    </Tooltip>
  );
}

/** 租户快捷筛选：按关联租户精确匹配；可选当前页已出现的租户名称，也可直接输入租户 ID。 */
function TenantFilter({ value, known, onChange }: { value: string; known: Record<string, string>; onChange: (tenantId: string) => void }) {
  const [typed, setTyped] = useState("");
  const options = [
    ...(typed.trim() && !known[typed.trim()] ? [{ value: typed.trim(), label: `租户 ID：${typed.trim()}` }] : []),
    ...(value && !known[value] && value !== typed.trim() ? [{ value, label: `租户 ID：${value}` }] : []),
    ...Object.entries(known).map(([id, name]) => ({ value: id, label: name })),
  ];
  return (
    <QuickSelect
      label="租户"
      showSearch
      allowClear
      value={value || undefined}
      filterOption={(input, option) => String(option?.label ?? "").includes(input) || String(option?.value ?? "") === input}
      onSearch={(text) => setTyped(text.slice(0, 64))}
      onChange={(next) => {
        setTyped("");
        onChange(typeof next === "string" ? next : "");
      }}
      notFoundContent="输入租户 ID 后选择"
      options={options}
      style={{ width: 200 }}
    />
  );
}

export default function ApplicationsPanel({
  api,
  applicationId,
  tab,
  onSelect,
  onBack,
  canReadCalls = false,
}: {
  api: AdminApi;
  applicationId?: string | null;
  tab?: RouteCredentialTab;
  onSelect?: (id: string, tab?: RouteCredentialTab) => void;
  onBack?: () => void;
  canReadCalls?: boolean;
}) {
  const navigation = useAdminNavigation();
  const selectedId = applicationId ?? navigation.route.applicationId;
  const query = useListQuery({ namespace: "credentials", defaults, legacyKeys: { query: "search", appKey: "search" } });
  const { filters } = query;
  const [moreOpen, setMoreOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ id: string; credential: Credential } | null>(null);
  const [revision, setRevision] = useState(0);
  const autoOpened = useRef("");

  const select = (id: string, nextTab?: CredentialTab) => {
    const routeTab = nextTab === "overview" ? undefined : nextTab;
    if (onSelect) onSelect(id, routeTab);
    else navigation.navigate({ ...navigation.route, page: "applications", applicationId: id, applicationTab: routeTab });
  };
  const close = () => {
    if (onBack) onBack();
    else navigation.navigate({ ...navigation.route, applicationId: null, applicationTab: undefined, tenantId: undefined, employeeNo: undefined });
    setRevision((value) => value + 1);
  };
  useEffect(() => {
    if (created && created.id !== selectedId) setCreated(null);
  }, [selectedId, created]);

  const parameters = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (filters.search) parameters.set("search", filters.search);
  if (filters.tokenId) parameters.set("tokenId", filters.tokenId);
  if (filters.tenantId) parameters.set("tenantId", filters.tenantId);
  filters.status.forEach((value) => parameters.append("status", value));
  filters.relationStatus.forEach((value) => parameters.append("relationStatus", value));
  const list = useReadPage<Application>(api, `/applications?${parameters}`, revision, true, { keepPrevious: true });
  const items = list.data?.items ?? [];
  const associations = useRuleAssociations(api, 'APPLICATION', items.map(item => item.id), revision);
  const matched = items.length === 1 && items[0].matchedTokenId ? items[0] : null;

  // Token 记录 ID 命中时直接打开所属凭据的 Token 页签；同一次定位只自动打开一次，关闭后不再弹出。
  useEffect(() => {
    if (!matched || selectedId || autoOpened.current === filters.tokenId) return;
    autoOpened.current = filters.tokenId;
    select(matched.id, "tokens");
  }, [matched?.id, filters.tokenId, selectedId]);

  const knownTenants: Record<string, string> = {};
  for (const item of items) Object.assign(knownTenants, item.tenantNames ?? {});

  const chips: FilterChip[] = [];
  if (filters.search) chips.push({ key: "search", text: `搜索：${filters.search}`, label: `搜索：${filters.search}`, onRemove: () => query.setFilter("search", "") });
  if (filters.tokenId) chips.push({ key: "tokenId", text: `Token 记录：${filters.tokenId}`, label: `Token 记录：${filters.tokenId}`, onRemove: () => query.setFilter("tokenId", "") });
  for (const value of filters.status)
    chips.push({ key: `status:${value}`, text: `状态：${credentialStatus.get(value).label}`, label: `状态：${credentialStatus.get(value).label}`, onRemove: () => query.setFilter("status", filters.status.filter((item) => item !== value)) });
  if (filters.tenantId) {
    const label = `租户：${knownTenants[filters.tenantId] ?? filters.tenantId}`;
    chips.push({ key: "tenantId", text: label, label, onRemove: () => query.setFilter("tenantId", "") });
  }
  for (const value of filters.relationStatus)
    chips.push({ key: `relation:${value}`, text: `关联：${relationNames[value]}`, label: `关联：${relationNames[value]}`, onRemove: () => query.setFilter("relationStatus", filters.relationStatus.filter((item) => item !== value)) });
  const filtered = chips.length > 0;

  const columns: DataTableColumn<Application>[] = [
    {
      key: "appKey",
      title: "AK",
      width: 310,
      hideable: false,
      render: (item) => (
        <div className="op-row-actions">
          <button type="button" className="op-cell-main__title is-link credential-name" id={`credential-${item.id}`} onClick={() => select(item.id)} aria-label={`查看凭据 ${item.appKey}`}>
            <IdText value={item.appKey} label="AK" maxChars={40} copyable={false} />
          </button>
          <CopyButton value={item.appKey} label="AK" />
        </div>
      ),
    },
    {
      key: "tenants",
      title: "租户",
      render: (item) => {
        const grants = item.matchedTenantGrants ?? [];
        if (!grants.length) return <span className="op-muted">{item.tenantGrantCount ? "无匹配关联" : "暂无关联"}</span>;
        const more = (item.tenantGrantCount ?? grants.length) - 1;
        return (
          <span className="credential-tenants">
            <TenantTag id={grants[0].tenantId} name={item.tenantNames?.[grants[0].tenantId]} />
            {grants[0].status === "REVOKED" && <span className="op-cell-sub">已解绑</span>}
            {more > 0 && <span className="op-cell-sub">等 {more + 1} 个</span>}
          </span>
        );
      },
    },
    { key: "scopes", title: "权限组数", width: 88, align: "right", render: (item) => item.scopeCodes.length },
    { key: "governance", title: <FieldLabel label="限流规则" help={associationHelp} />, label: "限流规则", width: 96, align: "right", render: (item) => <RuleAssociationLink appKey={item.appKey} count={associations.data ? associations.data[item.id] ?? 0 : null} loading={associations.loading} /> },
    { key: "status", title: "状态", width: 88, render: (item) => <credentialStatus.Badge value={item.status} /> },
    {
      key: "lastCalled",
      title: "最近调用",
      label: "最近调用时间",
      width: 116,
      render: (item) => <span className="op-cell-sub" title={item.lastCalledAt ?? undefined}>{formatTime(item.lastCalledAt)}</span>,
    },
    {
      key: "actions",
      title: "操作",
      width: 160,
      hideable: false,
      render: (item) => (
        <div className="op-row-actions">
          <Button type="link" size="small" onClick={() => select(item.id)}>查看</Button>
          <Button type="link" size="small" onClick={() => select(item.id, "tokens")}>Token</Button>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "grants", label: "授权租户与人员" },
                { key: "scopes", label: "权限组" },
                { key: "signature", label: "签名密钥" },
                { key: "audit", label: "操作记录" },
              ],
              onClick: ({ key }) => select(item.id, key as CredentialTab),
            }}
          >
            <Button type="text" size="small" icon={<EllipsisOutlined />} aria-label={`${item.appKey}更多操作`} />
          </Dropdown>
        </div>
      ),
    },
  ];

  return (
    <section className="credential-list op-list-page" aria-labelledby="credentials-title">
      <PageHeader
        title={<span id="credentials-title">接入凭据</span>}
        count={list.data?.total}
        secondaryActions={
          <Tooltip title="刷新">
            <Button icon={<ReloadOutlined />} aria-label="刷新凭据列表" onClick={() => { list.reload(); if (items.length) associations.reload(); }} />
          </Tooltip>
        }
        primaryAction={
          <Button type="primary" icon={<PlusOutlined />} disabled={Boolean(created)} onClick={() => setCreating(true)}>
            新建凭据
          </Button>
        }
      />
      <div className="op-list-surface">
        <FilterBar
          search={<CredentialSearch value={filters.search} onSearch={(text) => text !== filters.search && query.setFilter("search", text)} />}
          quick={
            <>
              <QuickSelect
                label="状态"
                mode="multiple"
                value={filters.status}
                onChange={(values: string[]) => query.setFilter("status", values)}
                options={Object.entries(credentialStatus.map).map(([value, item]) => ({ value, label: item.label }))}
                style={{ width: 170 }}
              />
              <TenantFilter value={filters.tenantId} known={knownTenants} onChange={(tenantId) => query.setFilter("tenantId", tenantId)} />
              <TokenIdSearch value={filters.tokenId} onSearch={(tokenId) => query.setFilter("tokenId", tokenId)} />
            </>
          }
          moreCount={query.activeCount(["relationStatus"])}
          onMore={() => setMoreOpen(true)}
          chips={chips}
          onClearAll={() => query.clear()}
        />
        <DataTable<Application>
          caption="接入凭据列表"
          rowKey={(item) => item.id}
          columns={columns}
          data={list.error ? [] : items}
          loading={list.loading}
          settingsKey="credentials"
          summary={list.data ? (filtered ? `筛选出 ${list.data.total} 个凭据` : `共 ${list.data.total} 个凭据`) : undefined}
          rowClassName={(item) => (item.id === selectedId ? "credential-row--active" : "")}
          pagination={
            list.data
              ? { page: query.page, pageSize: query.pageSize, total: list.data.total, onChange: (page, size) => (size !== query.pageSize ? query.setPageSize(size) : query.setPage(page)) }
              : undefined
          }
          empty={
            list.error ? (
              <EmptyState kind="error" title="凭据列表加载失败" description={list.error} action={<Button onClick={() => { list.reload(); if (items.length) associations.reload(); }}>重新加载</Button>} />
            ) : filtered ? (
              <EmptyState kind="noResult" title="没有符合条件的凭据" description="名称按包含匹配，AK 与 Token 记录 ID 需完整输入。" action={<Button onClick={() => query.clear()}>清除筛选</Button>} />
            ) : (
              <EmptyState title="还没有接入凭据" description="新建凭据后，绑定可调用的租户并选择权限组。" action={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建凭据</Button>} />
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
          <div className="op-drawer-footer">
            <Button onClick={() => query.clear(["relationStatus"])}>清除这些条件</Button>
            <Button type="primary" onClick={() => setMoreOpen(false)}>完成</Button>
          </div>
        }
      >
        <div className="op-more-filters">
          <div>
            <FieldLabel label="租户关联状态" help="不选时包含全部关系（含未绑定租户的新凭据）。选择租户后默认只看有效关联。" />
            <Checkbox.Group
              aria-label="租户关联状态"
              value={filters.relationStatus}
              onChange={(values) => query.setFilter("relationStatus", values as string[])}
              options={Object.entries(relationNames).map(([value, label]) => ({ value, label }))}
            />
          </div>
        </div>
      </Drawer>
      {creating && (
        <CreateCredentialDrawer
          api={api}
          onClose={() => setCreating(false)}
          onCreated={(application, appSecret) => {
            setCreating(false);
            setCreated({ id: application.id, credential: { appKey: application.appKey, appSecret } });
            setRevision((value) => value + 1);
            select(application.id);
          }}
        />
      )}
      {selectedId && (
        <ApplicationDetail
          key={selectedId}
          api={api}
          applicationId={selectedId}
          initialTab={tab ?? navigation.route.applicationTab}
          initialTenantGrantId={navigation.route.tenantGrantId}
          locateTokenId={items.find((item) => item.id === selectedId)?.matchedTokenId ?? null}
          canReadCalls={canReadCalls}
          issuedCredential={created?.id === selectedId ? created.credential : null}
          onCredentialClose={() => setCreated(null)}
          onBack={close}
        />
      )}
    </section>
  );
}
