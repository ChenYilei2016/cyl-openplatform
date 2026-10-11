import { type ReactNode, useEffect, useRef, useState } from "react";
import { ArrowLeftOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Input, Select } from "antd";
import { LoadFeedback, Pagination, usePage } from "../components";
import type { Page } from "../http";
import { lifecycleStatusNames } from "../lifecycle/LifecycleDetails";
import { stringifyJson } from "../json";
import { EmptyState, FieldHelp, defineStatusMap } from "../ui/components";
import { DataTable, FilterBar, useDebouncedCallback, type FilterChip } from "../ui/list";
import type { DocumentClient } from "./api";
import DocumentContent from "./DocumentContent";
import DocumentExport from "./DocumentExport";
import type { DocumentCategory, DocumentSummary, DocumentView } from "./types";
import "./documents.css";

type SearchFields = { query: string; service: string; version: string; method: string };
const emptySearch: SearchFields = { query: "", service: "", version: "", method: "" };
const preciseFields = [
  { key: "service", label: "服务（精确）", maxLength: 64 },
  { key: "version", label: "外部版本（精确）", maxLength: 32 },
  { key: "method", label: "操作（精确）", maxLength: 64 },
] as const;
const chipLabels: Record<keyof SearchFields, string> = { query: "关键词", service: "服务", version: "外部版本", method: "操作" };

const lifecycleStatus = defineStatusMap({
  ACTIVE: { tone: "success", label: lifecycleStatusNames.ACTIVE },
  DEPRECATED: { tone: "warning", label: lifecycleStatusNames.DEPRECATED },
  RETIRED: { tone: "neutral", label: lifecycleStatusNames.RETIRED },
});

const toFilters = (search: SearchFields) => {
  const params = new URLSearchParams();
  for (const key of ["query", "service", "version", "method"] as const) {
    const value = search[key].trim();
    if (value) params.set(key, value);
  }
  return params.size ? `&${params}` : "";
};

/** 管理与Bearer文档共用阅读工作区；身份客户端仍分别负责授权。筛选即时生效（106 第 5 节）。 */
export default function DocumentExplorer({
  client,
  renderInvocation,
  invocationLabel = "接入资源",
  showRawSchema = false,
  title = "生效文档",
}: {
  client: DocumentClient;
  /** 页面标题：管理端与菜单名一致（“文档预览”），嵌入门户时保持“生效文档”。 */
  title?: string;
  renderInvocation?: (view: DocumentView, refreshing: boolean) => ReactNode;
  invocationLabel?: string;
  showRawSchema?: boolean;
}) {
  const detail = useRef<HTMLElement>(null);
  const [search, setSearch] = useState<SearchFields>(emptySearch),
    [applied, setApplied] = useState<SearchFields>(emptySearch),
    [category, setCategory] = useState("");
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20),
    [categoryPage, setCategoryPage] = useState(1);
  const [selected, setSelected] = useState<DocumentSummary | null>(null);
  const [loadedView, setView] = useState<DocumentView | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const viewClient = useRef(client);
  const [reading, setReading] = useState(false);
  const view = viewClient.current === client && loadedView && selected && loadedView.service === selected.service && loadedView.version === selected.version && loadedView.method === selected.method ? loadedView : null;
  const [advanced, setAdvanced] = useState(false);
  const filters = toFilters(applied);
  const list = usePage<DocumentSummary>(
    client.read,
    `?page=${page}&pageSize=${pageSize}${filters}${category ? `&category=${encodeURIComponent(category)}` : ""}`,
  );
  const groups = usePage<DocumentCategory>(
    client.read,
    `/categories?page=${categoryPage}&pageSize=20${filters}`,
  );
  // 翻页或筛选时保留上一页直到新结果返回，避免表格闪空；更换身份客户端时不沿用。
  const shown = useRef<{ client: DocumentClient; data: Page<DocumentSummary> } | null>(null);
  if (list.data) shown.current = { client, data: list.data };
  const rows = shown.current?.client === client ? shown.current.data : null;
  const apply = (next: SearchFields) => {
    setApplied(next);
    setPage(1);
    setCategoryPage(1);
    setCategory("");
  };
  const debounced = useDebouncedCallback(apply, 300);
  const edit = (changes: Partial<SearchFields>) => {
    const next = { ...search, ...changes };
    setSearch(next);
    debounced.run(next);
  };
  const chooseCategory = (value: string) => {
    setCategory(value);
    setPage(1);
    setSelected(null);
  };
  const clearAll = () => {
    debounced.cancel();
    setSearch(emptySearch);
    apply(emptySearch);
  };
  const chips: FilterChip[] = [
    ...(Object.keys(chipLabels) as (keyof SearchFields)[])
      .filter((key) => applied[key].trim())
      .map((key) => ({
        key,
        label: `${chipLabels[key]}：${applied[key].trim()}`,
        text: `${chipLabels[key]}：${applied[key].trim()}`,
        onRemove: () => {
          const next = { ...applied, [key]: "" };
          debounced.cancel();
          setSearch({ ...search, [key]: "" });
          apply(next);
        },
      })),
    ...(category
      ? [{ key: "category", label: `分类：${category}`, text: `分类：${category}`, onRemove: () => chooseCategory("") }]
      : []),
  ];
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setReading(!!selected);
    if (selected)
      void client
        .read<DocumentView>(
          `/${[selected.service, selected.version, selected.method].map(encodeURIComponent).join("/")}/view`,
          { signal: controller.signal },
        )
        .then((value) => {
          if (!controller.signal.aborted) { viewClient.current = client; setView(value); setReading(false); }
        })
        .catch((error) => {
          if (!controller.signal.aborted) { setView(null); setReading(false); setError(error instanceof Error ? error.message : "文档读取失败。"); }
        });
    return () => controller.abort();
  }, [client, selected, revision]);
  useEffect(() => {
    if (view) detail.current?.focus({ preventScroll: true });
  }, [view]);
  const select =(id: string) => {
    const item = list.data?.items.find((item) => item.apiId === id);
    if (item) setSelected(item);
  };
  const switchOptions = [
    ...(selected && !list.data?.items.some((item) => item.apiId === selected.apiId) ? [selected] : []),
    ...(list.data?.items ?? []),
  ].map((item) => ({
    value: item.apiId,
    label: `${item.name} · ${item.version} · ${item.service}.${item.method}`,
  }));
  const chapters = view
    ? [
        ["document-overview", "概览"],
        ["document-request", "请求参数"],
        ["document-examples", "请求示例"],
        ["document-response", "响应参数"],
        ...(renderInvocation ? [["document-invocation", invocationLabel]] : []),
        ...(view.document.errorDefinitions.length ? [["document-errors", "错误码"]] : []),
      ]
    : [];
  return (
    <section className="op-doc-explorer" aria-label={title}>
      <header className="op-doc-explorer__head">
        <h2>{title}</h2>
        <FieldHelp label="阅读">只展示已生效内容。外部版本按原值区分，不自动选择最新版本；导出会重新核对当前生效快照。</FieldHelp>
      </header>
      <div className="op-doc-explorer__surface op-list-surface">
        <FilterBar
          search={
            <Input
              allowClear
              prefix={<SearchOutlined aria-hidden />}
              value={search.query}
              onChange={(event) => edit({ query: event.target.value })}
              onPressEnter={() => debounced.flush(search)}
              aria-label="搜索名称 / 服务 / 操作"
              placeholder="搜索名称、服务或操作"
              maxLength={100}
            />
          }
          moreCount={preciseFields.filter(({ key }) => applied[key].trim()).length}
          onMore={() => setAdvanced(!advanced)}
          chips={chips}
          onClearAll={() => {
            clearAll();
            chooseCategory("");
          }}
        />
        {advanced && (
          <div className="op-doc-explorer__precise" role="group" aria-label="精确筛选">
            {preciseFields.map(({ key, label, maxLength }) => (
              <label key={key}>
                {label}
                <Input
                  value={search[key]}
                  onChange={(event) => edit({ [key]: event.target.value })}
                  onPressEnter={() => debounced.flush(search)}
                  maxLength={maxLength}
                />
              </label>
            ))}
          </div>
        )}
        <div className="op-doc-explorer__body">
          <aside className="op-doc-explorer__categories" aria-label="文档分类">
            <h3>展示分类</h3>
            <button type="button" className="op-doc-explorer__category" aria-pressed={!category} onClick={() => chooseCategory("")}>
              全部分类
            </button>
            <LoadFeedback loading={groups.loading} error={groups.error} retry={groups.reload} />
            {groups.data?.items.map((group) => (
              <button
                type="button"
                className="op-doc-explorer__category"
                key={group.category}
                aria-pressed={category === group.category}
                onClick={() => chooseCategory(group.category)}
              >
                <span>{group.category || "未分类"}</span>
                <span className="op-doc-explorer__count">{group.apiCount}</span>
              </button>
            ))}
            {groups.data && (
              <Pagination label="分类分页" page={categoryPage} total={groups.data.total} onChange={setCategoryPage} disabled={groups.loading} />
            )}
          </aside>
          <div className="op-doc-explorer__main">
            {!selected && (
              <>
                {list.error && (
                  <div className="op-doc-explorer__feedback">
                    <LoadFeedback loading={false} error={list.error} retry={list.reload} />
                  </div>
                )}
                <DataTable<DocumentSummary>
                  caption="生效文档列表"
                  rowKey={(item) => item.apiId}
                  data={list.error ? [] : (rows?.items ?? [])}
                  loading={list.loading}
                  pagination={
                    rows
                      ? {
                          page,
                          pageSize,
                          total: rows.total,
                          onChange: (next, size) => {
                            setPage(size === pageSize ? next : 1);
                            setPageSize(size);
                          },
                        }
                      : undefined
                  }
                  empty={
                    <EmptyState
                      kind={chips.length ? "noResult" : "empty"}
                      title="当前条件下没有可读取的生效文档。"
                      action={chips.length ? <Button size="small" onClick={() => { clearAll(); chooseCategory(""); }}>清除筛选</Button> : undefined}
                    />
                  }
                  columns={[
                    {
                      key: "name",
                      title: "接口",
                      hideable: false,
                      render: (item) => (
                        <div className="op-cell-main">
                          <button type="button" className="op-cell-main__title is-link" onClick={() => setSelected(item)}>
                            {item.name}
                          </button>
                          {item.category && <span className="op-cell-sub">{item.category}</span>}
                        </div>
                      ),
                    },
                    {
                      key: "operation",
                      title: "服务 / 外部版本 / 操作",
                      render: (item) => (
                        <code className="op-doc-explorer__operation">
                          {item.service} / {item.version} / {item.method}
                        </code>
                      ),
                    },
                    {
                      key: "lifecycle",
                      title: "生命周期",
                      width: 180,
                      render: (item) => <lifecycleStatus.Badge value={item.lifecycleStatus} />,
                    },
                  ]}
                />
              </>
            )}
            {selected && (
              <article ref={detail} tabIndex={-1} aria-label={selected.name} className="op-doc-explorer__detail">
                <div className="op-doc-explorer__toolbar">
                  <Button icon={<ArrowLeftOutlined aria-hidden />} onClick={() => setSelected(null)}>
                    返回接口列表
                  </Button>
                  <Select
                    className="op-doc-explorer__switch"
                    aria-label="切换当前页接口"
                    value={selected.apiId}
                    onChange={select}
                    options={switchOptions}
                  />
                  <Button icon={<ReloadOutlined aria-hidden />} disabled={reading} onClick={() => setRevision((value) => value + 1)}>
                    刷新生效文档
                  </Button>
                </div>
                <LoadFeedback loading={reading || (!view && !error)} error={error} retry={() => setRevision((value) => value + 1)} />
                {view && (
                  <>
                    <header className="op-doc-explorer__title">
                      <h2>{view.document.title}</h2>
                      <span className="op-doc-explorer__meta">
                        外部 {view.version} · 生效 r{stringifyJson(view.document.draftRevision)}
                        <FieldHelp label="版本与发布记录">
                          外部版本 {view.version} · 发布快照 ID {view.releaseId} · 生效状态版本 {stringifyJson(view.stateVersion)} · 草稿修订{" "}
                          {stringifyJson(view.document.draftRevision)}
                        </FieldHelp>
                      </span>
                    </header>
                    <DocumentExport
                      client={client}
                      disabled={reading}
                      view={view}
                      onInvalidated={() => {
                        setView(null);
                        setError("文档已变化或不可用，请刷新后继续。");
                      }}
                    />
                    <nav className="op-doc-explorer__chapters" aria-label="文档章节">
                      {chapters.map(([id, title]) => (
                        <button
                          type="button"
                          key={id}
                          className="op-doc-explorer__chapter"
                          onClick={() => detail.current?.querySelector(`#${id}`)?.scrollIntoView({ block: "start" })}
                        >
                          {title}
                        </button>
                      ))}
                    </nav>
                    <DocumentContent
                      showTitle={false}
                      showRawSchema={showRawSchema}
                      document={view.document}
                      operation={{ service: view.service, version: view.version, method: view.method }}
                    />
                    {renderInvocation && (
                      <div id="document-invocation" className="op-doc-explorer__invocation">
                        {renderInvocation(view, reading)}
                      </div>
                    )}
                  </>
                )}
              </article>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
