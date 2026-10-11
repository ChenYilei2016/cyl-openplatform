import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { useEffect, useMemo, useState } from "react";
import { PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Input, Segmented, Tooltip } from "antd";
import type { AdminApi } from "../access/api";
import { DisabledReason, EmptyState, FieldHelp, FieldLabel, PageHeader, StatusBadge, type StatusTone } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, FilterBar, QuickSelect, useDebouncedCallback, type DataTableColumn, type FilterChip } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { createSdkClient, type SdkAsset, type SdkAssetKind } from "@cyl/open-platform-web-shared/sdk/api";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { useListQuery } from "../navigation/useListQuery";
import { MoreFiltersDrawer } from "../observability/observationList";
import SdkWorkspace from "./SdkWorkspace";
import "./sdk.css";

export function sdkStage(asset: SdkAsset) {
  return asset.status === "WITHDRAWN" ? "已撤下" : asset.status === "PUBLISHED" ? "已发布" : asset.sizeBytes ? "待发布" : "待上传";
}
export function sdkTone(asset: Pick<SdkAsset, "status">): StatusTone {
  return asset.status === "PUBLISHED" ? "success" : asset.status === "WITHDRAWN" ? "neutral" : "warning";
}
const statusNames: Record<string, string> = { DRAFT: "草稿（待上传 / 待发布）", PUBLISHED: "已发布", WITHDRAWN: "已撤下" };
const kindNames: Record<SdkAssetKind, string> = { PLATFORM: "平台客户端", LEGACY_API: "接口绑定资产" };
/** 地址命名空间沿用 `filter.sdk.*`，旧链接可还原。 */
const defaults = { kind: "PLATFORM", query: "", sdkVersion: "", language: "", status: "" };
const exactKeys = ["sdkVersion", "language"] as const;
const exactLabels: Record<(typeof exactKeys)[number], string> = { sdkVersion: "SDK 版本（精确）", language: "语言（精确）" };

function KeywordSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  const debounced = useDebouncedCallback(onChange);
  useEffect(() => setText(value), [value]);
  return (
    <Input
      allowClear
      aria-label="搜索 SDK 名称或版本"
      prefix={<SearchOutlined aria-hidden />}
      placeholder="搜索 SDK 名称或版本"
      maxLength={100}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        debounced.run(event.target.value.trim());
      }}
      onPressEnter={() => debounced.flush(text.trim())}
    />
  );
}

/** 设置 · Java SDK（/sdk）：平台客户端与接口绑定资产两类，列表 + 抽屉登记、上传、发布与撤下。 */
export default function SdkAssetsPanel({
  api,
  permissions,
  csrfToken,
  onUnauthorized,
}: {
  api: AdminApi;
  permissions: string[];
  csrfToken: string | null;
  onUnauthorized: () => void;
}) {
  const client = useMemo(() => createSdkClient({ adminApi: api, csrfToken, onUnauthorized }), [api, csrfToken, onUnauthorized]);
  const navigation = useAdminNavigation();
  const search = useListQuery({ namespace: "sdk", defaults, applyKeys: [...exactKeys] });
  const filters = search.filters;
  const kind = (filters.kind === "LEGACY_API" ? "LEGACY_API" : "PLATFORM") as SdkAssetKind;
  const [revision, setRevision] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const query = new URLSearchParams({ kind, page: String(search.page), pageSize: String(search.pageSize) });
  for (const key of ["query", "sdkVersion", "language", "status"] as const) if (filters[key]) query.set(key, filters[key]);
  const list = useReadPage<SdkAsset>(client.read, "?" + query, revision, true, { keepPrevious: true });
  const rows = list.error ? [] : (list.data?.items ?? []);
  const open = (id: string | null) => navigation.navigate({ ...navigation.route, sdkAssetId: id });
  const canManage = permissions.includes("MANAGE_APIS");
  const conditionKeys = ["query", "sdkVersion", "language", "status"] as const;

  const chips: FilterChip[] = [];
  const chip = (key: string, text: string, onRemove: () => void) => chips.push({ key, text, label: text, onRemove });
  if (filters.query) chip("query", `关键词：${filters.query}`, () => search.setFilter("query", ""));
  if (filters.status) chip("status", `状态：${statusNames[filters.status] ?? filters.status}`, () => search.setFilter("status", ""));
  for (const key of exactKeys) if (filters[key]) chip(key, `${exactLabels[key].replace("（精确）", "")}：${filters[key]}`, () => search.setFilter(key, ""));

  const columns: DataTableColumn<SdkAsset>[] = [
    {
      key: "name",
      title: "SDK / 版本",
      hideable: false,
      render: (asset) => (
        <div className="op-cell-main">
          <button type="button" className="op-cell-main__title is-link" onClick={() => open(asset.id)}>
            {asset.name}
          </button>
          <span className="op-cell-sub op-code">SDK {asset.sdkVersion}</span>
        </div>
      ),
    },
    {
      key: "runtime",
      title: "语言 / 运行要求",
      width: 170,
      render: (asset) => (
        <div className="op-cell-main">
          <span>{asset.language}</span>
          <span className="op-cell-sub">{asset.runtime}</span>
        </div>
      ),
    },
    {
      key: "status",
      title: "状态 / 下载范围",
      width: 200,
      render: (asset) => (
        <div className="op-cell-main">
          <StatusBadge tone={sdkTone(asset)}>{sdkStage(asset)}</StatusBadge>
          <span className="op-cell-sub">{asset.status === "PUBLISHED" ? (kind === "PLATFORM" ? "已公开，可匿名下载" : "仅原 API 授权范围可下载") : "客户不可下载"}</span>
        </div>
      ),
    },
    {
      key: "content",
      title: kind === "PLATFORM" ? "文件 / 修订" : "绑定 API / 修订",
      width: "26%",
      render: (asset) => (
        <div className="op-cell-main">
          <span className={kind === "PLATFORM" ? "" : "op-code"}>
            {kind === "PLATFORM" ? (asset.sizeBytes ? `${(asset.sizeBytes / 1024).toFixed(1)} KiB · ZIP` : "尚未上传 ZIP") : `${asset.service} / ${asset.version} / ${asset.method}`}
          </span>
          <span className="op-cell-sub">修订 {stringifyJson(asset.revision)}</span>
        </div>
      ),
    },
    {
      key: "actions",
      title: "操作",
      width: 120,
      hideable: false,
      render: (asset) => (
        <Button type="link" size="small" onClick={() => open(asset.id)}>
          {asset.status === "DRAFT" ? (asset.sizeBytes ? "核对并发布" : "上传并完善") : "查看详情"}
        </Button>
      ),
    },
  ];

  return (
    <section className="op-list-page sdk-page" aria-labelledby="sdk-title">
      <PageHeader
        title={<span id="sdk-title">Java SDK</span>}
        count={list.data?.total}
        meta={
          <span className="sdk-inline op-muted">
            客户调用 SDK 的登记与交付
            <FieldHelp label="交付范围">平台客户端供客户匿名下载；接口绑定资产保持原 API 和 Bearer 授权范围。这里不发布内部 Provider SDK。</FieldHelp>
          </span>
        }
        secondaryActions={
          <Tooltip title="刷新列表">
            <Button icon={<ReloadOutlined />} aria-label="刷新 SDK 列表" disabled={list.loading} onClick={list.reload} />
          </Tooltip>
        }
        primaryAction={
          <DisabledReason reason={canManage ? undefined : "需要“API 管理”权限"}>
            <Button type="primary" icon={<PlusOutlined />} disabled={!canManage} onClick={() => open("new")}>
              {kind === "PLATFORM" ? "登记平台 SDK" : "登记历史接口 SDK"}
            </Button>
          </DisabledReason>
        }
      />
      <Segmented
        className="sdk-kind"
        aria-label="SDK 类型"
        value={kind}
        options={(Object.keys(kindNames) as SdkAssetKind[]).map((value) => ({ value, label: kindNames[value] }))}
        onChange={(value) => search.setFilter("kind", String(value))}
      />
      <div className="op-list-surface">
        <FilterBar
          search={<KeywordSearch value={filters.query} onChange={(value) => search.setFilter("query", value)} />}
          quick={
            <QuickSelect
              label="状态"
              value={filters.status || undefined}
              allowClear
              options={Object.entries(statusNames).map(([value, label]) => ({ value, label }))}
              onChange={(value) => search.setFilter("status", (value as string | undefined) ?? "")}
              style={{ width: 200 }}
            />
          }
          moreCount={search.activeCount([...exactKeys])}
          onMore={() => setMoreOpen(true)}
          chips={chips}
          onClearAll={() => search.clear([...conditionKeys])}
        />
        <DataTable<SdkAsset>
          caption={kind === "PLATFORM" ? "平台 SDK" : "接口绑定资产"}
          rowKey={(asset) => asset.id}
          columns={columns}
          data={rows}
          loading={list.loading}
          settingsKey="sdk-assets"
          onRowClick={(asset) => open(asset.id)}
          rowClassName={(asset) => (asset.id === navigation.route.sdkAssetId ? "sdk-row--selected" : "")}
          pagination={list.data ? { page: search.page, pageSize: search.pageSize, total: list.data.total, onChange: (page, size) => (size !== search.pageSize ? search.setPageSize(size) : search.setPage(page)) } : undefined}
          empty={
            list.error ? (
              <EmptyState kind="error" title="SDK 列表加载失败" description={list.error} action={<Button onClick={list.reload}>重新加载</Button>} />
            ) : (
              <EmptyState
                kind={chips.length ? "noResult" : "empty"}
                title={kind === "PLATFORM" ? "当前查询没有平台 SDK 版本。" : "当前查询没有接口绑定资产。"}
                action={chips.length ? <Button onClick={() => search.clear([...conditionKeys])}>清除筛选</Button> : undefined}
              />
            )
          }
        />
      </div>
      <MoreFiltersDrawer
        open={moreOpen}
        onClose={() => {
          search.discardDraft();
          setMoreOpen(false);
        }}
        onApply={() => {
          search.apply();
          setMoreOpen(false);
        }}
        onClear={() => {
          search.clear([...exactKeys]);
          setMoreOpen(false);
        }}
      >
        <div className="sdk-more-filters" role="group" aria-label="精确匹配">
          <FieldLabel label="精确匹配" help="版本与语言均为精确匹配，例如 88.1、JAVA。" />
          {exactKeys.map((key) => (
            <Input key={key} aria-label={exactLabels[key]} placeholder={exactLabels[key]} maxLength={32} value={search.draft[key]} onChange={(event) => search.setDraft(key, event.target.value.trim())} />
          ))}
        </div>
      </MoreFiltersDrawer>
      {navigation.route.sdkAssetId && (
        <SdkWorkspace
          id={navigation.route.sdkAssetId}
          kind={kind}
          api={api}
          client={client}
          permissions={permissions}
          close={() => open(null)}
          changed={() => setRevision((n) => n + 1)}
        />
      )}
    </section>
  );
}
