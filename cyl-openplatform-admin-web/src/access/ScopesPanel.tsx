import { PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { EmptyState, FieldLabel, PageHeader, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, FilterBar, QuickSelect, useDebouncedCallback, type DataTableColumn, type FilterChip } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Button, Checkbox, Drawer, Input, Tooltip } from "antd";
import { useEffect, useState } from "react";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { useListQuery } from "../navigation/useListQuery";
import type { AdminApi, Scope } from "./api";
import DefaultGrantSummary from "./DefaultGrantSummary";
import ScopeDrawer from "./ScopeDrawer";
import { defaultGrantText, enabledText, publicAccessText, scopeHelp } from "./scopeModel";
import "./scopes.css";

const defaults = { search: "", enabled: [] as string[], defaultForNewApplication: [] as string[] };
const yesNo: Record<string, string> = { true: "是", false: "否" };

function ScopeSearch({ value, onSearch }: { value: string; onSearch: (text: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const debounced = useDebouncedCallback((next: string) => onSearch(next.trim()));
  return (
    <Input
      allowClear
      aria-label="搜索权限组"
      prefix={<SearchOutlined aria-hidden />}
      placeholder="搜索名称或代码"
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
  );
}

/** 113 权限组：统一列表范式 + 抽屉（设置、API、已开通租户）；抽屉地址 `/scopes?scope=<id>`。 */
export default function ScopesPanel({ api, canEditApis = false }: { api: AdminApi; canEditApis?: boolean }) {
  const navigation = useAdminNavigation();
  const selectedId = navigation.route.scopeId ?? null;
  const query = useListQuery({ namespace: "scopes", defaults, legacyKeys: { code: "search", name: "search" } });
  const { filters } = query;
  const [moreOpen, setMoreOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const parameters = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (filters.search) parameters.set("query", filters.search);
  filters.enabled.forEach((value) => parameters.append("enabled", value));
  filters.defaultForNewApplication.forEach((value) => parameters.append("defaultForNewApplication", value));
  const list = useReadPage<Scope>(api, `/scopes?${parameters}`, revision, true, { keepPrevious: true });
  const items = list.data?.items ?? [];

  const open = (scopeId: string, scopeTab: "settings" | "tenants" = "settings") => navigation.navigate({ ...navigation.route, scopeId, scopeTab });
  const close = () => navigation.navigate({ ...navigation.route, scopeId: null, scopeTab: undefined });

  const chips: FilterChip[] = [];
  if (filters.search) chips.push({ key: "search", text: `搜索：${filters.search}`, label: `搜索：${filters.search}`, onRemove: () => query.setFilter("search", "") });
  for (const value of filters.enabled)
    chips.push({ key: `enabled:${value}`, text: `状态：${enabledText(value === "true")}`, label: `状态：${enabledText(value === "true")}`, onRemove: () => query.setFilter("enabled", filters.enabled.filter((item) => item !== value)) });
  for (const value of filters.defaultForNewApplication)
    chips.push({
      key: `default:${value}`,
      text: `新凭据默认授予：${yesNo[value]}`,
      label: `新凭据默认授予：${yesNo[value]}`,
      onRemove: () => query.setFilter("defaultForNewApplication", filters.defaultForNewApplication.filter((item) => item !== value)),
    });
  const filtered = chips.length > 0;

  const columns: DataTableColumn<Scope>[] = [
    {
      key: "name",
      title: "名称 / 代码",
      width: "28%",
      hideable: false,
      render: (item) => (
        <span className="op-cell-main">
          <button type="button" className="op-cell-main__title is-link" onClick={() => open(item.id)}>
            {item.name}
          </button>
          <span className="op-cell-sub scope-code">{item.code}</span>
        </span>
      ),
    },
    {
      key: "enabled",
      title: <FieldLabel label="启用" help={scopeHelp.enabled} />,
      label: "启用",
      width: "9%",
      render: (item) => <StatusBadge tone={item.enabled ? "success" : "neutral"}>{enabledText(item.enabled)}</StatusBadge>,
    },
    {
      key: "default",
      title: <FieldLabel label="新凭据默认授予" help={scopeHelp.defaultGrant} />,
      label: "新凭据默认授予",
      width: "16%",
      render: (item) => <span className={item.defaultForNewApplication && !item.enabled ? "op-cell-sub--warning" : undefined}>{defaultGrantText(item)}</span>,
    },
    {
      key: "public",
      title: <FieldLabel label="公共通用" help={scopeHelp.publicAccess} />,
      label: "公共通用",
      width: "11%",
      render: (item) => <span className={item.publicAccess && !item.enabled ? "op-cell-sub--warning" : undefined}>{publicAccessText(item)}</span>,
    },
    {
      key: "tenants", title: <FieldLabel label="已开通租户" help="直接开通且未撤销的租户数量，点击管理。公共通用面向所有租户，不计入此数量；停用组保留开通记录。" />,
      label: "已开通租户", width: "10%", align: "right",
      render: item => <button type="button" className="scope-count-link" aria-label={`${item.name}，已开通租户 ${item.tenantCount ?? 0} 个，管理租户权限`} onClick={() => open(item.id, "tenants")}>{item.tenantCount ?? 0}</button>,
    },
    {
      key: "apis",
      title: <FieldLabel label="API 数" help={scopeHelp.apiCount} />,
      label: "API 数",
      width: "8%",
      align: "right",
      render: (item) => item.apiCount ?? 0,
    },
    {
      key: "credentials",
      title: <FieldLabel label="凭据数" help={scopeHelp.credentialCount} />,
      label: "凭据数",
      width: "9%",
      align: "right",
      render: (item) => item.credentialCount ?? 0,
    },
    {
      key: "actions",
      title: "操作",
      width: "9%",
      hideable: false,
      render: (item) => (
        <div className="op-row-actions">
          <Button type="link" size="small" onClick={() => open(item.id)}>
            查看<span className="sr-only"> {item.name}</span>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <section className="scope-list" aria-labelledby="scopes-title">
      <PageHeader
        title={<span id="scopes-title">权限组</span>}
        count={list.data?.total}
        secondaryActions={
          <Tooltip title="刷新">
            <Button icon={<ReloadOutlined />} aria-label="刷新权限组列表" onClick={list.reload} />
          </Tooltip>
        }
        primaryAction={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open("new")}>
            新建权限组
          </Button>
        }
      />
      <DefaultGrantSummary api={api} revision={revision} onOpen={open} onFilter={() => query.setFilter("defaultForNewApplication", ["true"])} />
      <div className="op-list-surface">
        <FilterBar
          search={<ScopeSearch value={filters.search} onSearch={(text) => text !== filters.search && query.setFilter("search", text)} />}
          quick={
            <QuickSelect
              label="状态"
              mode="multiple"
              value={filters.enabled}
              onChange={(values: string[]) => query.setFilter("enabled", values)}
              options={[
                { value: "true", label: "启用" },
                { value: "false", label: "停用" },
              ]}
              style={{ width: 160 }}
            />
          }
          moreCount={query.activeCount(["defaultForNewApplication"])}
          onMore={() => setMoreOpen(true)}
          chips={chips}
          onClearAll={() => query.clear()}
        />
        <DataTable<Scope>
          caption="权限组列表"
          rowKey={(item) => item.id}
          columns={columns}
          data={list.error ? [] : items}
          loading={list.loading}
          settingsKey="scopes"
          onRowClick={(item) => open(item.id)}
          rowClassName={(item) => (item.id === selectedId ? "scope-row--active" : "")}
          summary={list.data ? (filtered ? `筛选出 ${list.data.total} 个权限组` : `共 ${list.data.total} 个权限组`) : undefined}
          pagination={
            list.data
              ? { page: query.page, pageSize: query.pageSize, total: list.data.total, onChange: (page, size) => (size !== query.pageSize ? query.setPageSize(size) : query.setPage(page)) }
              : undefined
          }
          empty={
            list.error ? (
              <EmptyState kind="error" title="权限组列表加载失败" description={list.error} action={<Button onClick={list.reload}>重新加载</Button>} />
            ) : filtered ? (
              <EmptyState kind="noResult" title="没有符合条件的权限组" description="名称与代码按包含匹配。" action={<Button onClick={() => query.clear()}>清除筛选</Button>} />
            ) : (
              <EmptyState title="还没有权限组" description="权限组决定凭据可以调用哪些 API。" action={<Button type="primary" icon={<PlusOutlined />} onClick={() => open("new")}>新建权限组</Button>} />
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
          <div className="scope-drawer-footer">
            <Button onClick={() => query.clear(["defaultForNewApplication"])}>清除这些条件</Button>
            <Button type="primary" onClick={() => setMoreOpen(false)}>
              完成
            </Button>
          </div>
        }
      >
        <div className="scope-more-filters">
          <FieldLabel label="新凭据默认授予" help={scopeHelp.defaultGrant} />
          <Checkbox.Group
            aria-label="新凭据默认授予"
            value={filters.defaultForNewApplication}
            onChange={(values) => query.setFilter("defaultForNewApplication", values as string[])}
            options={[
              { value: "true", label: "是" },
              { value: "false", label: "否" },
            ]}
          />
        </div>
      </Drawer>
      {selectedId && (
        <ScopeDrawer
          key={selectedId}
          api={api}
          scopeId={selectedId}
          initial={items.find((item) => item.id === selectedId) ?? null}
          canEditApis={canEditApis}
          created={createdId === selectedId}
          onClose={close}
          onCreated={(scope) => {
            setCreatedId(scope.id);
            setRevision((value) => value + 1);
            navigation.navigate({ ...navigation.route, scopeId: scope.id }, true);
          }}
          onChanged={() => setRevision((value) => value + 1)}
        />
      )}
    </section>
  );
}
