import { useEffect, useState } from "react";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { EmptyState, FieldHelp, IdText, PageHeader, PersonTag, StatusBadge, type StatusTone } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, FilterBar, QuickSelect, useDebouncedCallback, type FilterChip } from "@cyl/open-platform-web-shared/ui/list";
import { Alert, Button, Input, Segmented, Tooltip } from "antd";
import type { AdminApi } from "../access/api";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import type { ApiDefinition, ApiSummary } from "../catalog/CatalogPanel";
import {
  useAdminNavigation,
  type AdminRoute,
} from "../navigation/AdminNavigation";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import PublishPage from "./PublishPage";
import ReleaseReview from "./ReleaseReview";
import { publicationTime } from "./publicationDisplay";
import {
  releaseOutcome,
  type PublicationSubmission,
  type ReleaseSummary,
} from "./types";
import "./release-review.css";

const results = {
  ALL: "所有状态",
  PENDING: "待审核",
  APPROVED: "审核通过",
  REJECTED: "已驳回",
  FAILED: "发布失败",
  NOT_REQUIRED: "免审生效",
};
interface Props {
  publicationNotes?: Map<string,string>;
  api: AdminApi;
  permissions: string[];
  pendingSubmissions: Map<string, PublicationSubmission>;
}
export default function PublicationPanel({
  api,
  permissions,
  pendingSubmissions,
  publicationNotes,
}: Props) {
  const navigation = useAdminNavigation(),
    route = navigation.route;
  const [query, setQuery] = useState(route.query);
  const [revision, setRevision] = useState(0);
  const [publisherOpen, setPublisherOpen] = useState(false);
  const result = route.releaseResult ?? "PENDING";
  const status =
    result === "APPROVED" || result === "NOT_REQUIRED"
      ? "APPLIED"
      : result === "ALL"
        ? ""
        : result;
  const policy =
    result === "APPROVED"
      ? "&auditRequired=true"
      : result === "NOT_REQUIRED"
        ? "&auditRequired=false"
        : "";
  const releases = useReadPage<ReleaseSummary>(
    api,
    `/publications?page=${route.pageNo}&pageSize=${route.pageSize ?? 20}&query=${encodeURIComponent(route.query)}&status=${status}${policy}`,
    revision,
    !route.apiId,
    { keepPrevious: true },
  );
  useEffect(() => setQuery(route.query), [route.query]);
  const refresh = () => setRevision((value) => value + 1);
  const openReview = (id: string) =>
    navigation.navigate({ ...route, apiId: null, releaseId: id });
  const back = () => {
    navigation.navigate({ ...route, apiId: null, releaseId: null });
    refresh();
  };
  const apply = (next: string = result, text = query) =>
    navigation.navigate({
      ...route,
      query: text.trim(),
      // 默认“待审核”不写入地址。
      releaseResult: next === "PENDING" ? undefined : (next as AdminRoute["releaseResult"]),
      pageNo: 1,
      releaseId: null,
      apiId: null,
    });
  if (route.apiId)
    return (
      <PublisherWorkspace
        publicationNotes={publicationNotes}
        key={route.apiId}
        api={api}
        apiId={route.apiId}
        permissions={permissions}
        pendingSubmissions={pendingSubmissions}
        onBack={back}
        onChanged={refresh}
        onReview={openReview}
      />
    );
  const canReview = permissions.includes("REVIEW_APIS");
  const resultTones: Record<string, StatusTone> = { PENDING: "info", APPROVED: "success", NOT_REQUIRED: "success", REJECTED: "error", FAILED: "error" };
  const chips: FilterChip[] = [];
  if (route.query) chips.push({ key: "query", text: `关键词：${route.query}`, label: `关键词：${route.query}`, onRemove: () => apply(result, "") });
  if (result !== "PENDING") chips.push({ key: "result", text: `结果：${results[result]}`, label: `结果：${results[result]}`, onRemove: () => apply("PENDING", route.query) });
  return (
    <section className="op-list-page" aria-labelledby="review-list-title">
      <PageHeader
        title={<span id="review-list-title">审核中心</span>}
        count={releases.data?.total}
        meta={
          <Segmented
            aria-label="审核中心视图"
            value="publications"
            options={[{ value: "publications", label: "发布审核" }, { value: "transfers", label: "跨环境发布" }]}
            onChange={() => navigation.navigate({ ...route, page: "transfers", query: "", pageNo: 1, releaseId: null, transferId: null })}
          />
        }
        secondaryActions={
          <>
            <Tooltip title="刷新">
              <Button icon={<ReloadOutlined />} aria-label="刷新审核列表" onClick={refresh} />
            </Tooltip>
            {permissions.includes("PUBLISH_APIS") && (
              <Button onClick={() => setPublisherOpen((value) => !value)}>
                {publisherOpen ? "收起发布与调用状态" : "发布与调用状态"}
              </Button>
            )}
          </>
        }
      />
      {publisherOpen && permissions.includes("PUBLISH_APIS") && (
        <PublisherApiPicker api={api} onSelect={(item) => navigation.navigate({ ...route, apiId: item.id, releaseId: null })} />
      )}
      <div className="op-list-surface">
        <FilterBar
          search={<ReviewSearch value={route.query} onChange={(text) => text !== route.query && apply(result, text)} />}
          quick={
            <>
              <QuickSelect
                label="结果"
                value={result}
                onChange={(value) => apply(value as string, route.query)}
                options={Object.entries(results).map(([value, label]) => ({ value, label }))}
                style={{ width: 170 }}
              />
              <FieldHelp label="审核结果">审核通过和免审生效均已产生生效快照；这里展示历史处理结果，当前是否启用在 API 工作区核对。</FieldHelp>
            </>
          }
          chips={chips}
          onClearAll={() => apply("PENDING", "")}
        />
        <DataTable<ReleaseSummary>
          caption="审核记录"
          rowKey={(item) => item.id}
          data={releases.error ? [] : (releases.data?.items ?? [])}
          loading={releases.loading}
          summary={releases.data ? (result === "PENDING" && !route.query ? `${releases.data.total} 个待审核` : `筛选出 ${releases.data.total} 条`) : undefined}
          pagination={releases.data ? { page: route.pageNo, pageSize: route.pageSize ?? 20, total: releases.data.total, onChange: (pageNo, size) => navigation.navigate({ ...route, pageNo: size !== (route.pageSize ?? 20) ? 1 : pageNo, pageSize: size }) } : undefined}
          columns={[
            {
              key: "api",
              title: "API",
              hideable: false,
              render: (item) => (
                <div className="op-cell-main">
                  <button type="button" className="op-cell-main__title is-link" onClick={() => openReview(item.id)}>{item.name}</button>
                  <IdText value={`${item.service}.${item.method} · ${item.version}`} copyable={false} maxChars={48} />
                </div>
              ),
            },
            {
              key: "revision",
              title: "提交版本",
              width: 150,
              render: (item) => (
                <div className="op-cell-main">
                  <span className="op-code">r{stringifyJson(item.draftRevision)}</span>
                  {item.kind === "ROLLBACK" && <span className="op-cell-sub">回滚发布 · {item.comment || "未记录原因"}</span>}
                </div>
              ),
            },
            {
              key: "submitter",
              title: "提交人",
              width: "16%",
              render: (item) => <PersonTag stacked name={item.submittedByName} employeeNo={item.submittedByEmployeeNo} id={`租户 ID ${item.submittedByTenantId}`} />,
            },
            { key: "submittedAt", title: "提交时间", width: 150, render: (item) => <time className="op-cell-sub" dateTime={item.submittedAt}>{publicationTime(item.submittedAt)}</time> },
            {
              key: "status",
              title: "结果",
              width: "18%",
              render: (item) => {
                const outcome = releaseOutcome(item);
                const key = item.status === "APPLIED" ? (item.auditRequired ? "APPROVED" : "NOT_REQUIRED") : item.status;
                return (
                  <div className="op-cell-main">
                    <StatusBadge tone={resultTones[key] ?? "neutral"}>{outcome}</StatusBadge>
                    {item.failureReason && <span className="op-cell-sub op-cell-sub--error">{item.failureReason}</span>}
                  </div>
                );
              },
            },
            {
              key: "actions",
              title: "操作",
              width: 96,
              hideable: false,
              render: (item) => (
                <Button type={item.status === "PENDING" && canReview ? "primary" : "link"} size="small" aria-label="查看固定快照与差异" onClick={() => openReview(item.id)}>
                  {item.status === "PENDING" && canReview ? "审核" : "查看"}
                </Button>
              ),
            },
          ]}
          empty={
            releases.error ? (
              <EmptyState kind="error" title="审核记录加载失败" description={releases.error} action={<Button onClick={releases.reload}>重新加载</Button>} />
            ) : chips.length ? (
              <EmptyState kind="noResult" title="没有匹配的审核记录" action={<Button onClick={() => apply("PENDING", "")}>清除筛选</Button>} />
            ) : (
              <EmptyState title="暂无待审核申请" description="提交发布后会出现在这里。" />
            )
          }
        />
      </div>
      {route.releaseId && (
        <ReleaseReview
          publicationNotes={publicationNotes}
          key={route.releaseId}
          api={api}
          releaseId={route.releaseId}
          canReview={canReview}
          onChanged={refresh}
          onBack={back}
        />
      )}
    </section>
  );
}

function ReviewSearch({ value, onChange, label = "审核接口名称" }: { value: string; onChange: (text: string) => void; label?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const debounced = useDebouncedCallback((next: string) => onChange(next.trim()));
  return (
    <Input
      allowClear
      aria-label={label}
      prefix={<SearchOutlined aria-hidden />}
      maxLength={100}
      value={text}
      placeholder="搜索接口名称 / service / method"
      onChange={(event) => {
        setText(event.target.value);
        debounced.run(event.target.value);
      }}
      onPressEnter={() => debounced.flush(text)}
    />
  );
}

function PublisherWorkspace({
  api,
  apiId,
  permissions,
  pendingSubmissions,
  publicationNotes,
  onBack,
  onChanged,
  onReview,
}: Props & {
  apiId: string;
  onBack: () => void;
  onChanged: () => void;
  onReview: (id: string) => void;
}) {
  const navigation=useAdminNavigation();
  const [definition, setDefinition] = useState<ApiDefinition | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setLoading(true);
    void api<ApiDefinition>(
      `/publications/apis/${encodeURIComponent(apiId)}/candidate`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setDefinition(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, apiId, revision]);
  return (
    <section className="op-list-page" aria-labelledby="publisher-workspace-title">
      <PageHeader title={<span id="publisher-workspace-title">{definition?.name || "API 发布工作区"}</span>} secondaryActions={<Button onClick={onBack}>返回审核列表</Button>} />
      {loading && !definition && <p role="status" className="op-muted">正在加载发布候选…</p>}
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          action={
            <Button size="small" onClick={() => setRevision((value) => value + 1)}>
              重新加载
            </Button>
          }
        />
      )}
      {definition && (
        <PublishPage
          key={definition.id}
          api={api}
          definition={definition}
          canPublish={permissions.includes("PUBLISH_APIS")}
          pendingSubmissions={pendingSubmissions}
          publicationNotes={publicationNotes}
          onChanged={() => {
            setRevision((value) => value + 1);
            onChanged();
          }}
          onReview={onReview}
          onRefreshCandidate={() => setRevision((value) => value + 1)}
          onTransfer={(releaseId) => navigation.navigate({ ...navigation.route, page: "transfers", transferId: "new", releaseId, query: "", pageNo: 1 })}
        />
      )}
    </section>
  );
}
function PublisherApiPicker({
  api,
  onSelect,
}: {
  api: AdminApi;
  onSelect: (item: ApiSummary) => void;
}) {
  const [page, setPage] = useState(1),
    [filter, setFilter] = useState("");
  const apis = useReadPage<ApiSummary>(
    api,
    `/publications/apis?page=${page}&pageSize=20&query=${encodeURIComponent(filter)}`,
    0,
    true,
    { keepPrevious: true },
  );
  return (
    <section className="op-list-surface op-publisher-picker" aria-label="选择发布 API">
      <FilterBar
        search={
          <ReviewSearch
            label="搜索可发布 API"
            value={filter}
            onChange={(text) => {
              setFilter(text);
              setPage(1);
            }}
          />
        }
        chips={[]}
        onClearAll={() => setFilter("")}
      />
      <DataTable<ApiSummary>
        caption="可发布 API"
        rowKey={(item) => item.id}
        data={apis.error ? [] : (apis.data?.items ?? [])}
        loading={apis.loading}
        summary={apis.data ? `选择要发布或核对调用状态的 API · 共 ${apis.data.total} 个` : undefined}
        pagination={apis.data ? { page, pageSize: 20, total: apis.data.total, pageSizeOptions: [20], onChange: setPage } : undefined}
        columns={[
          {
            key: "api",
            title: "API",
            hideable: false,
            render: (item) => (
              <div className="op-cell-main">
                <button type="button" className="op-cell-main__title is-link" onClick={() => onSelect(item)}>
                  {item.name}
                </button>
                <IdText value={`${item.service}.${item.method} · ${item.version}`} copyable={false} maxChars={48} />
              </div>
            ),
          },
          { key: "revision", title: "草稿修订", width: 120, render: (item) => <span className="op-code">r{stringifyJson(item.draftRevision)}</span> },
          { key: "protocol", title: "协议", width: 100, render: (item) => item.protocol },
        ]}
        empty={
          apis.error ? (
            <EmptyState kind="error" title="可发布 API 加载失败" description={apis.error} action={<Button onClick={apis.reload}>重新加载</Button>} />
          ) : (
            <EmptyState kind={filter ? "noResult" : "empty"} title={filter ? "没有匹配的 API" : "暂无可发布 API"} />
          )
        }
      />
    </section>
  );
}
