import { ReloadOutlined } from "@ant-design/icons";
import { Button, Drawer, Popover, Segmented, Select, Tooltip } from "antd";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, FieldLabel, Metric, PageHeader, PersonTag, TenantTag } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, FilterBar, QuickSelect, TimeRangeFilter, type DataTableColumn, type FilterChip, type TimeRangePreset } from "@cyl/open-platform-web-shared/ui/list";
import { useRead } from "@cyl/open-platform-web-shared/ui/useReadPage";
import type { AdminApi } from "../access/api";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { useListQuery } from "../navigation/useListQuery";
import OperationsTargetPicker from "./OperationsTargetPicker";
import OperationsTrend from "./OperationsTrend";
import type { OperationsStatistics, StatisticsRank } from "./types";
import {
  analyticsApplyKeys,
  analyticsDefaults,
  analyticsWindow,
  bucketRange,
  count,
  displayTime,
  failures,
  logsRoute,
  modeNames,
  statisticsQuery,
  type AnalyticsFilters,
  type LogConditions,
} from "./model";
import "./analytics.css";

const dimensionNames = { TENANT: "租户", PERSON: "人员", API: "API" } as const;
const bucketNames: Record<string, string> = { "": "自动", MINUTE: "1 分钟", FIVE_MINUTES: "5 分钟", HOUR: "1 小时" };
const identityNames: Record<string, string> = { EMPLOYEE: "人员调用", APPLICATION: "应用自主调用", UNKNOWN: "身份未知" };
const failed = (totals: { requests: number; successes: number }) => (BigInt(count(totals.requests)) - BigInt(count(totals.successes))).toString();

/** 114 调用分析：指标卡 + 趋势 + 维度排行，点击趋势分段或排行行下钻到调用日志。统计口径沿用 104。 */
export default function AnalyticsPage({ api }: { api: AdminApi }) {
  const navigation = useAdminNavigation();
  // 旧 104 链接的条件在 filter.operations.*：同名字段原位迁移到 analytics 命名空间（替换历史），空值与默认值不写入。
  useEffect(() => {
    const stored = navigation.route.managementFilters ?? {};
    const legacy = Object.keys(stored).filter((key) => key.startsWith("operations."));
    if (!legacy.length) return;
    const managementFilters = Object.fromEntries(Object.entries(stored).filter(([key]) => !key.startsWith("operations.")));
    for (const key of legacy) {
      const field = key.slice("operations.".length) as keyof AnalyticsFilters;
      const value = stored[key]?.filter(Boolean) ?? [];
      if (field in analyticsDefaults && value.length && value[0] !== analyticsDefaults[field]) managementFilters[`analytics.${field}`] = value.slice(0, 1);
    }
    if (managementFilters["analytics.from"] || managementFilters["analytics.to"]) managementFilters["analytics.range"] = ["custom"];
    navigation.navigate({ ...navigation.route, managementFilters }, true);
  }, []);
  const query = useListQuery<AnalyticsFilters>({ namespace: "analytics", defaults: analyticsDefaults, applyKeys: analyticsApplyKeys });
  const { filters, draft } = query;
  const [revision, setRevision] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  // 快捷范围在条件变化或手动刷新时按当前时刻重新计算。
  const scope = useMemo(() => analyticsWindow(filters), [JSON.stringify(filters), revision]);
  let path = "",
    rangeError = "";
  try {
    path = "/operations/statistics?" + statisticsQuery(scope);
  } catch (error) {
    rangeError = (error as Error).message;
  }
  const result = useRead<OperationsStatistics>(api, path, revision, Boolean(path), { keepPrevious: true });
  const data = result.data;
  const empty = data && count(data.summary.requests) === "0";

  const openLogs = (from: string, to: string, extra: Partial<LogConditions> = {}) =>
    navigation.navigate(
      logsRoute({
        from,
        to,
        mode: scope.mode,
        tenantId: scope.tenantId,
        employeeId: scope.employeeId,
        identityKind: scope.identityKind,
        apiId: scope.apiId,
        applicationId: scope.applicationId,
        ruleId: scope.ruleId,
        ruleVersion: scope.ruleVersion,
        ...extra,
      }),
    );
  const openRankLogs = (row: StatisticsRank) => {
    if (!data) return;
    const person = data.dimension === "PERSON" && row.identityKind === "EMPLOYEE";
    openLogs(data.from, data.to, {
      tenantId: data.dimension === "API" ? scope.tenantId : row.tenantId,
      employeeNo: person ? row.employeeNo : undefined,
      employeeId: person ? row.employeeId : data.dimension === "API" ? scope.employeeId : "",
      identityKind: data.dimension === "PERSON" ? row.identityKind : data.dimension === "API" ? scope.identityKind : "",
      apiId: data.dimension === "API" ? row.apiId : scope.apiId,
    });
  };
  /** 把排行对象设为分析条件（直接生效，与“更多筛选”中的对象条件相同）。 */
  const focusRank = (row: StatisticsRank) => {
    if (data?.dimension === "API") query.setFilters({ apiId: row.apiId });
    else if (data?.dimension === "TENANT") query.setFilters({ tenantId: row.tenantId, employeeId: "", identityKind: "" });
    else query.setFilters({ tenantId: row.tenantId, employeeId: row.employeeId, identityKind: row.identityKind });
  };

  const chips: FilterChip[] = [];
  const chip = (key: string, text: string, onRemove: () => void) => chips.push({ key, text, label: text, onRemove });
  if (filters.tenantId) chip("tenantId", `租户：${filters.tenantId}`, () => query.setFilters({ tenantId: "", employeeId: "", identityKind: "" }));
  if (filters.employeeId) chip("employeeId", `人员：${filters.employeeId}`, () => query.setFilters({ employeeId: "", identityKind: "" }));
  else if (filters.identityKind) chip("identityKind", `身份：${identityNames[filters.identityKind] ?? filters.identityKind}`, () => query.setFilter("identityKind", ""));
  if (filters.apiId) chip("apiId", `API：${filters.apiId}`, () => query.setFilter("apiId", ""));
  if (filters.applicationId) chip("applicationId", `接入凭据：${filters.applicationId}`, () => query.setFilter("applicationId", ""));
  if (filters.bucket) chip("bucket", `粒度：${bucketNames[filters.bucket]}`, () => query.setFilter("bucket", ""));
  if (filters.ruleId)
    chip("ruleId", `规则：${filters.ruleName || filters.ruleId}${filters.ruleVersion ? ` · 生效 v${filters.ruleVersion}` : ""}`, () => query.setFilters({ ruleId: "", ruleVersion: "", ruleName: "" }));
  // 名称在排行与选择器中显示；标签只用于确认与清除，保留 ID 便于分享核对。
  const objectKeys: (keyof AnalyticsFilters)[] = ["tenantId", "employeeId", "identityKind", "apiId", "applicationId", "bucket", "ruleId"];

  const rankColumns: DataTableColumn<StatisticsRank>[] = [
    {
      key: "object",
      title: dimensionNames[data?.dimension ?? "TENANT"],
      hideable: false,
      render: (row) =>
        data?.dimension === "API" ? (
          <span className="op-analytics__name">{row.name || row.apiId || "未归属 API"}</span>
        ) : data?.dimension === "TENANT" ? (
          row.tenantId ? <TenantTag name={row.tenantName} id={row.tenantId} /> : <span className="op-analytics__muted">未知租户</span>
        ) : row.identityKind === "EMPLOYEE" ? (
          <PersonTag name={row.name} employeeNo={row.employeeNo} tenantName={row.tenantName} id={row.employeeId} stacked />
        ) : (
          <span className="op-analytics__muted">{identityNames[row.identityKind]}</span>
        ),
    },
    { key: "requests", title: "请求数", align: "right", width: 110, render: (row) => count(row.totals.requests) },
    { key: "failures", title: "失败", align: "right", width: 90, render: (row) => <span className={failed(row.totals) !== "0" ? "op-analytics__bad" : undefined}>{failed(row.totals)}</span> },
    { key: "successRate", title: "成功率", align: "right", width: 100, render: (row) => (row.totals.successRate == null ? "无样本" : row.totals.successRate + "%") },
    { key: "latency", title: "平均 / 最大耗时", align: "right", width: 150, render: (row) => `${row.totals.averageLatencyMillis ?? "—"} / ${count(row.totals.maxDuration)} ms` },
    { key: "rejected", title: "实际拒绝", align: "right", width: 100, render: (row) => count(row.totals.governanceRejected) },
    { key: "observed", title: "观察命中", align: "right", width: 100, defaultHidden: true, render: (row) => count(row.totals.observedRequests) },
    {
      key: "actions",
      title: "操作",
      width: 170,
      hideable: false,
      render: (row) => {
        const unattributed = data?.dimension === "API" ? !row.apiId : data?.dimension === "TENANT" ? !row.tenantId : row.identityKind !== "EMPLOYEE";
        return (
          <span className="op-analytics__actions">
            <Button type="link" size="small" onClick={(event) => { event.stopPropagation(); openRankLogs(row); }}>
              查看日志
            </Button>
            <Tooltip title={unattributed ? "此行没有可筛选的对象（未归属或非人员调用）" : undefined}>
              <Button type="link" size="small" disabled={unattributed} onClick={(event) => { event.stopPropagation(); focusRank(row); }}>
                只看此{dimensionNames[data?.dimension ?? "TENANT"]}
              </Button>
            </Tooltip>
          </span>
        );
      },
    },
  ];

  return (
    <section className="op-analytics" aria-labelledby="analytics-title">
      <PageHeader
        title={<span id="analytics-title">调用分析</span>}
        meta={data ? `${displayTime(data.from)} → ${displayTime(data.to)} · ${modeNames[data.mode]}` : undefined}
        secondaryActions={
          <>
            <Popover trigger="click" content={<p className="op-analytics__note-pop">只统计已成功落库的调用记录，不是计费账单；无样本不代表正常。正式调用与草稿调试分别统计。聚合保留{data ? data.retentionDays : "—"}天，图形最多 60 段覆盖完整范围，精确值见分桶明细。</p>}>
              <Button>口径说明</Button>
            </Popover>
            <Tooltip title="按当前时刻重新计算快捷范围并刷新">
              <Button icon={<ReloadOutlined aria-hidden />} aria-label="刷新调用分析" disabled={result.loading} onClick={() => setRevision((value) => value + 1)} />
            </Tooltip>
          </>
        }
      />
      <div className="op-analytics__surface">
        <FilterBar
          search={
            <TimeRangeFilter
              value={{ preset: filters.range as TimeRangePreset, from: filters.from || undefined, to: filters.to || undefined }}
              onChange={(value) => query.setFilters({ range: value.preset, from: value.from ?? "", to: value.to ?? "" })}
            />
          }
          quick={
            <QuickSelect
              label="调用方式"
              value={filters.mode}
              onChange={(mode: string) => query.setFilter("mode", mode)}
              options={Object.entries(modeNames).map(([value, label]) => ({ value, label }))}
              style={{ width: 210 }}
            />
          }
          moreCount={query.activeCount(objectKeys)}
          onMore={() => setMoreOpen(true)}
          chips={chips}
          onClearAll={() => query.clear([...objectKeys, "ruleVersion", "ruleName"])}
        />
        {rangeError ? (
          <EmptyState kind="error" title="时间范围不可用" description={rangeError} action={<Button onClick={() => query.setFilters({ range: "1h", from: "", to: "" })}>改为近 1 小时</Button>} />
        ) : result.error ? (
          <EmptyState kind="error" title="统计读取失败" description={result.error} action={<Button onClick={result.reload}>重新读取</Button>} />
        ) : !data ? (
          <p className="op-analytics__loading" role="status">正在读取统计…</p>
        ) : (
          <section aria-label="统计结果" className="op-analytics__result">
            <div className="op-analytics__kpis">
              <button type="button" className="op-analytics__kpi" onClick={() => openLogs(data.from, data.to)} aria-label={`请求数 ${count(data.summary.requests)}，查看范围内调用日志`}>
                <Metric label={`请求数 · 失败 ${failures(data)}`} value={count(data.summary.requests)} />
              </button>
              <button
                type="button"
                className={`op-analytics__kpi${failures(data) !== "0" ? " is-bad" : ""}`}
                onClick={() => openLogs(data.from, data.to, { outcome: "FAILURE" })}
                aria-label={`成功率 ${data.summary.successRate ?? "无样本"}，查看失败调用日志`}
              >
                <Metric label="成功率 · 点击看失败" value={data.summary.successRate == null ? "无样本" : data.summary.successRate + "%"} />
              </button>
              <div className="op-analytics__kpi">
                <Metric
                  label={
                    <Tooltip title="104 统计接口只提供平均与最大耗时，暂无 P95/P99。">
                      <span>平均耗时 · 最大 {empty ? "无样本" : count(data.summary.maxDuration) + " ms"}</span>
                    </Tooltip>
                  }
                  value={data.summary.averageLatencyMillis == null ? "无样本" : data.summary.averageLatencyMillis + " ms"}
                />
              </div>
              <div className="op-analytics__kpi">
                <Metric label="实际拒绝" value={count(data.summary.governanceRejected)} />
                <span className="op-analytics__reasons">
                  {(
                    [
                      ["TOKEN_BUCKET_LIMIT", "令牌桶", data.summary.tokenBucketRejected],
                      ["DAILY_QUOTA", "配额", data.summary.dailyQuotaRejected],
                      ["IP_DENIED", "IP", data.summary.ipDenied],
                    ] as const
                  ).map(([reason, label, value]) => (
                    <button key={reason} type="button" aria-label={`${label}拒绝 ${count(value)}，查看调用日志`} onClick={() => openLogs(data.from, data.to, { denialReason: reason })}>
                      {label} {count(value)}
                    </button>
                  ))}
                </span>
              </div>
            </div>
            <section className="op-analytics__panel" aria-label="请求量趋势">
              <header>
                <h2>请求量趋势</h2>
                <span className="op-analytics__muted">按 {bucketNames[data.bucket] ?? data.bucket} 聚合 · 点击分段查看该时段调用日志</span>
              </header>
              {empty ? (
                <EmptyState title="此范围没有已记录调用" description="无样本不代表服务正常。" />
              ) : (
                <OperationsTrend data={data} onDrill={(from, to, onlyFailures) => openLogs(from, to, onlyFailures ? { outcome: "FAILURE" } : {})} />
              )}
              <p className="op-analytics__counts">
                {(
                  [
                    ["4xx", data.summary.clientErrors],
                    ["5xx", data.summary.serverErrors],
                    ["认证/授权拒绝", data.summary.authRejected],
                    ["限流", data.summary.rateLimited],
                    ["慢调用 ≥1000ms", data.summary.slowCalls],
                    ["观察命中（未拦截）", data.summary.observedRequests],
                    ["规则命中次数", data.summary.ruleHits],
                    ["未归属 API", data.summary.unattributed],
                  ] as const
                ).map(([label, value]) => (
                  <span key={label}>
                    {label} <strong>{count(value)}</strong>
                  </span>
                ))}
              </p>
              <p className="op-analytics__muted op-analytics__coverage">
                认证/授权拒绝与限流是 4xx 的子集；一次请求可能命中多条规则，命中次数不能与请求数相加。租户/人员维度
                {data.identityCoverageStart ? `自 ${displayTime(data.identityCoverageStart)} 开始记录` : "尚无已验证身份调用"}。
              </p>
            </section>
            <section className="op-analytics__panel" aria-label="维度排行">
              <header>
                <Segmented
                  aria-label="排行维度"
                  value={data.dimension}
                  options={(Object.keys(dimensionNames) as (keyof typeof dimensionNames)[]).map((value) => ({ value, label: dimensionNames[value] }))}
                  onChange={(dimension) => query.setFilter("dimension", String(dimension))}
                />
                <span className="op-analytics__actions">
                  <Select
                    aria-label="排行排序"
                    value={filters.sort}
                    onChange={(sort: string) => query.setFilter("sort", sort)}
                    options={[
                      { value: "REQUESTS", label: "按请求数" },
                      { value: "FAILURES", label: "按失败数" },
                      { value: "REJECTIONS", label: "按实际拒绝" },
                      { value: "RULE_HITS", label: "按规则命中" },
                    ]}
                    style={{ width: 130 }}
                  />
                  <Select aria-label="排行条数" value={filters.top} onChange={(top: string) => query.setFilter("top", top)} options={["10", "20", "50"].map((value) => ({ value, label: `前 ${value}` }))} style={{ width: 96 }} />
                </span>
              </header>
              <DataTable<StatisticsRank>
                caption={`${dimensionNames[data.dimension]}排行`}
                rowKey={(row) => JSON.stringify([row.tenantId, row.employeeId, row.identityKind, row.apiId])}
                columns={rankColumns}
                data={data.rankings}
                settingsKey="analytics-ranking"
                empty={<EmptyState title="此范围暂无排行数据" />}
              />
            </section>
            <BucketDetails data={data} page={query.page} pageSize={query.pageSize} onPage={(page, size) => (size !== query.pageSize ? query.setPageSize(size) : query.setPage(page))} onDrill={(from, to) => openLogs(from, to)} />
          </section>
        )}
      </div>
      <Drawer
        open={moreOpen}
        onClose={() => {
          query.discardDraft();
          setMoreOpen(false);
        }}
        title="更多筛选"
        size={420}
        destroyOnHidden
        footer={
          <div className="op-analytics__drawer-footer">
            <span className="op-analytics__muted" role="status">{query.changedDraft ? "条件已修改，应用后更新统计" : ""}</span>
            <Button onClick={() => { query.discardDraft(); setMoreOpen(false); }}>取消</Button>
            <Button
              type="primary"
              onClick={() => {
                query.apply();
                setMoreOpen(false);
              }}
            >
              应用
            </Button>
          </div>
        }
      >
        <div className="op-analytics__more">
          <div>
            <FieldLabel label="租户" />
            <OperationsTargetPicker api={api} kind="TENANT" value={draft.tenantId} onChange={(tenantId) => { query.setDraft("tenantId", tenantId); query.setDraft("employeeId", ""); }} />
          </div>
          <div>
            <FieldLabel label="调用人员" help="先选择租户，再选择该租户下的人员。" />
            <OperationsTargetPicker api={api} kind="EMPLOYEE" value={draft.employeeId} tenantId={draft.tenantId} onChange={(employeeId) => query.setDraft("employeeId", employeeId)} />
          </div>
          <div>
            <FieldLabel label="API" />
            <OperationsTargetPicker api={api} kind="API" value={draft.apiId} onChange={(apiId) => query.setDraft("apiId", apiId)} />
          </div>
          <div>
            <FieldLabel label="接入凭据" />
            <OperationsTargetPicker api={api} kind="APPLICATION" value={draft.applicationId} onChange={(applicationId) => query.setDraft("applicationId", applicationId)} />
          </div>
          <div>
            <FieldLabel label="聚合粒度" help="自动：24 小时以内按 5 分钟，更长按 1 小时；分桶总数不超过 1440。" />
            <Select aria-label="聚合粒度" value={draft.bucket} onChange={(bucket: string) => query.setDraft("bucket", bucket)} options={Object.entries(bucketNames).map(([value, label]) => ({ value, label }))} style={{ width: "100%" }} />
          </div>
        </div>
      </Drawer>
    </section>
  );
}

/** 分桶明细：图表的表格视图，精确值与逐桶下钻；页码写入地址。 */
function BucketDetails({ data, page, pageSize, onPage, onDrill }: { data: OperationsStatistics; page: number; pageSize: number; onPage: (page: number, pageSize: number) => void; onDrill: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(page > 1);
  const rows = data.points.slice((page - 1) * pageSize, page * pageSize);
  return (
    <details className="op-analytics__panel op-analytics__details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>分桶明细（{data.points.length} 桶）</summary>
      {open && (
        <DataTable<OperationsStatistics["points"][number]>
          caption="分桶明细"
          rowKey={(point) => point.bucketStart}
          data={rows}
          pagination={{ page, pageSize, total: data.points.length, onChange: onPage }}
          columns={[
            { key: "bucket", title: "桶开始（本地）", hideable: false, render: (point) => displayTime(point.bucketStart) },
            { key: "requests", title: "请求数", align: "right", render: (point) => count(point.totals.requests) },
            { key: "failures", title: "失败", align: "right", render: (point) => failed(point.totals) },
            { key: "successRate", title: "成功率", align: "right", render: (point) => (point.totals.successRate === null ? "无样本" : point.totals.successRate + "%") },
            { key: "latency", title: "平均 / 最大耗时", align: "right", render: (point) => (count(point.totals.requests) === "0" ? "无样本" : `${point.totals.averageLatencyMillis} / ${count(point.totals.maxDuration)} ms`) },
            {
              key: "actions",
              title: "操作",
              hideable: false,
              render: (point) => (
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    const range = bucketRange(data, point.bucketStart);
                    onDrill(range.from, range.to);
                  }}
                >
                  查看该桶日志
                </Button>
              ),
            },
          ]}
        />
      )}
    </details>
  );
}
