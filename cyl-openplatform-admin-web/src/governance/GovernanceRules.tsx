import { useEffect, useMemo, useState } from "react";
import { analyticsDefaults, type AnalyticsFilters } from "../operations/model";
import { PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Input, Tooltip } from "antd";
import type { AdminApi } from "../access/api";
import { DisabledReason, EmptyState, FieldHelp, FieldLabel, PageHeader, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, FilterBar, QuickSelect, useDebouncedCallback, type DataTableColumn, type FilterChip } from "@cyl/open-platform-web-shared/ui/list";
import { useRead, useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { useListQuery } from "../navigation/useListQuery";
import { observationRoute } from "../observability/links";
import { MoreFiltersDrawer } from "../observability/observationList";
import { recentFilters, count, displayTime } from "../operations/model";
import type { OperationsTotals } from "../operations/types";
import { RuleState, TargetFacts } from "./GovernanceFields";
import RuleDrawer from "./RuleDrawer";
import { configOnly, modeNames, permitted, quotaText, rateText, targetNames, type Draft, type TargetType } from "./model";

const same = (a: unknown, b: unknown) => stringifyJson(a) === stringifyJson(b);
/** 地址命名空间沿用 `filter.governanceRules.*`，旧分享链接无需迁移。 */
const defaults = { nameContains: "", type: "", mode: "", tenantId: "", appKey: "", apiId: "" };
const exactKeys = ["tenantId", "appKey", "apiId"] as const;
const exactLabels: Record<(typeof exactKeys)[number], string> = { tenantId: "租户 ID（精确）", appKey: "AK（精确）", apiId: "API ID（精确）" };
const shortModes: Record<string, string> = { OBSERVE: "观察", ENFORCE: "执行" };
type Overview = { ruleId: string; ruleVersion: number; totals: OperationsTotals };

const unpublishedChange = (d: Draft) => !d.liveRule || !same(d.config, configOnly(d.liveRule)) || (d.liveName != null && d.liveName !== d.name);

/** 规则名称搜索：停止输入 300ms 后生效，回车立即生效。 */
function NameSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  const debounced = useDebouncedCallback(onChange);
  useEffect(() => setText(value), [value]);
  return (
    <Input
      allowClear
      aria-label="搜索规则名称"
      prefix={<SearchOutlined aria-hidden />}
      placeholder="搜索规则名称"
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

/** 限流与访问控制（/traffic-rules）：规则列表直接显示当前生效与近 1 小时命中，规则在抽屉中编辑与发布。 */
export default function GovernanceRules({ api, permissions }: { api: AdminApi; permissions: string[] }) {
  const navigation = useAdminNavigation(),
    ruleId = navigation.route.governanceRuleId ?? null;
  const allowedTypes = (Object.keys(targetNames) as TargetType[]).filter((type) => permitted(type, permissions));
  const canAnalyze = permissions.includes("VIEW_AUDIT");
  const query = useListQuery({ namespace: "governanceRules", defaults, applyKeys: [...exactKeys] });
  const filters = query.filters;
  const [revision, setRevision] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const parameters = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  for (const [key, value] of Object.entries(filters)) if (value) parameters.set(key, value);
  const list = useReadPage<Draft>(api, `/governance-rules?${parameters}`, revision, true, { keepPrevious: true });
  const rows = list.error ? [] : (list.data?.items ?? []);

  // 近 1 小时命中：当前页已生效规则一次批量查询（每页最多 100 条），窗口在列表变化或手动刷新时重算。
  const [overviewRevision, setOverviewRevision] = useState(0);
  const window = useMemo(() => recentFilters(), [parameters.toString(), revision, list.data, overviewRevision]);
  const overviewQuery = new URLSearchParams({ from: window.from, to: window.to, mode: "PRODUCTION" });
  const runtimeIds = rows.flatMap((row) => (row.liveRule ? [row.liveRule.id] : []));
  runtimeIds.forEach((id) => overviewQuery.append("ruleId", id));
  const overview = useRead<Overview[]>(api, "/operations/rule-overview?" + overviewQuery, `${revision}:${overviewRevision}`, canAnalyze && runtimeIds.length > 0);
  const totalsOf = (d: Draft) => overview.data?.find((row) => row.ruleId === d.liveRule?.id && row.ruleVersion === d.liveRule?.version)?.totals;

  const open = (id: string | null) => navigation.navigate({ ...navigation.route, page: "governance", apiId: null, governanceRuleId: id });
  const openAnalytics = (d: Draft) => {
    if (!d.liveRule) return;
    // 调用分析页条件（114）：命名空间 analytics，只写与默认值不同的条件。
    const managementFilters: Record<string, string[]> = {};
    const scope: Partial<AnalyticsFilters> = { ruleId: d.liveRule.id, ruleVersion: String(d.liveRule.version), ruleName: d.liveName || d.name, dimension: "PERSON", sort: "RULE_HITS" };
    for (const [key, value] of Object.entries(scope)) if (value && value !== analyticsDefaults[key as keyof AnalyticsFilters]) managementFilters[`analytics.${key}`] = [value];
    navigation.navigate({ ...navigation.route, page: "operations", operationsView: "statistics", apiId: null, governanceRuleId: null, managementFilters });
  };
  const openLogs = (d: Draft) => {
    if (!d.liveRule) return;
    navigation.navigate(
      observationRoute(
        "calls",
        { range: "1h", ruleId: d.liveRule.id, ruleVersion: String(d.liveRule.version), governanceOutcome: d.liveRule.mode === "OBSERVE" ? "OBSERVED" : "REJECTED" },
        navigation.route,
      ),
    );
  };

  const hits = (d: Draft) => {
    if (!canAnalyze) return <span className="op-muted">无查看权限</span>;
    if (!d.liveRule) return <span className="op-muted">尚未生效</span>;
    if (overview.loading) return <span className="op-muted">查询中…</span>;
    if (overview.error)
      return (
        <Button type="link" size="small" onClick={() => setOverviewRevision((value) => value + 1)}>
          统计失败，重试
        </Button>
      );
    const totals = totalsOf(d);
    if (!totals) return <span className="op-muted">此版本暂无评估记录</span>;
    return (
      <div className="op-cell-main">
        <span>
          <span className="traffic-hit--rejected">拒绝 {count(totals.governanceRejected)}</span> · <span className="traffic-hit--observed">观察 {count(totals.observedRequests)}</span>
        </span>
        <span className="op-cell-sub">评估 {count(totals.requests)} 次请求</span>
      </div>
    );
  };
  const analyticsAction = (d: Draft) => {
    const reason = !d.liveRule ? "规则尚未发布，没有调用数据" : !canAnalyze ? "需要审计查询权限" : "";
    return (
      <DisabledReason reason={reason}>
        <Button type="link" size="small" disabled={Boolean(reason)} onClick={() => openAnalytics(d)}>
          查看调用分析
        </Button>
      </DisabledReason>
    );
  };

  const chips: FilterChip[] = [];
  const chip = (key: string, text: string, onRemove: () => void) => chips.push({ key, text, label: text, onRemove });
  if (filters.nameContains) chip("nameContains", `名称：${filters.nameContains}`, () => query.setFilter("nameContains", ""));
  if (filters.type) chip("type", `目标：${targetNames[filters.type as TargetType] ?? filters.type}`, () => query.setFilter("type", ""));
  if (filters.mode) chip("mode", `模式：${shortModes[filters.mode] ?? filters.mode}`, () => query.setFilter("mode", ""));
  for (const key of exactKeys) if (filters[key]) chip(key, `${exactLabels[key]}：${filters[key]}`, () => query.setFilter(key, ""));

  const columns: DataTableColumn<Draft>[] = [
    {
      key: "rule",
      title: "规则 / 目标",
      hideable: false,
      render: (d) => (
        <div className="op-cell-main">
          <button type="button" className="op-cell-main__title is-link" onClick={() => open(d.id)}>
            {d.name}
          </button>
          <TargetFacts draft={d} />
        </div>
      ),
    },
    {
      key: "live",
      title: "当前生效",
      width: 220,
      render: (d) => (
        <div className="op-cell-main">
          <RuleState value={d.liveRule} />
          {d.liveRule && (
            <span className="op-cell-sub">
              v{d.liveRule.version} · {rateText(d.liveRule)} · {quotaText(d.liveRule)}
            </span>
          )}
        </div>
      ),
    },
    { key: "hits", title: "近 1 小时命中", width: 180, render: hits },
    {
      key: "draft",
      title: "草稿状态",
      width: 150,
      render: (d) => (
        <div className="op-cell-main">
          {!d.liveRule ? (
            <StatusBadge tone="warning">待首次发布</StatusBadge>
          ) : unpublishedChange(d) ? (
            <StatusBadge tone="warning">有未发布变更</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">与生效一致</StatusBadge>
          )}
          <span className="op-cell-sub">草稿 r{d.draftRevision}</span>
        </div>
      ),
    },
    { key: "actions", title: "操作", width: 120, hideable: false, render: analyticsAction },
  ];

  const filtered = chips.length > 0;
  const noTypes = allowedTypes.length === 0;
  return (
    <section className="op-list-page traffic-page" aria-labelledby="traffic-title">
      <PageHeader
        title={<span id="traffic-title">限流与访问控制</span>}
        count={list.data?.total}
        meta={
          <span className="traffic-inline op-muted">
            正式请求同时检查全部匹配规则
            <FieldHelp label="规则">正式请求同时检查全部匹配规则；任一执行规则拒绝都不会扣正式额度。保存草稿不会生效，必须核对差异后发布。</FieldHelp>
          </span>
        }
        secondaryActions={
          <Tooltip title="刷新列表与近 1 小时命中">
            <Button
              icon={<ReloadOutlined />}
              aria-label="刷新规则列表"
              disabled={list.loading}
              onClick={() => {
                setRevision((value) => value + 1);
                setOverviewRevision((value) => value + 1);
              }}
            />
          </Tooltip>
        }
        primaryAction={
          <DisabledReason reason={noTypes ? "需要 API 管理或接入凭据管理权限" : undefined}>
            <Button type="primary" icon={<PlusOutlined />} disabled={noTypes} onClick={() => open("new")}>
              新增规则
            </Button>
          </DisabledReason>
        }
      />
      <div className="op-list-surface">
        <FilterBar
          search={<NameSearch value={filters.nameContains} onChange={(value) => query.setFilter("nameContains", value)} />}
          quick={
            <>
              <QuickSelect
                label="目标"
                value={filters.type || undefined}
                allowClear
                options={allowedTypes.map((value) => ({ value, label: targetNames[value] }))}
                onChange={(value) => query.setFilter("type", (value as string | undefined) ?? "")}
                style={{ width: 170 }}
              />
              <QuickSelect
                label="模式"
                value={filters.mode || undefined}
                allowClear
                options={Object.entries(modeNames).map(([value, label]) => ({ value, label }))}
                onChange={(value) => query.setFilter("mode", (value as string | undefined) ?? "")}
                style={{ width: 150 }}
              />
            </>
          }
          moreCount={query.activeCount([...exactKeys])}
          onMore={() => setMoreOpen(true)}
          chips={chips}
          onClearAll={() => query.clear()}
        />
        <DataTable<Draft>
          caption="限流规则"
          rowKey={(d) => d.id}
          columns={columns}
          data={rows}
          loading={list.loading}
          settingsKey="traffic-rules"
          onRowClick={(d) => open(d.id)}
          rowClassName={(d) => (d.id === ruleId ? "traffic-row--selected" : "")}
          summary={
            canAnalyze && runtimeIds.length > 0 ? (
              <span className="traffic-inline">
                命中统计：{displayTime(window.from)} → {displayTime(window.to)} · 正式调用
                <Button type="link" size="small" disabled={overview.loading} onClick={() => setOverviewRevision((value) => value + 1)}>
                  刷新命中
                </Button>
              </span>
            ) : undefined
          }
          pagination={list.data ? { page: query.page, pageSize: query.pageSize, total: list.data.total, onChange: (page, size) => (size !== query.pageSize ? query.setPageSize(size) : query.setPage(page)) } : undefined}
          empty={
            list.error ? (
              <EmptyState kind="error" title="规则加载失败" description={list.error} action={<Button onClick={list.reload}>重新加载</Button>} />
            ) : filtered ? (
              <EmptyState kind="noResult" title="没有符合条件的规则" action={<Button onClick={() => query.clear()}>清除筛选</Button>} />
            ) : (
              <EmptyState
                title="还没有限流与访问控制规则"
                description="为接入凭据、API 或租户设置速率、日配额与 IP 范围；先用观察模式验证影响再执行。"
                action={
                  !noTypes && (
                    <Button type="primary" onClick={() => open("new")}>
                      新增规则
                    </Button>
                  )
                }
              />
            )
          }
        />
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
          query.clear([...exactKeys]);
          setMoreOpen(false);
        }}
      >
        <div className="traffic-more-filters" role="group" aria-label="精确匹配">
          <FieldLabel label="精确匹配" help="编号均为精确匹配，可与名称、目标、模式组合使用。" />
          {exactKeys.map((key) => (
            <Input key={key} aria-label={exactLabels[key]} placeholder={exactLabels[key]} maxLength={64} value={query.draft[key]} onChange={(event) => query.setDraft(key, event.target.value.trim())} />
          ))}
        </div>
      </MoreFiltersDrawer>
      <RuleDrawer
        api={api}
        ruleId={ruleId}
        allowedTypes={allowedTypes}
        onChanged={() => setRevision((value) => value + 1)}
        overview={(d) =>
          d.liveRule ? (
            <span className="traffic-inline">
              {hits(d)}
              {canAnalyze && (
                <Button size="small" onClick={() => openLogs(d)}>
                  查看命中日志
                </Button>
              )}
              {analyticsAction(d)}
            </span>
          ) : undefined
        }
      />
    </section>
  );
}
