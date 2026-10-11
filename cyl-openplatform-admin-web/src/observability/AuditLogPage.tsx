import { ReloadOutlined } from "@ant-design/icons";
import { Button, Input, Tooltip } from "antd";
import { useRef, useEffect, useState } from "react";
import type { AdminApi } from "../access/api";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { useListQuery } from "../navigation/useListQuery";
import { EmptyState, FieldLabel, IdText, PageHeader, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, FilterBar, QuickSelect, TimeRangeFilter, timeRangeText, type DataTableColumn, type FilterChip } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import ObservationDetail, { auditOutcome } from "./ObservationDetail";
import { CompactRows, MoreFiltersDrawer, RequestIdSearch, rowTime, useQueryWindow } from "./observationList";
import { auditActions, auditApplyKeys, auditDefaults, listNamespaces, queryParameters, sourceNames, timeRangeOf, type ManagementAudit } from "./model";

const applyLabels: Record<(typeof auditApplyKeys)[number], string> = {
  operatorEmployeeNo: "操作人工号",
  operatorTenantId: "操作人租户",
  targetId: "操作对象",
  apiId: "API",
  applicationId: "凭据",
  tenantId: "业务租户",
  id: "记录 ID",
};
const applyFields: { key: (typeof auditApplyKeys)[number]; label: string; maxLength: number }[] = [
  { key: "operatorEmployeeNo", label: "操作人工号", maxLength: 64 },
  { key: "operatorTenantId", label: "操作人租户 ID", maxLength: 64 },
  { key: "targetId", label: "操作对象 ID", maxLength: 64 },
  { key: "apiId", label: "API ID", maxLength: 64 },
  { key: "applicationId", label: "凭据 ID", maxLength: 64 },
  { key: "tenantId", label: "业务租户 ID", maxLength: 64 },
  { key: "id", label: "记录 ID", maxLength: 36 },
];
const recordKey = (record: ManagementAudit) => `${record.source}:${record.id}`;

/** 管理审计（设置）：与调用日志同一列表范式；操作人显示姓名，缺登记时回退工号。 */
export default function AuditLogPage({ api, permissions, onOpenCredential }: { api: AdminApi; permissions: string[]; onOpenCredential?: (id: string) => void }) {
  const navigation = useAdminNavigation();
  const route = navigation.route;
  const query = useListQuery({ namespace: listNamespaces.audits, defaults: auditDefaults, applyKeys: [...auditApplyKeys] });
  const filters = query.filters;
  const [revision, setRevision] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const range = timeRangeOf(filters);
  const timeWindow = useQueryWindow(range, revision);
  const parameters = queryParameters(filters, "audits", timeWindow, query.page, query.pageSize);
  const list = useReadPage<ManagementAudit>(api, `/observability/audits?${parameters}`, revision, !timeWindow.error, { keepPrevious: true });
  const rows = list.error ? [] : (list.data?.items ?? []);
  const select = (entry: ManagementAudit) =>
    navigation.navigate({ ...navigation.route, observationId: entry.id, observationSource: entry.source, observationAt: entry.occurredAt });
  const locating = useRef(route.observationId ? "" : filters.requestId);
  useEffect(() => {
    if (!locating.current || list.loading || !list.data || filters.requestId !== locating.current) return;
    const match = list.data.items.find((item) => item.requestId === locating.current);
    locating.current = "";
    if (match) select(match);
  }, [list.data, list.loading, filters.requestId]);

  const chips: FilterChip[] = [];
  const chip = (key: string, text: string, onRemove: () => void) => chips.push({ key, text, label: text, onRemove });
  if (filters.requestId) chip("requestId", `请求号：${filters.requestId}`, () => query.setFilter("requestId", ""));
  if (range.preset !== "24h") chip("range", `时间：${timeRangeText(range)}`, () => query.setFilters({ range: "24h", from: "", to: "" }));
  for (const value of filters.source) chip(`source:${value}`, `来源：${sourceNames[value] ?? value}`, () => query.setFilter("source", filters.source.filter((item) => item !== value)));
  for (const value of filters.outcome) chip(`outcome:${value}`, `结果：${value === "SUCCESS" ? "成功" : "失败"}`, () => query.setFilter("outcome", filters.outcome.filter((item) => item !== value)));
  for (const key of auditApplyKeys) if (filters[key]) chip(key, `${applyLabels[key]}：${filters[key]}`, () => query.setFilter(key, ""));

  const columns: DataTableColumn<ManagementAudit>[] = [
    {
      key: "time",
      title: "时间",
      width: 150,
      hideable: false,
      render: (record) => (
        <button type="button" className="observation-time-link" onClick={() => select(record)} aria-label={`查看 ${record.requestId} 审计详情`}>
          {rowTime(record.occurredAt)}
        </button>
      ),
    },
    {
      key: "operator",
      title: "操作人",
      width: "18%",
      render: (record) => (
        <Tooltip title={[record.operatorEmployeeNo && `工号 ${record.operatorEmployeeNo}`, record.operatorTenantId && `租户 ID ${record.operatorTenantId}`].filter(Boolean).join(" · ") || undefined}>
          <span className={`observation-cell-line${record.operatorName ? "" : " op-muted"}`}>
            {record.operatorName || (record.operatorEmployeeNo ? `工号 ${record.operatorEmployeeNo}` : "未记录")}
          </span>
        </Tooltip>
      ),
    },
    {
      key: "action",
      title: "动作",
      hideable: false,
      render: (record) => (
        <span className="observation-cell-line">
          {auditActions[record.action] ?? record.action}
          <span className="op-muted"> · {sourceNames[record.source] ?? record.source}</span>
        </span>
      ),
    },
    {
      key: "target",
      title: "对象",
      width: "22%",
      render: (record) => {
        const target = record.targetId ?? record.apiId ?? record.applicationId;
        return target ? <IdText value={target} label="操作对象 ID" maxChars={24} /> : <span className="op-muted">—</span>;
      },
    },
    {
      key: "result",
      title: "结果",
      width: 96,
      render: (record) => {
        const outcome = auditOutcome(record.outcome);
        return <StatusBadge tone={outcome.tone}>{outcome.label}</StatusBadge>;
      },
    },
    { key: "requestId", title: "请求号", width: 200, defaultHidden: true, render: (record) => <IdText value={record.requestId} label="请求号" maxChars={20} /> },
  ];

  const filtered = chips.length > 0;
  const total = list.data?.total ?? 0;
  return (
    <section className="op-list-page observation-page" aria-labelledby="audit-log-title">
      <PageHeader
        title={<span id="audit-log-title">管理审计</span>}
        count={list.data?.total}
        secondaryActions={
          <Tooltip title="刷新（快捷时间按当前时刻重新计算）">
            <Button icon={<ReloadOutlined />} aria-label="刷新管理审计" disabled={list.loading || Boolean(timeWindow.error)} onClick={() => setRevision((value) => value + 1)} />
          </Tooltip>
        }
      />
      <div className="op-list-surface">
        <FilterBar
          search={
            <RequestIdSearch
              value={filters.requestId}
              onSubmit={(requestId) => {
                locating.current = requestId;
                if (requestId === filters.requestId) setRevision((value) => value + 1);
                else query.setFilter("requestId", requestId);
              }}
            />
          }
          quick={
            <>
              <TimeRangeFilter
                value={range}
                onChange={(next) => query.setFilters(next.preset === "custom" ? { range: "custom", from: next.from ?? "", to: next.to ?? "" } : { range: next.preset, from: "", to: "" })}
              />
              <QuickSelect
                label="来源"
                mode="multiple"
                value={filters.source}
                options={Object.entries(sourceNames).map(([value, label]) => ({ value, label }))}
                onChange={(values: string[]) => query.setFilter("source", values)}
                style={{ width: 190 }}
              />
              <QuickSelect
                label="结果"
                value={filters.outcome.length === 1 ? filters.outcome[0] : undefined}
                allowClear
                options={[
                  { value: "SUCCESS", label: "成功" },
                  { value: "FAILURE", label: "失败" },
                ]}
                onChange={(value) => query.setFilter("outcome", value ? [value as string] : [])}
                style={{ width: 130 }}
              />
            </>
          }
          moreCount={query.activeCount([...auditApplyKeys])}
          onMore={() => setMoreOpen(true)}
          chips={chips}
          onClearAll={() => query.clear()}
        />
        <CompactRows>
          <DataTable<ManagementAudit>
            caption="管理审计"
            rowKey={recordKey}
            columns={columns}
            data={timeWindow.error ? [] : rows}
            loading={list.loading}
            settingsKey="management-audits"
            onRowClick={select}
            rowClassName={(record) =>
              [record.outcome === "FAILURE" ? "observation-row--failure" : "", record.id === route.observationId && record.source === route.observationSource ? "observation-row--selected" : ""]
                .filter(Boolean)
                .join(" ")
            }
            summary={list.data && !timeWindow.error ? `${timeRangeText(range)} · ${filtered ? "筛选出" : "共"} ${total} 条操作` : undefined}
            pagination={
              list.data && !timeWindow.error
                ? { page: query.page, pageSize: query.pageSize, total: Math.min(total, 100000), onChange: (page, size) => (size !== query.pageSize ? query.setPageSize(size) : query.setPage(page)) }
                : undefined
            }
            empty={
              timeWindow.error ? (
                <EmptyState kind="error" title="时间范围无效" description={`${timeWindow.error}当前链接的时间条件不可查询。`} action={<Button onClick={() => query.setFilters({ range: "24h", from: "", to: "" })}>恢复近 24 小时</Button>} />
              ) : list.error ? (
                <EmptyState kind="error" title="管理审计加载失败" description={list.error} action={<Button onClick={list.reload}>重新加载</Button>} />
              ) : filtered ? (
                <EmptyState kind="noResult" title="没有符合条件的操作" description="试试扩大时间范围或减少筛选条件。" action={<Button onClick={() => query.clear()}>清除筛选</Button>} />
              ) : (
                <EmptyState title="近 24 小时没有管理操作" description="凭据、令牌、API 草稿与发布相关操作会记录在这里。" />
              )
            }
          />
        </CompactRows>
      </div>
      <MoreFiltersDrawer
        open={moreOpen}
        onClose={() => {
          query.discardDraft();
          setMoreOpen(false);
        }}
        onApply={() => {
          query.apply();
          setMoreOpen(false);
        }}
        onClear={() => {
          query.clear([...auditApplyKeys]);
          setMoreOpen(false);
        }}
      >
        <p className="op-muted observation-more-hint">所有编号与工号均为精确匹配，不同条件同时满足。</p>
        {applyFields.map((field) => (
          <div key={field.key}>
            <FieldLabel label={field.label} />
            <Input aria-label={field.label} maxLength={field.maxLength} value={query.draft[field.key]} onChange={(event) => query.setDraft(field.key, event.target.value.trim())} />
          </div>
        ))}
      </MoreFiltersDrawer>
      <ObservationDetail api={api} view="audits" entries={rows} permissions={permissions} onOpenCredential={onOpenCredential} onSelect={(entry) => select(entry as ManagementAudit)} />
    </section>
  );
}
