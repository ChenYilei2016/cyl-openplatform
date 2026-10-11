import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { parseJson } from "@cyl/open-platform-web-shared/json";
import { DisabledReason, EmptyState, EntityDrawer, FieldHelp, IdText, PageHeader, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, FilterBar, useDebouncedCallback, type DataTableColumn, type FilterChip } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Alert, Button, Input, Segmented, Tooltip } from "antd";
import { useEffect, useRef, useState } from "react";
import { AdminApiError, type AdminApi } from "../access/api";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { useListQuery } from "../navigation/useListQuery";
import { publicationTime } from "../publication/publicationDisplay";
import EnvironmentReleasePanel from "./EnvironmentReleasePanel";
import TransferDetail, { TransferActions } from "./TransferDetail";
import { accessTone, deliveryTone, transferHelp, transferProgress } from "./transferProgress";
import type { OutgoingTransfer, Target, TransferSummary } from "./types";
import "./transfers.css";

/** 搜索 API service 或目标环境：停止输入 300ms 后生效，回车立即生效。 */
function TransferSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const debounced = useDebouncedCallback((next: string) => onChange(next.trim()));
  return (
    <Input
      allowClear
      aria-label="搜索 API service 或目标环境"
      prefix={<SearchOutlined aria-hidden />}
      maxLength={100}
      value={text}
      placeholder="搜索 API service / 目标环境，如 orders 或 prod"
      onChange={(event) => {
        setText(event.target.value);
        debounced.run(event.target.value);
      }}
      onPressEnter={() => debounced.flush(text)}
    />
  );
}

/** 审核中心 · 跨环境发布：发出记录列表（条件进地址）+ 进度抽屉；“new”为发起发送的工作区。 */
export default function EnvironmentReleaseRecords({ api, permissions, pendingTransfers }: { api: AdminApi; permissions: string[]; pendingTransfers: Map<string, string> }) {
  const navigation = useAdminNavigation();
  const route = navigation.route;
  const canPublish = permissions.includes("PUBLISH_APIS");
  const list = useListQuery({ namespace: "transfers", defaults: { query: "" } });
  const [revision, setRevision] = useState(0);
  const newOpen = route.transferId === "new";
  const history = useReadPage<TransferSummary>(
    api,
    `/environment-releases?page=${list.page}&pageSize=${list.pageSize}&query=${encodeURIComponent(list.filters.query)}`,
    revision,
    !newOpen,
    { keepPrevious: true },
  );
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [targetError, setTargetError] = useState("");
  const [detail, setDetail] = useState<OutgoingTransfer | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailRevision, setDetailRevision] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const previousNewOpen = useRef(newOpen);
  useEffect(() => {
    // 从发送工作区返回时重读列表，原筛选与页码保留在地址中。
    if (previousNewOpen.current && !newOpen) setRevision((value) => value + 1);
    previousNewOpen.current = newOpen;
  }, [newOpen]);
  const [operation, setOperation] = useState({ dirty: false, busy: false });
  const operationRef = useRef(operation);
  operationRef.current = operation;
  useEffect(() => {
    if (!newOpen) return;
    return navigation.registerDraft({
      environmentTransfer: true,
      dirty: () => operationRef.current.dirty,
      busy: () => operationRef.current.busy,
      canSave: false,
      save: async () => false,
      leaveMessage: "当前发送配置尚未完成；未确认的原传输仍在本次会话中保留，可从记录页查询。",
    });
  }, [newOpen, navigation.registerDraft, operation.busy]);
  const context = useRef(0);
  const pending = [...pendingTransfers].map(([key, body]) => ({ key, body, ...parseJson<{ transferId: string; releaseId: string; targetId: string }>(body) }));
  const original = pending.find((item) => item.transferId === route.transferId);
  useEffect(() => {
    const controller = new AbortController();
    setTargetError("");
    void api<Target[]>("/environment-releases/targets", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setTargets(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setTargetError(error.message);
      });
    return () => controller.abort();
  }, [api, revision]);
  useEffect(() => {
    const controller = new AbortController();
    context.current += 1;
    setDetail(null);
    setDetailError("");
    setNotFound(false);
    setBusy(false);
    if (route.transferId && route.transferId !== "new") {
      setBusy(true);
      void api<OutgoingTransfer>(`/environment-releases/${encodeURIComponent(route.transferId)}`, { signal: controller.signal })
        .then((value) => {
          if (!controller.signal.aborted) {
            if (original && ["ACCEPTED", "REJECTED"].includes(value.deliveryState) && pendingTransfers.get(original.key) === original.body) pendingTransfers.delete(original.key);
            setDetail(value);
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setDetailError(error.message);
            setNotFound(error instanceof AdminApiError && (error.code === 404 || Math.floor(error.code / 100000) === 404));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }
    return () => {
      controller.abort();
      context.current += 1;
    };
  }, [api, route.transferId, detailRevision]);
  const track = async (action: "refresh" | "retry" | "original") => {
    if (!route.transferId || !canPublish) return;
    const requestContext = context.current;
    setBusy(true);
    setDetailError("");
    try {
      let value: OutgoingTransfer;
      if (action === "original") {
        if (!notFound || !original || pendingTransfers.get(original.key) !== original.body) throw new Error("原请求已更新，请重新查询原传输。");
        setNotFound(false);
        value = await api<OutgoingTransfer>("/environment-releases", { method: "POST", bodyText: original.body });
      } else {
        value = await api<OutgoingTransfer>(`/environment-releases/${encodeURIComponent(route.transferId)}`);
        if (context.current !== requestContext) return;
        if (action === "refresh" || ["READY", "UNKNOWN"].includes(value.deliveryState))
          value = await api<OutgoingTransfer>(`/environment-releases/${encodeURIComponent(route.transferId)}/${action}`, { method: "POST" });
      }
      if (["ACCEPTED", "REJECTED"].includes(value.deliveryState) && original && pendingTransfers.get(original.key) === original.body) pendingTransfers.delete(original.key);
      if (context.current === requestContext) {
        setDetail(value);
        setNotFound(false);
        setRevision((current) => current + 1);
      }
    } catch (error) {
      if (context.current === requestContext) setDetailError((error as Error).message);
    } finally {
      if (context.current === requestContext) setBusy(false);
    }
  };
  const openTransfer = (transferId: string | null) => navigation.navigate({ ...route, transferId });
  const targetOf = (id: string) => targets?.find((target) => target.id === id);

  if (newOpen)
    return (
      <section className="op-list-page" aria-labelledby="transfer-new-title">
        <PageHeader
          title={<span id="transfer-new-title">发布到其他环境</span>}
          secondaryActions={
            <>
              {route.apiId && <Button onClick={() => navigation.navigate({ ...route, page: "catalog", step: "pub", releaseId: null, transferId: null })}>返回 API 发布</Button>}
              <Button onClick={() => openTransfer(null)}>返回发布记录</Button>
            </>
          }
        />
        <div className="op-list-surface op-transfer-workspace">
          <EnvironmentReleasePanel api={api} pendingTransfers={pendingTransfers} canPublish={canPublish} initialReleaseId={route.releaseId ?? undefined} onStateChange={setOperation} />
        </div>
      </section>
    );

  const chips: FilterChip[] = list.filters.query ? [{ key: "query", text: `关键词：${list.filters.query}`, label: `关键词：${list.filters.query}`, onRemove: () => list.setFilter("query", "") }] : [];
  const columns: DataTableColumn<TransferSummary>[] = [
    {
      key: "api",
      title: "API",
      hideable: false,
      render: (item) => (
        <div className="op-cell-main">
          <button type="button" className="op-cell-main__title is-link" onClick={() => openTransfer(item.id)}>
            {item.service}.{item.method}
          </button>
          <span className="op-cell-sub">
            外部 {item.version} · {publicationTime(item.createdAt)}
          </span>
        </div>
      ),
    },
    {
      key: "target",
      title: "来源 → 目标",
      width: 170,
      render: (item) => (
        <div className="op-cell-main">
          <span>{targetOf(item.targetId)?.name ?? item.targetId}</span>
          <span className="op-cell-sub">
            {item.sourceEnvironment || "来源未知"} → {item.targetId}
          </span>
        </div>
      ),
    },
    {
      key: "delivery",
      title: (
        <span className="op-transfer__label">
          发送 / 接收<FieldHelp label="发送 / 接收">{transferHelp.send[1]}</FieldHelp>
        </span>
      ),
      label: "发送 / 接收",
      width: 150,
      render: (item) => <StatusBadge tone={deliveryTone[item.deliveryState]}>{transferProgress(item, targetOf(item.targetId)).delivery}</StatusBadge>,
    },
    { key: "review", title: "目标审核", width: 130, render: (item) => transferProgress(item, targetOf(item.targetId)).review },
    { key: "config", title: "目标配置", width: 140, render: (item) => transferProgress(item, targetOf(item.targetId)).config },
    {
      key: "access",
      title: "目标开关",
      width: 110,
      render: (item) => {
        const progress = transferProgress(item, targetOf(item.targetId));
        return <StatusBadge tone={accessTone(progress.receipt?.enabled)}>{progress.access}</StatusBadge>;
      },
    },
    { key: "nodes", title: "节点观测", width: 200, render: (item) => <span className="op-cell-sub">{transferProgress(item, targetOf(item.targetId)).observation}</span> },
    {
      key: "actions",
      title: "操作",
      width: 96,
      hideable: false,
      render: (item) => (
        <Button type="link" size="small" onClick={() => openTransfer(item.id)}>
          查看进度
        </Button>
      ),
    },
  ];
  const detailTarget = detail ? targetOf(detail.request.targetEnvironment) : undefined;
  const noTargets = targets?.length === 0;
  return (
    <section className="op-list-page" aria-labelledby="transfer-list-title">
      <PageHeader
        title={<span id="transfer-list-title">审核中心</span>}
        count={history.data?.total}
        meta={
          <Segmented
            aria-label="审核中心视图"
            value="transfers"
            options={[
              { value: "publications", label: "发布审核" },
              { value: "transfers", label: "跨环境发布" },
            ]}
            onChange={() => navigation.navigate({ ...route, page: "publications", query: "", pageNo: 1, releaseId: null, transferId: null, managementFilters: undefined })}
          />
        }
        secondaryActions={
          <Tooltip title="刷新">
            <Button icon={<ReloadOutlined />} aria-label="刷新跨环境发布记录" onClick={() => setRevision((value) => value + 1)} />
          </Tooltip>
        }
        primaryAction={
          canPublish && (
            <DisabledReason reason={noTargets ? "尚未配置目标环境，请联系平台维护者" : !targets ? "正在读取目标环境" : undefined}>
              <Button type="primary" disabled={!targets?.length} onClick={() => navigation.navigate({ ...route, transferId: "new", releaseId: null })}>
                发布到其他环境…
              </Button>
            </DisabledReason>
          )
        }
      />
      <div className="op-transfer-notices">
        {noTargets && <Alert type="info" showIcon role="status" title="尚未配置目标环境，请联系平台维护者配置后发送。现有记录仍可查阅。" />}
        {targetError && (
          <Alert
            type="error"
            showIcon
            title={`目标环境读取失败：${targetError}`}
            action={
              <Button size="small" onClick={() => setRevision((value) => value + 1)}>
                重新加载
              </Button>
            }
          />
        )}
        {pending.length > 0 && (
          <Alert
            type="warning"
            showIcon
            role="status"
            title="尚待确认的原申请"
            description={
              <ul className="op-transfer__pending">
                {pending.map((item) => (
                  <li key={item.transferId}>
                    <IdText value={item.transferId} label="原传输编号" maxChars={40} />
                    <span className="op-muted">→ {targetOf(item.targetId)?.name ?? item.targetId}</span>
                    <Button size="small" onClick={() => openTransfer(item.transferId)}>
                      查询原传输
                    </Button>
                  </li>
                ))}
              </ul>
            }
          />
        )}
      </div>
      <div className="op-list-surface">
        <FilterBar
          search={<TransferSearch value={list.filters.query} onChange={(text) => text !== list.filters.query && list.setFilter("query", text)} />}
          quick={<FieldHelp label="跨环境发布">{transferHelp.purpose[1]}</FieldHelp>}
          chips={chips}
          onClearAll={() => list.clear()}
        />
        <DataTable<TransferSummary>
          caption="跨环境发布记录"
          rowKey={(item) => item.id}
          data={history.error ? [] : (history.data?.items ?? [])}
          loading={history.loading}
          summary={history.data ? (chips.length ? `筛选出 ${history.data.total} 条` : `共 ${history.data.total} 条发出记录`) : undefined}
          pagination={history.data ? { page: list.page, pageSize: list.pageSize, total: history.data.total, onChange: (page, size) => (size !== list.pageSize ? list.setPageSize(size) : list.setPage(page)) } : undefined}
          columns={columns}
          empty={
            history.error ? (
              <EmptyState kind="error" title="跨环境发布记录加载失败" description={history.error} action={<Button onClick={history.reload}>重新加载</Button>} />
            ) : chips.length ? (
              <EmptyState kind="noResult" title="没有匹配的跨环境发布记录" action={<Button onClick={() => list.clear()}>清除筛选</Button>} />
            ) : (
              <EmptyState title="暂无跨环境发布记录" description="在 API 发布页的“⋯”中把当前生效版本发布到其他环境后，记录会出现在这里。" />
            )
          }
        />
      </div>
      <EntityDrawer
        open={!!route.transferId}
        width="lg"
        title={detail?.request.definition?.name ?? "跨环境发布进度"}
        subtitle={detail && `${detail.request.sourceEnvironment} → ${detailTarget?.name ?? detail.request.targetEnvironment}`}
        status={detail && <StatusBadge tone={deliveryTone[detail.deliveryState]}>{transferProgress({ ...detail, sourceEnvironment: detail.request.sourceEnvironment, targetId: detail.request.targetEnvironment }, detailTarget).delivery}</StatusBadge>}
        actions={detail && <TransferActions transfer={detail} busy={busy} canOperate={canPublish} onRefresh={() => void track("refresh")} onRetry={() => void track("retry")} />}
        onClose={() => {
          // 刷新或重试在途时保持打开，结果回来后仍能看到。
          if (!busy) openTransfer(null);
        }}
        loading={busy && !detail && !detailError}
      >
        <div className="op-transfer-notices">
          {detailError && (
            <Alert
              type="error"
              showIcon
              title={detailError}
              action={
                <Button size="small" disabled={busy} onClick={() => setDetailRevision((value) => value + 1)}>
                  重新加载
                </Button>
              }
            />
          )}
          {notFound && original && (
            <Alert
              type="warning"
              showIcon
              role="status"
              title="尚未查到原申请，原正文仍保留。"
              action={
                canPublish && (
                  <Button size="small" disabled={busy} onClick={() => void track("original")}>
                    用原编号和正文重试
                  </Button>
                )
              }
            />
          )}
        </div>
        {detail && <TransferDetail transfer={detail} target={detailTarget} canOperate={canPublish} />}
      </EntityDrawer>
    </section>
  );
}
