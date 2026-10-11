import { useEffect, useRef, useState } from "react";
import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Checkbox, Input, InputNumber, Popover, Select, Tooltip } from "antd";
import type { AdminApi } from "../access/api";
import { AdminApiError } from "../access/api";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import { EmptyState, EntityDrawer, FieldLabel, PageHeader, StatusBadge, defineStatusMap } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { parseJson, sameJsonValue, stringifyJson } from "@cyl/open-platform-web-shared/json";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { useListQuery } from "../navigation/useListQuery";
import { displayTime, count, logsRoute } from "./model";
import type { AlertEvent, AlertMetric, AlertOverview, AlertPolicy, AlertState } from "./types";
import "./analytics.css";

const metricNames: Record<AlertMetric, string> = {
  FAILURE_RATE: "失败率",
  AVERAGE_LATENCY: "平均耗时",
};
const statuses = defineStatusMap({
  DISABLED: { tone: "neutral", label: "已关闭" },
  NO_DATA: { tone: "warning", label: "数据不足" },
  NORMAL: { tone: "success", label: "正常" },
  FIRING: { tone: "error", label: "告警中" },
});
/** 级别是前端展示约定：失败率影响调用结果，按“严重”；平均耗时按“警告”。后端暂无级别字段。 */
const levels = defineStatusMap({
  FAILURE_RATE: { tone: "error", label: "严重" },
  AVERAGE_LATENCY: { tone: "warning", label: "警告" },
});
interface PolicyInput {
  windowMinutes: number;
  minRequests: number;
  failureEnabled: boolean;
  failureRateThreshold: string;
  latencyEnabled: boolean;
  averageLatencyThresholdMillis: number;
}
const inputOf = (p: AlertPolicy): PolicyInput => ({
  ...settings(p),
  failureRateThreshold: stringifyJson(p.failureRateThreshold),
});
const settings = (p: AlertPolicy) => ({
  windowMinutes: p.windowMinutes,
  minRequests: p.minRequests,
  failureEnabled: p.failureEnabled,
  failureRateThreshold: p.failureRateThreshold,
  latencyEnabled: p.latencyEnabled,
  averageLatencyThresholdMillis: p.averageLatencyThresholdMillis,
});
const unknownFailure = (e: unknown) => !(e instanceof AdminApiError) || e.code >= 50000000 || (e.code >= 500 && e.code < 600);
function inputProblems(p: PolicyInput) {
  const errors: Partial<Record<keyof PolicyInput, string>> = {};
  if (!Number.isInteger(p.minRequests) || p.minRequests < 1 || p.minRequests > 1000000) errors.minRequests = "须为1–1000000的整数。";
  if (p.failureEnabled && !/^(?:0|[1-9]\d?)(?:\.\d{1,2})?$|^100(?:\.0{1,2})?$/.test(p.failureRateThreshold)) errors.failureRateThreshold = "须为0–100，最多两位小数。";
  if (p.latencyEnabled && (!Number.isInteger(p.averageLatencyThresholdMillis) || p.averageLatencyThresholdMillis < 1 || p.averageLatencyThresholdMillis > 300000))
    errors.averageLatencyThresholdMillis = "须为1–300000ms的整数。";
  return errors;
}
const metricValue = (record: { value: string | null; metric: AlertMetric }) => (record.value === null ? "无样本" : record.value + (record.metric === "FAILURE_RATE" ? "%" : " ms"));

/**
 * 最近一次进入“告警中”的时刻与其后的恢复时刻（事件按发生时间倒序，只看第一页，有界）。
 * 当前仍在告警时，最近触发取最新评估时间。
 */
function firingPeriod(state: AlertState, events: AlertEvent[]) {
  const own = events.filter((event) => event.metric === state.metric);
  const index = own.findIndex((event) => event.status === "FIRING" && event.previousStatus !== "FIRING");
  if (index < 0) return { first: null, last: state.status === "FIRING" ? state.evaluatedAt : null };
  return { first: own[index].occurredAt, last: state.status === "FIRING" ? state.evaluatedAt : (own[index - 1]?.occurredAt ?? own[index].occurredAt) };
}

/** 114 告警独立页：告警列表（级别、对象、首次/最近触发、状态）+ 一键查看日志；策略在抽屉中查看与编辑。 */
export default function OperationsAlerts({ api, canManage }: { api: AdminApi; canManage: boolean }) {
  const navigation = useAdminNavigation();
  const listQuery = useListQuery({ namespace: "alerts", defaults: {} });
  const [overview, setOverview] = useState<AlertOverview | null>(null),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false),
    [readError, setReadError] = useState("");
  const [editing, setEditing] = useState(false),
    [baseline, setBaseline] = useState<AlertPolicy | null>(null),
    [form, setForm] = useState<PolicyInput | null>(null),
    [latest, setLatest] = useState<AlertPolicy | null>(null);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<"policy" | "evaluation" | null>(null),
    [discard, setDiscard] = useState(false);
  const writing = useRef(false),
    mounted = useRef(true),
    sent = useRef<ReturnType<typeof settings> | null>(null);
  const { page, pageSize } = listQuery;
  // 第一页同时用于推导首次/最近触发；条件相同的读取由缓存合并为一次请求。
  const recent = useReadPage<AlertEvent>(api, "/operations/alerts/events?page=1&pageSize=20", revision);
  const events = useReadPage<AlertEvent>(api, `/operations/alerts/events?page=${page}&pageSize=${pageSize}`, revision, page !== 1 || pageSize !== 20);
  const eventPage = page === 1 && pageSize === 20 ? recent : events;
  const dirty = Boolean(form && baseline && stringifyJson(form) !== stringifyJson(inputOf(baseline))),
    locked = busy || pending !== null;
  const staleInput = Boolean(baseline && overview && stringifyJson(baseline.version) !== stringifyJson(overview.policy.version));
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setReadError("");
    void api<AlertOverview>("/operations/alerts/state", { signal: c.signal })
      .then((value) => {
        if (!c.signal.aborted) setOverview(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setOverview(null);
          setReadError(e.message);
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [api, revision]);
  useEffect(
    () =>
      navigation.registerDraft({
        operationsPolicy: true,
        dirty: () => dirty || locked,
        busy: () => locked,
        canSave: false,
        save: async () => false,
        leaveMessage: "告警策略还有未保存输入，离开后将丢失。",
      }),
    [navigation.registerDraft, dirty, locked],
  );
  const begin = () => {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    return true;
  };
  const finish = () => {
    writing.current = false;
    if (mounted.current) setBusy(false);
  };
  function adopt(p: AlertPolicy) {
    setOverview((current) => (current ? { ...current, policy: p, stale: current.stale || stringifyJson(current.policy.version) !== stringifyJson(p.version) } : current));
    setBaseline(p);
    setForm(inputOf(p));
    setLatest(null);
    setPending(null);
  }
  async function save() {
    if (!canManage || !form || !baseline || Object.keys(inputProblems(form)).length > 0 || staleInput || latest || locked || !begin()) return;
    const next = {
      windowMinutes: form.windowMinutes,
      minRequests: form.minRequests,
      failureEnabled: form.failureEnabled,
      failureRateThreshold: form.failureEnabled ? parseJson(form.failureRateThreshold) : baseline.failureRateThreshold,
      latencyEnabled: form.latencyEnabled,
      averageLatencyThresholdMillis: form.latencyEnabled ? form.averageLatencyThresholdMillis : baseline.averageLatencyThresholdMillis,
    } as ReturnType<typeof settings>;
    sent.current = next;
    try {
      const saved = await api<AlertPolicy>("/operations/alerts/policy", {
        method: "PUT",
        body: { expectedVersion: baseline.version, ...next },
      });
      if (!mounted.current) return;
      adopt(saved);
      setEditing(false);
      setMessage("告警策略已保存；状态以当前策略重新评估为准。");
      setRevision((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
      if (unknownFailure(e)) setPending("policy");
      else if (e instanceof AdminApiError && (e.code === 409 || e.code === 40900001)) {
        try {
          setLatest(await api<AlertPolicy>("/operations/alerts/policy"));
        } catch {
          /* 保留原输入和基线，显式重新读取。 */
        }
      }
    } finally {
      finish();
    }
  }
  async function evaluate() {
    if (!canManage || locked || dirty || !begin()) return;
    try {
      const value = await api<AlertOverview>("/operations/alerts/evaluate", { method: "POST", body: {} });
      if (!mounted.current) return;
      setOverview(value);
      setMessage("评估已完成，已重新读取当前状态与事件。");
      setRevision((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
      if (unknownFailure(e)) setPending("evaluation");
    } finally {
      finish();
    }
  }
  async function reconcile() {
    if (!begin()) return;
    try {
      if (pending === "evaluation") {
        const value = await api<AlertOverview>("/operations/alerts/state");
        setOverview(value);
        setPending(null);
        setMessage("已读取实际评估状态；以记录窗口和策略版本为准。");
        return;
      }
      const value = await api<AlertPolicy>("/operations/alerts/policy");
      if (pending === "policy" && sent.current && sameJsonValue(settings(value), sent.current)) {
        adopt(value);
        setMessage("已核对：当前策略与本次设置一致。");
        setRevision((n) => n + 1);
      } else {
        setLatest(value);
        setPending(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      finish();
    }
  }
  /** 一键查看日志：告警记录窗口内的正式调用（告警只监测正式调用总量）；失败率告警只看失败。 */
  function openLogs(record: Pick<AlertState, "metric" | "windowStart" | "windowEnd">) {
    navigation.navigate(logsRoute({ from: record.windowStart, to: record.windowEnd, mode: "PRODUCTION", outcome: record.metric === "FAILURE_RATE" ? "FAILURE" : undefined }));
  }
  const openPolicy = () => {
    adopt(overview!.policy);
    setEditing(true);
    setError("");
  };
  const closePolicy = () => {
    if (locked) return;
    if (dirty) setDiscard(true);
    else setEditing(false);
  };
  const fieldErrors = form ? inputProblems(form) : {};
  const recentEvents = recent.data?.items ?? [];
  const evaluateBlocked = !overview ? "告警状态尚未读取" : locked ? "正在处理上一操作" : dirty ? "请先保存或放弃策略修改" : "";
  const saveBlocked = !form
    ? ""
    : locked
      ? "正在处理上一操作"
      : staleInput || latest
        ? "策略基线已变化，请先处理最新版本"
        : Object.keys(fieldErrors).length
          ? `请修正 ${Object.keys(fieldErrors).length} 项标红设置后保存`
          : !dirty
            ? "与读取策略一致，没有需要保存的修改"
            : "";
  const enabled = (metric: AlertMetric) => (metric === "FAILURE_RATE" ? overview?.policy.failureEnabled : overview?.policy.latencyEnabled);
  const threshold = (metric: AlertMetric) =>
    !overview ? "" : !enabled(metric) ? "当前已关闭" : metric === "FAILURE_RATE" ? `失败率 ≥ ${count(overview.policy.failureRateThreshold)}%` : `平均耗时 ≥ ${count(overview.policy.averageLatencyThresholdMillis)} ms`;

  return (
    <section className="op-alerts" aria-labelledby="alerts-title">
      <PageHeader
        title={<span id="alerts-title">告警</span>}
        meta={
          <span className="op-alerts__meta">
            平台正式调用 · 站内告警
            {overview && ` · 策略 v${count(overview.policy.version)} · ${overview.policy.windowMinutes} 分钟窗口 · 最少 ${count(overview.policy.minRequests)} 条`}
            {overview?.stale && <StatusBadge tone="warning">陈旧 / 待评估</StatusBadge>}
          </span>
        }
        secondaryActions={
          <>
            <Popover trigger="click" content={<p className="op-analytics__note-pop">使用已结束并延迟一分钟的窗口；数据不足不等于恢复。只记录站内状态变化，不发送外部通知、不自动修改治理。陈旧表示上次结果不能代表当前策略或当前健康。</p>}>
              <Button>评估说明</Button>
            </Popover>
            <Tooltip title="刷新告警">
              <Button icon={<ReloadOutlined aria-hidden />} aria-label="刷新告警" disabled={locked || loading} onClick={() => setRevision((n) => n + 1)} />
            </Tooltip>
            <Tooltip title={!overview ? "告警状态尚未读取" : locked ? "正在处理上一操作" : undefined}>
              <Button disabled={locked || !overview} onClick={openPolicy}>
                {canManage ? "配置策略" : "查看策略"}
              </Button>
            </Tooltip>
          </>
        }
        primaryAction={
          canManage ? (
            <Tooltip title={evaluateBlocked || undefined}>
              <Button type="primary" disabled={Boolean(evaluateBlocked)} onClick={() => void evaluate()}>
                立即评估
              </Button>
            </Tooltip>
          ) : undefined
        }
      />
      <ErrorFeedback error={error} />
      {message && <Alert type="success" closable title={message} />}
      {pending && (
        <div className="op-alerts__recovery" role="status">
          {pending === "policy" ? "保存结果未知，先读取当前策略核对。" : "评估结果未知，先读取实际窗口与状态。"}
          <Button disabled={busy} onClick={() => void reconcile()}>
            核对当前状态
          </Button>
        </div>
      )}
      <div className="op-analytics__surface">
        {readError ? (
          <EmptyState kind="error" title="告警状态尚未读取成功" description={`${readError}；不可把读取失败当正常。`} action={<Button onClick={() => setRevision((n) => n + 1)}>重新读取</Button>} />
        ) : (
          <DataTable<AlertState>
            caption="告警列表"
            rowKey={(state) => state.metric}
            data={overview?.states ?? []}
            loading={loading}
            rowClassName={(state) => (state.status === "FIRING" ? "op-alerts__firing" : "")}
            empty={<EmptyState title={loading ? "正在读取告警…" : "尚无评估状态"} description={loading ? undefined : "请核对策略后评估。"} />}
            columns={[
              { key: "level", title: "级别", width: 90, hideable: false, render: (state) => <levels.Badge value={state.metric} /> },
              {
                key: "object",
                title: "对象",
                hideable: false,
                render: (state) => (
                  <span className="op-alerts__stack">
                    <span>平台正式调用 · {metricNames[state.metric]}</span>
                    <small>{threshold(state.metric)}</small>
                  </span>
                ),
              },
              {
                key: "status",
                title: "状态",
                width: 150,
                render: (state) => (
                  <span className="op-alerts__stack">
                    <span>
                      {overview?.stale && <span className="op-alerts__muted">上次 · </span>}
                      <statuses.Badge value={state.status} />
                    </span>
                    {!enabled(state.metric) && state.status !== "DISABLED" && <small>当前已关闭</small>}
                  </span>
                ),
              },
              {
                key: "value",
                title: "观测值 / 样本",
                width: 130,
                render: (state) => (
                  <span className="op-alerts__stack">
                    <span>{metricValue(state)}</span>
                    <small>样本 {count(state.sampleCount)}</small>
                  </span>
                ),
              },
              {
                key: "first",
                title: "首次触发",
                width: 170,
                render: (state) => {
                  const period = firingPeriod(state, recentEvents);
                  return period.first ? displayTime(period.first) : <span className="op-alerts__muted">{recent.loading ? "读取中" : "近期未触发"}</span>;
                },
              },
              {
                key: "last",
                title: "最近触发",
                width: 170,
                render: (state) => {
                  const period = firingPeriod(state, recentEvents);
                  return period.last ? (
                    <span className="op-alerts__stack">
                      <span>{displayTime(period.last)}</span>
                      <small>{state.status === "FIRING" ? "仍在告警" : "已离开告警"}</small>
                    </span>
                  ) : (
                    <span className="op-alerts__muted">—</span>
                  );
                },
              },
              {
                key: "window",
                title: "评估窗口",
                defaultHidden: true,
                render: (state) => (
                  <span className="op-alerts__stack">
                    <span>{displayTime(state.windowStart)}</span>
                    <small>
                      至 {displayTime(state.windowEnd)} · 评估于 {displayTime(state.evaluatedAt)}
                    </small>
                  </span>
                ),
              },
              {
                key: "actions",
                title: "操作",
                width: 150,
                hideable: false,
                render: (state) => (
                  <Tooltip title={!state.windowStart || !state.windowEnd ? "尚无评估窗口" : locked ? "正在处理上一操作" : `${displayTime(state.windowStart)} 至 ${displayTime(state.windowEnd)}${state.metric === "FAILURE_RATE" ? " 的失败调用" : " 的全部正式调用"}`}>
                    <Button type="link" size="small" disabled={locked || !state.windowStart || !state.windowEnd} onClick={() => openLogs(state)}>
                      {state.metric === "FAILURE_RATE" ? "查看失败日志" : "查看窗口日志"}
                    </Button>
                  </Tooltip>
                ),
              },
            ]}
          />
        )}
      </div>
      <section className="op-analytics__surface op-alerts__events" aria-label="告警状态变化">
        <header>
          <h2>状态变化记录</h2>
          <span className="op-alerts__muted">只记录站内状态变化</span>
        </header>
        {eventPage.error ? (
          <EmptyState kind="error" title="状态变化读取失败" description={eventPage.error} action={<Button onClick={eventPage.reload}>重新读取</Button>} />
        ) : (
          <DataTable<AlertEvent>
            caption="告警状态变化"
            rowKey={(event) => event.id}
            data={eventPage.data?.items ?? []}
            loading={eventPage.loading}
            pagination={
              eventPage.data
                ? {
                    page,
                    pageSize,
                    // 偏移上限：最多翻到 5001 页，到上限后仍可返回上一页。
                    total: Math.min(Number(count(eventPage.data.total)), 5001 * pageSize),
                    onChange: (next, size) => (size !== pageSize ? listQuery.setPageSize(size) : listQuery.setPage(next)),
                  }
                : undefined
            }
            empty={<EmptyState title="暂无状态变化" />}
            columns={[
              {
                key: "occurredAt",
                title: "事件时间 / 指标",
                hideable: false,
                render: (event) => (
                  <span className="op-alerts__stack">
                    <span>{displayTime(event.occurredAt)}</span>
                    <small>
                      {metricNames[event.metric]} · 策略 v{count(event.policyVersion)}
                    </small>
                  </span>
                ),
              },
              {
                key: "change",
                title: "状态变化",
                render: (event) => (
                  <span className="op-alerts__change">
                    {event.previousStatus === null ? "首次评估" : statuses.get(event.previousStatus).label} → <statuses.Badge value={event.status} />
                  </span>
                ),
              },
              {
                key: "value",
                title: "观测值 / 样本",
                render: (event) => (
                  <span className="op-alerts__stack">
                    <span>{metricValue(event)}</span>
                    <small>样本 {count(event.sampleCount)}</small>
                  </span>
                ),
              },
              {
                key: "window",
                title: "记录窗口",
                render: (event) => (
                  <span className="op-alerts__stack">
                    <span>{displayTime(event.windowStart)}</span>
                    <small>至 {displayTime(event.windowEnd)}</small>
                  </span>
                ),
              },
              {
                key: "actions",
                title: "操作",
                width: 130,
                hideable: false,
                render: (event) => (
                  <Tooltip title={locked ? "正在处理上一操作" : undefined}>
                    <Button type="link" size="small" disabled={locked} onClick={() => openLogs(event)}>
                      查看当时日志
                    </Button>
                  </Tooltip>
                ),
              },
            ]}
          />
        )}
      </section>
      <EntityDrawer
        open={editing && Boolean(form && baseline)}
        title={`告警策略 · v${baseline ? count(baseline.version) : ""}`}
        status={!canManage ? <StatusBadge tone="neutral">只读</StatusBadge> : dirty ? <StatusBadge tone="warning">未保存</StatusBadge> : undefined}
        subtitle="平台正式调用总量，不受调用分析的对象筛选影响"
        onClose={closePolicy}
        footer={
          canManage && form ? (
            <div className="op-alerts__policy-footer">
              <span role="status" className={Object.keys(fieldErrors).length ? "op-alerts__error" : "op-alerts__muted"}>
                {Object.keys(fieldErrors).length ? `请修正 ${Object.keys(fieldErrors).length} 项标红设置后保存` : dirty ? "有未保存修改" : "与读取策略一致"}
              </span>
              <Button onClick={closePolicy} disabled={locked}>
                关闭
              </Button>
              <Tooltip title={saveBlocked || undefined}>
                <Button type="primary" disabled={Boolean(saveBlocked)} onClick={() => void save()}>
                  保存告警策略
                </Button>
              </Tooltip>
            </div>
          ) : undefined
        }
      >
        {form && baseline && (
          <div className="op-alerts__policy" aria-label="告警策略配置">
            {(latest || staleInput) && (
              <div className="op-alerts__recovery">
                <span>策略基线已变化，输入仍保留。</span>
                {!latest ? (
                  <Button disabled={busy} onClick={() => void reconcile()}>
                    读取最新策略
                  </Button>
                ) : (
                  <>
                    <span>
                      最新 v{count(latest.version)}：{latest.windowMinutes}分钟 / 最少{count(latest.minRequests)}条；失败率
                      {latest.failureEnabled ? count(latest.failureRateThreshold) + "%" : "关闭"}，耗时
                      {latest.latencyEnabled ? latest.averageLatencyThresholdMillis + "ms" : "关闭"}
                    </span>
                    <Button onClick={() => adopt(latest)}>采用最新策略</Button>
                    <Button
                      onClick={() => {
                        setBaseline(latest);
                        setOverview((current) => (current ? { ...current, policy: latest, stale: true } : current));
                        setLatest(null);
                        setError("");
                      }}
                    >
                      保留输入，以最新版本继续编辑
                    </Button>
                  </>
                )}
              </div>
            )}
            <div className="op-alerts__fields">
              <label>
                <FieldLabel label="告警窗口" />
                <Select
                  aria-label="告警窗口"
                  disabled={!canManage || locked}
                  value={form.windowMinutes}
                  options={[5, 15, 60].map((value) => ({ value, label: value + "分钟" }))}
                  onChange={(windowMinutes) => setForm({ ...form, windowMinutes })}
                />
              </label>
              <label>
                <FieldLabel label="最少样本数" />
                <InputNumber
                  aria-label="最少样本数"
                  status={fieldErrors.minRequests ? "error" : undefined}
                  aria-invalid={Boolean(fieldErrors.minRequests)}
                  aria-describedby={fieldErrors.minRequests ? "policy-minRequests-error" : undefined}
                  disabled={!canManage || locked}
                  min={1}
                  max={1000000}
                  precision={0}
                  value={Number.isFinite(form.minRequests) ? form.minRequests : null}
                  onChange={(value) => setForm({ ...form, minRequests: value ?? NaN })}
                  style={{ width: "100%" }}
                />
                {fieldErrors.minRequests && (
                  <span className="op-alerts__error" id="policy-minRequests-error" role="status">
                    {fieldErrors.minRequests}
                  </span>
                )}
              </label>
            </div>
            <section className="op-alerts__metric">
              <Checkbox disabled={!canManage || locked} checked={form.failureEnabled} onChange={(e) => setForm({ ...form, failureEnabled: e.target.checked })}>
                启用失败率告警
              </Checkbox>
              {form.failureEnabled ? (
                <label>
                  <FieldLabel label="失败率阈值（%）" />
                  <Input
                    aria-label="失败率阈值（%）"
                    status={fieldErrors.failureRateThreshold ? "error" : undefined}
                    aria-invalid={Boolean(fieldErrors.failureRateThreshold)}
                    aria-describedby={fieldErrors.failureRateThreshold ? "policy-failureRateThreshold-error" : undefined}
                    disabled={!canManage || locked}
                    value={form.failureRateThreshold}
                    onChange={(e) => setForm({ ...form, failureRateThreshold: e.target.value })}
                  />
                  {fieldErrors.failureRateThreshold && (
                    <span className="op-alerts__error" id="policy-failureRateThreshold-error" role="status">
                      {fieldErrors.failureRateThreshold}
                    </span>
                  )}
                </label>
              ) : (
                <p className="op-alerts__muted">关闭时不评估此指标，也不代表正常。</p>
              )}
            </section>
            <section className="op-alerts__metric">
              <Checkbox disabled={!canManage || locked} checked={form.latencyEnabled} onChange={(e) => setForm({ ...form, latencyEnabled: e.target.checked })}>
                启用平均耗时告警
              </Checkbox>
              {form.latencyEnabled ? (
                <label>
                  <FieldLabel label="平均耗时阈值（ms）" />
                  <InputNumber
                    aria-label="平均耗时阈值（ms）"
                    status={fieldErrors.averageLatencyThresholdMillis ? "error" : undefined}
                    aria-invalid={Boolean(fieldErrors.averageLatencyThresholdMillis)}
                    aria-describedby={fieldErrors.averageLatencyThresholdMillis ? "policy-averageLatencyThresholdMillis-error" : undefined}
                    disabled={!canManage || locked}
                    min={1}
                    max={300000}
                    precision={0}
                    value={Number.isFinite(form.averageLatencyThresholdMillis) ? form.averageLatencyThresholdMillis : null}
                    onChange={(v) => setForm({ ...form, averageLatencyThresholdMillis: v ?? NaN })}
                    style={{ width: "100%" }}
                  />
                  {fieldErrors.averageLatencyThresholdMillis && (
                    <span className="op-alerts__error" id="policy-averageLatencyThresholdMillis-error" role="status">
                      {fieldErrors.averageLatencyThresholdMillis}
                    </span>
                  )}
                </label>
              ) : (
                <p className="op-alerts__muted">关闭时不评估此指标，也不代表正常。</p>
              )}
            </section>
            {discard && (
              <div className="op-alerts__recovery" role="alert">
                <span>放弃未保存的策略输入？</span>
                <Button
                  onClick={() => {
                    setEditing(false);
                    setForm(inputOf(baseline));
                    setDiscard(false);
                  }}
                >
                  放弃修改
                </Button>
                <Button onClick={() => setDiscard(false)}>继续编辑</Button>
              </div>
            )}
          </div>
        )}
      </EntityDrawer>
    </section>
  );
}
