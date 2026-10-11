import { ReloadOutlined } from "@ant-design/icons";
import { Button, Checkbox, Input, Select, Tooltip } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminApi } from "../access/api";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { useListQuery } from "../navigation/useListQuery";
import { EmptyState, FieldLabel, IdText, PageHeader, StatusBadge, middleEllipsis } from "@cyl/open-platform-web-shared/ui/components";
import {
  DataTable,
  FilterBar,
  QuickSelect,
  TimeRangeFilter,
  timeRangeText,
  useDebouncedCallback,
  type DataTableColumn,
  type FilterChip,
} from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import ObservationDetail, { callCodes, callConclusion } from "./ObservationDetail";
import { CompactRows, MoreFiltersDrawer, RequestIdSearch, rowTime, useQueryWindow } from "./observationList";
import {
  callApplyKeys,
  callDefaults,
  listNamespaces,
  modeNames,
  queryParameters,
  reasonNames,
  timeRangeOf,
  type CallFilters,
  type CallRecord,
} from "./model";

const identityNames: Record<string, string> = { EMPLOYEE: "人员调用", APPLICATION: "应用自主调用", UNKNOWN: "身份未知" };
const governanceNames: Record<string, string> = { REJECTED: "实际拒绝", OBSERVED: "观察命中（未拦截）" };
const applyLabels: Record<(typeof callApplyKeys)[number], string> = {
  applicationId: "凭据",
  tenantId: "租户",
  employeeNo: "人员工号",
  employeeId: "人员 ID",
  mode: "调用方式",
  channel: "调用渠道",
  toolName: "MCP工具名",
  identityKind: "调用身份",
  governanceOutcome: "治理结果",
  denialReason: "拒绝原因",
  ruleId: "规则",
  ruleVersion: "规则版本",
  durationMin: "耗时下限",
  durationMax: "耗时上限",
  id: "记录 ID",
};
const valueText = (key: keyof CallFilters, value: string) =>
  key === "channel" ? (value === "MCP" ? "MCP" : "普通API") : key === "mode"
    ? (modeNames[value] ?? value)
    : key === "identityKind"
      ? (identityNames[value] ?? value)
      : key === "governanceOutcome"
        ? (governanceNames[value] ?? value)
        : key === "denialReason"
          ? (reasonNames[value] ?? value)
          : key === "durationMin" || key === "durationMax"
            ? `${value} ms`
            : value;
const durationValid = (value: string) => value === "" || (/^\d{1,8}$/.test(value) && Number(value) <= 86_400_000);

/** 调用方：租户名 · 人员名；缺档案时回退到编号，悬停看完整 ID。 */
function Caller({ record }: { record: CallRecord }) {
  const tenant = record.tenantName || (record.tenantId ? `租户 ${middleEllipsis(record.tenantId, 12)}` : "");
  const person = record.employeeName || (record.employeeNo ? `工号 ${record.employeeNo}` : record.applicationId ? "凭据自主调用" : "");
  const text = [tenant, person].filter(Boolean).join(" · ") || "身份未识别";
  const ids = [record.tenantId && `租户 ID ${record.tenantId}`, record.employeeNo && `工号 ${record.employeeNo}`, record.applicationId && `凭据 ${record.applicationId}`]
    .filter(Boolean)
    .join("\n");
  return (
    <Tooltip title={ids ? <span className="op-code observation-pre">{ids}</span> : undefined}>
      <span className={`observation-cell-line${text === "身份未识别" ? " op-muted" : ""}`}>{text}</span>
    </Tooltip>
  );
}

interface ApiOption {
  id: string;
  name: string;
  service: string;
  method: string;
}

/** API 快捷筛选：有 API 管理权限时远程搜索，否则从当前页记录中选择。 */
function ApiSelect({ api, value, rows, canSearch, onChange }: { api: AdminApi; value: string; rows: CallRecord[]; canSearch: boolean; onChange: (apiId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const debounced = useDebouncedCallback(setKeyword);
  const remote = useReadPage<ApiOption>(api, `/apis?page=1&pageSize=20&query=${encodeURIComponent(keyword)}`, 0, canSearch && open);
  const options = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of remote.data?.items ?? []) map.set(item.id, item.name || `${item.service}.${item.method}`);
    for (const row of rows) if (row.apiId && row.service && row.method && !map.has(row.apiId)) map.set(row.apiId, `${row.service}.${row.method}`);
    if (value && !map.has(value)) map.set(value, middleEllipsis(value, 20));
    return [...map].map(([id, label]) => ({ value: id, label }));
  }, [remote.data, rows, value]);
  return (
    <QuickSelect
      label="API"
      value={value || undefined}
      allowClear
      showSearch
      filterOption={canSearch ? false : (input, option) => String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
      onSearch={canSearch ? debounced.run : undefined}
      onOpenChange={setOpen}
      loading={remote.loading}
      notFoundContent={remote.loading ? "正在加载…" : canSearch ? "没有匹配的 API" : "当前页没有可选 API"}
      options={options}
      onChange={(next) => onChange((next as string | undefined) ?? "")}
      style={{ width: 220 }}
    />
  );
}

export default function CallLogPage({
  api,
  permissions,
  initialFilters,
  onOpenCredential,
}: {
  api: AdminApi;
  permissions: string[];
  initialFilters?: Partial<Pick<CallFilters, "applicationId" | "tenantId" | "employeeNo">>;
  onOpenCredential?: (id: string) => void;
}) {
  const navigation = useAdminNavigation();
  const route = navigation.route;
  const query = useListQuery({ namespace: listNamespaces.calls, defaults: callDefaults, applyKeys: [...callApplyKeys] });
  const filters = query.filters;
  const [revision, setRevision] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const range = timeRangeOf(filters);
  const timeWindow = useQueryWindow(range, revision);
  const parameters = queryParameters(filters, "calls", timeWindow, query.page, query.pageSize);
  const list = useReadPage<CallRecord>(api, `/observability/calls?${parameters}`, revision, !timeWindow.error, { keepPrevious: true });
  const rows = list.error ? [] : (list.data?.items ?? []);

  // 旧入口的凭据/租户/员工号路由参数只在首次进入时并入条件。
  useEffect(() => {
    const initial = Object.fromEntries(Object.entries(initialFilters ?? {}).filter(([key, value]) => value && !filters[key as keyof CallFilters]));
    if (Object.keys(initial).length) query.setFilters(initial);
  }, []);

  const select = (entry: CallRecord) =>
    navigation.navigate({ ...navigation.route, observationId: entry.id, observationSource: null, observationAt: entry.occurredAt });
  // 粘贴/回车请求号或带请求号的链接：结果返回后直接打开最近一条的详情。
  const locating = useRef(route.observationId ? "" : filters.requestId);
  useEffect(() => {
    if (!locating.current || list.loading || !list.data || filters.requestId !== locating.current) return;
    const match = list.data.items.find((item) => item.requestId === locating.current);
    locating.current = "";
    if (match) select(match);
  }, [list.data, list.loading, filters.requestId]);

  const draft = query.draft;
  const durationError =
    !durationValid(draft.durationMin) || !durationValid(draft.durationMax)
      ? "耗时须为 0 至 86400000 的整数毫秒"
      : draft.durationMin && draft.durationMax && Number(draft.durationMin) > Number(draft.durationMax)
        ? "耗时下限不能大于上限"
        : "";
  const ruleVersionError = draft.ruleVersion && !/^\d{1,15}$/.test(draft.ruleVersion) ? "规则版本须为非负整数" : "";

  const chips: FilterChip[] = [];
  const chip = (key: string, text: string, onRemove: () => void) => chips.push({ key, text, label: text, onRemove });
  if (filters.requestId) chip("requestId", `请求号：${filters.requestId}`, () => query.setFilter("requestId", ""));
  if (range.preset !== "24h") chip("range", `时间：${timeRangeText(range)}`, () => query.setFilters({ range: "24h", from: "", to: "" }));
  for (const value of filters.outcome) chip(`outcome:${value}`, `结果：${value === "SUCCESS" ? "成功" : "失败"}`, () => query.setFilter("outcome", filters.outcome.filter((item) => item !== value)));
  if (filters.apiId) {
    const row = rows.find((item) => item.apiId === filters.apiId && item.service);
    chip("apiId", `API：${row ? `${row.service}.${row.method}` : middleEllipsis(filters.apiId, 20)}`, () => query.setFilter("apiId", ""));
  }
  for (const key of callApplyKeys) {
    const value = filters[key];
    const values = Array.isArray(value) ? value : value ? [value] : [];
    if (!values.length) continue;
    chip(key, `${applyLabels[key]}：${values.map((item) => valueText(key, item)).join("、")}`, () =>
      query.setFilters({
        [key]: callDefaults[key],
        // 人员 ID 依附租户、规则版本依附规则，移除前者时一并移除。
        ...(key === "tenantId" ? { employeeId: "" } : {}),
        ...(key === "ruleId" ? { ruleVersion: "" } : {}),
      }),
    );
  }

  const columns: DataTableColumn<CallRecord>[] = [
    {
      key: "time",
      title: "时间",
      // 时间 + “调试”标记同行显示，不截断。
      width: 190,
      hideable: false,
      render: (record) => (
        <span className="observation-cell-line">
          <button type="button" className="observation-time-link" onClick={() => select(record)} aria-label={`查看 ${record.requestId} 详情`}>
            {rowTime(record.occurredAt)}
          </button>
          {record.mode === "DRAFT_DEBUG" && <span className="observation-mode-tag">调试</span>}
          {record.channel === "MCP" && <Tooltip title={record.toolName}><span className="observation-mode-tag">MCP</span></Tooltip>}
        </span>
      ),
    },
    {
      key: "api",
      title: "API",
      hideable: false,
      render: (record) =>
        record.service && record.method ? (
          <span className="observation-cell-line op-code" title={`${record.service}.${record.method}${record.version ? ` · 外部 ${record.version}` : ""}`}>
            {record.service}.{record.method}
          </span>
        ) : (
          <span className="observation-cell-line op-muted">API 未识别</span>
        ),
    },
    { key: "caller", title: "调用方", width: "24%", render: (record) => <Caller record={record} /> },
    {
      key: "result",
      title: "结果",
      width: 230,
      render: (record) => {
        const conclusion = callConclusion(record);
        return (
          <StatusBadge tone={conclusion.tone} detail={<span className="op-code">{callCodes(record)}</span>}>
            {conclusion.label}
          </StatusBadge>
        );
      },
    },
    {
      key: "duration",
      title: "耗时",
      width: 96,
      align: "right",
      render: (record) => <span className={`op-code observation-duration${record.durationMillis >= 3000 ? " is-slow" : ""}`}>{record.durationMillis} ms</span>,
    },
    { key: "requestId", title: "请求号", width: 200, defaultHidden: true, render: (record) => <IdText value={record.requestId} label="请求号" maxChars={20} /> },
    {
      key: "credential",
      title: "凭据",
      width: 180,
      defaultHidden: true,
      render: (record) => (record.applicationId ? <IdText value={record.applicationId} label="凭据 ID" maxChars={18} /> : <span className="op-muted">—</span>),
    },
  ];

  const filtered = chips.length > 0;
  const total = list.data?.total ?? 0;
  return (
    <section className="op-list-page observation-page" aria-labelledby="call-log-title">
      <PageHeader
        title={<span id="call-log-title">调用日志</span>}
        count={list.data?.total}
        secondaryActions={
          <Tooltip title="刷新（快捷时间按当前时刻重新计算）">
            <Button icon={<ReloadOutlined />} aria-label="刷新调用日志" disabled={list.loading || Boolean(timeWindow.error)} onClick={() => setRevision((value) => value + 1)} />
          </Tooltip>
        }
      />
      <div className="op-list-surface">
        <FilterBar
          search={<RequestIdSearch value={filters.requestId} onSubmit={(requestId) => {
            locating.current = requestId;
            if (requestId === filters.requestId) setRevision((value) => value + 1);
            else query.setFilter("requestId", requestId);
          }} />}
          quick={
            <>
              <TimeRangeFilter
                value={range}
                onChange={(next) => query.setFilters(next.preset === "custom" ? { range: "custom", from: next.from ?? "", to: next.to ?? "" } : { range: next.preset, from: "", to: "" })}
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
              <ApiSelect api={api} value={filters.apiId} rows={rows} canSearch={permissions.includes("MANAGE_APIS")} onChange={(apiId) => query.setFilter("apiId", apiId)} />
            </>
          }
          moreCount={query.activeCount([...callApplyKeys])}
          onMore={() => setMoreOpen(true)}
          chips={chips}
          onClearAll={() => query.clear()}
        />
        <CompactRows>
          <DataTable<CallRecord>
            caption="调用日志"
            rowKey={(record) => `${record.mode}:${record.id}`}
            columns={columns}
            data={timeWindow.error ? [] : rows}
            loading={list.loading}
            settingsKey="call-logs"
            onRowClick={select}
            rowClassName={(record) =>
              [record.outcome === "FAILURE" ? "observation-row--failure" : "", record.id === route.observationId ? "observation-row--selected" : ""].filter(Boolean).join(" ")
            }
            summary={list.data && !timeWindow.error ? `${timeRangeText(range)} · ${filtered ? "筛选出" : "共"} ${total} 条调用` : undefined}
            pagination={
              list.data && !timeWindow.error
                ? { page: query.page, pageSize: query.pageSize, total: Math.min(total, 100000), onChange: (page, size) => (size !== query.pageSize ? query.setPageSize(size) : query.setPage(page)) }
                : undefined
            }
            empty={
              timeWindow.error ? (
                <EmptyState kind="error" title="时间范围无效" description={`${timeWindow.error}当前链接的时间条件不可查询。`} action={<Button onClick={() => query.setFilters({ range: "24h", from: "", to: "" })}>恢复近 24 小时</Button>} />
              ) : list.error ? (
                <EmptyState kind="error" title="调用日志加载失败" description={list.error} action={<Button onClick={list.reload}>重新加载</Button>} />
              ) : filters.requestId && range.preset !== "7d" ? (
                <EmptyState kind="noResult" title="这个时间范围内没有该请求号" description="请求号精确匹配；较早的调用可扩大时间范围查找（最多 31 天）。" action={<Button onClick={() => query.setFilters({ range: "7d", from: "", to: "" })}>在近 7 天中查找</Button>} />
              ) : filtered ? (
                <EmptyState kind="noResult" title="没有符合条件的调用" description="试试扩大时间范围或减少筛选条件；刚完成的请求可刷新后查询。" action={<Button onClick={() => query.clear()}>清除筛选</Button>} />
              ) : (
                <EmptyState title="近 24 小时没有调用记录" description="调用发生后会在这里出现，可切换时间范围查看更早的记录。" />
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
        applyDisabled={Boolean(durationError || ruleVersionError)}
        onApply={() => {
          query.apply();
          setMoreOpen(false);
        }}
        onClear={() => {
          query.clear([...callApplyKeys]);
          setMoreOpen(false);
        }}
      >
        <div className="op-more-filters__group" role="group" aria-label="调用方">
          <FieldLabel label="调用方" help="编号与工号均为精确匹配；人员 ID 需与租户一起使用。" />
          <Input aria-label="凭据 ID" placeholder="凭据 ID" maxLength={64} value={draft.applicationId} onChange={(event) => query.setDraft("applicationId", event.target.value.trim())} />
          <Input aria-label="业务租户 ID" placeholder="业务租户 ID" maxLength={64} value={draft.tenantId} onChange={(event) => query.setDraft("tenantId", event.target.value.trim())} />
          <Input aria-label="人员工号" placeholder="人员工号" maxLength={64} value={draft.employeeNo} onChange={(event) => query.setDraft("employeeNo", event.target.value.trim())} />
          <Input aria-label="人员 ID" placeholder={draft.tenantId ? "人员 ID" : "人员 ID（先填写租户）"} disabled={!draft.tenantId} maxLength={64} value={draft.employeeId} onChange={(event) => query.setDraft("employeeId", event.target.value.trim())} />
          <Select aria-label="调用身份" value={draft.identityKind} options={[{ value: "", label: "全部身份" }, ...Object.entries(identityNames).map(([value, label]) => ({ value, label }))]} onChange={(value) => query.setDraft("identityKind", value)} />
        </div>
        <div className="op-more-filters__group" role="group" aria-label="耗时区间">
          <FieldLabel label="耗时区间（毫秒）" help="包含边界；只填一端表示不限另一端。" />
          <div className="observation-range-inputs">
            <Input aria-label="耗时下限" inputMode="numeric" placeholder="不限" value={draft.durationMin} status={durationError ? "error" : undefined} onChange={(event) => query.setDraft("durationMin", event.target.value.trim())} />
            <span className="op-muted">至</span>
            <Input aria-label="耗时上限" inputMode="numeric" placeholder="不限" value={draft.durationMax} status={durationError ? "error" : undefined} onChange={(event) => query.setDraft("durationMax", event.target.value.trim())} />
          </div>
          {durationError && <span className="op-cell-sub op-cell-sub--error" role="status">{durationError}</span>}
        </div>
        <div>
          <FieldLabel label="调用渠道" />
          <Select aria-label="调用渠道" value={draft.channel} options={[{value: "", label: "全部渠道"}, {value: "API", label: "普通API"}, {value: "MCP", label: "MCP"}]} onChange={value => query.setDraft("channel", value)} />
          <Input aria-label="MCP工具名" placeholder="完整MCP工具名" maxLength={64} value={draft.toolName} onChange={event => query.setDraft("toolName", event.target.value.trim())} />
          <FieldLabel label="调用方式" />
          <Checkbox.Group aria-label="调用方式" value={draft.mode} onChange={(values) => query.setDraft("mode", values as string[])} options={Object.entries(modeNames).map(([value, label]) => ({ value, label }))} />
        </div>
        <div className="op-more-filters__group" role="group" aria-label="限流与访问控制">
          <FieldLabel label="限流与访问控制" help="规则版本需与规则 ID 一起使用。" />
          <Select aria-label="治理结果" value={draft.governanceOutcome} options={[{ value: "", label: "全部治理结果" }, ...Object.entries(governanceNames).map(([value, label]) => ({ value, label }))]} onChange={(value) => query.setDraft("governanceOutcome", value)} />
          <Select
            aria-label="拒绝原因"
            value={draft.denialReason}
            options={[{ value: "", label: "全部拒绝原因" }, ...Object.entries(reasonNames).filter(([value]) => value !== "NONE").map(([value, label]) => ({ value, label }))]}
            onChange={(value) => query.setDraft("denialReason", value)}
          />
          <Input aria-label="规则 ID" placeholder="规则 ID" maxLength={240} value={draft.ruleId} onChange={(event) => query.setDraft("ruleId", event.target.value.trim())} />
          <Input aria-label="规则版本" placeholder="规则版本" inputMode="numeric" disabled={!draft.ruleId} maxLength={15} value={draft.ruleVersion} status={ruleVersionError ? "error" : undefined} onChange={(event) => query.setDraft("ruleVersion", event.target.value.trim())} />
          {ruleVersionError && <span className="op-cell-sub op-cell-sub--error" role="status">{ruleVersionError}</span>}
        </div>
        <div>
          <FieldLabel label="记录 ID" />
          <Input aria-label="记录 ID" maxLength={36} value={draft.id} onChange={(event) => query.setDraft("id", event.target.value.trim())} />
        </div>
      </MoreFiltersDrawer>
      <ObservationDetail api={api} view="calls" entries={rows} permissions={permissions} onOpenCredential={onOpenCredential} onSelect={(entry) => select(entry as CallRecord)} />
    </section>
  );
}
