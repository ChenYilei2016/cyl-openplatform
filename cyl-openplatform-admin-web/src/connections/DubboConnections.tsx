import { PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Collapse, Input, Pagination, Table, Tooltip } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoadFeedback, usePage } from "@cyl/open-platform-web-shared/components";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { DisabledReason, EmptyState, EntityDrawer, FieldHelp, PageHeader, ReadonlyField, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, FilterBar, useDebouncedCallback, type DataTableColumn, type FilterChip } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import type { AdminApi } from "../access/api";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { useListQuery } from "../navigation/useListQuery";
import ConnectionDiagnostics, { discoveryNames, metadataNames, RegistryCheck } from "./ConnectionDiagnostics";
import ConnectionForm from "./ConnectionForm";
import type { Configuration, ConnectionConfig, ConnectionDetail, ConnectionHeader, ConnectionRevision, ConnectionSummary, Diagnostics, ReferenceUsage } from "./types";
import "./connections-workspace.css";

const base = "/dubbo-connections";
const referenceNames: Record<string, string> = { DRAFT: "API 草稿", LIVE: "当前生效", PENDING: "待审核" };
const noPermission = "需要“连接管理”权限";
const revisionText = (value: number | null | undefined) => (value == null ? "尚未启用" : `r${stringifyJson(value)}`);
const accessText = (item: ConnectionSummary) =>
  item.metadataType == null ? "配置修订不可用" : item.metadataType === "REDIS" ? "Nacos + Redis 元数据" : item.metadataType === "NACOS" ? "Nacos 注册与元数据" : "Nacos 注册中心";

function ConnectionState({ item }: { item: Pick<ConnectionSummary, "enabled" | "activeRevision"> & { metadataType?: ConnectionSummary["metadataType"] } }) {
  if (!item.enabled) return <StatusBadge tone="error">整体停用</StatusBadge>;
  if (item.metadataType === null) return <StatusBadge tone="warning">配置修订不可用</StatusBadge>;
  if (item.activeRevision == null) return <StatusBadge tone="warning">草稿</StatusBadge>;
  return <StatusBadge tone="success">可选择</StatusBadge>;
}

/** 连接名称搜索：停止输入 300ms 后生效，回车立即生效。 */
function NameSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  const debounced = useDebouncedCallback(onChange);
  useEffect(() => setText(value), [value]);
  return (
    <Input
      allowClear
      aria-label="搜索连接名称"
      prefix={<SearchOutlined aria-hidden />}
      placeholder="搜索连接名称"
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

/**
 * Dubbo 服务连接（/connections）：列表显示最近检查结果；点击在抽屉中查看、编辑（99 精简表单）、检查注册中心与启停。
 * 地址 `connection=<id|new>&view=detail|edit|copy` 可深链，API 配置页“管理连接 ↗”据此打开对应连接。
 */
export default function DubboConnections({ api, canManage }: { api: AdminApi; canManage: boolean }) {
  const navigation = useAdminNavigation();
  const route = navigation.route;
  const query = useListQuery({ namespace: "connections", defaults: { query: "" } });
  const [listRevision, setListRevision] = useState(0);
  const list = useReadPage<ConnectionSummary>(
    api,
    `${base}${canManage ? "" : "/options"}?${new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), query: query.filters.query })}`,
    listRevision,
    true,
    { keepPrevious: true },
  );
  const rows = list.error ? [] : (list.data?.items ?? []);
  const [reload, setReload] = useState(0);
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [configurationError, setConfigurationError] = useState("");
  const [detail, setDetail] = useState<ConnectionDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<"activate" | "status" | null>(null);
  const [impactReady, setImpactReady] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const [safeHeader, setSafeHeader] = useState<ConnectionHeader | null>(null);
  const selected = route.connectionId ?? null;
  const editor = route.connectionView === "edit" || route.connectionView === "copy";

  // 旧地址 `#/connections?query=` 的搜索词并入列表条件。
  useEffect(() => {
    if (route.query && !query.filters.query) query.setFilters({ query: route.query });
  }, []);
  useEffect(() => {
    if (!canManage) return;
    const abort = new AbortController();
    setConfigurationError("");
    void api<Configuration>(`${base}/configuration`, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setConfiguration(value);
      })
      .catch((error) => {
        if (!abort.signal.aborted) setConfigurationError(error.message);
      });
    return () => abort.abort();
  }, [api, canManage, reload]);
  useEffect(() => {
    activeRequest.current?.abort();
    setBusy(false);
    setConfirmation(null);
    setDiagnostics(null);
    setDetailError("");
    setNotice("");
    if (!selected || selected === "new") {
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    const read = canManage
      ? api<ConnectionDetail>(`${base}/${encodeURIComponent(selected)}`, { signal: abort.signal })
      : api<ConnectionHeader>(`${base}/${encodeURIComponent(selected)}/summary`, { signal: abort.signal });
    void read
      .then((value) => {
        if (abort.signal.aborted) return;
        if ("connection" in value) setDetail(value);
        else setSafeHeader(value);
      })
      .catch((error) => {
        if (!abort.signal.aborted) setDetailError(error.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [api, selected, canManage, reload]);
  useEffect(() => () => activeRequest.current?.abort(), []);
  const close = () => navigation.navigate({ ...route, connectionId: null, connectionView: "detail", connectionRevision: undefined });
  const open = (id: string, view: "detail" | "edit" | "copy" = "detail") => {
    if (id !== selected) setDetail(null);
    navigation.navigate({ ...route, page: "connections", connectionId: id, connectionView: view, connectionRevision: undefined });
  };
  const saved = useCallback((value: ConnectionDetail) => {
    setDetail(value);
    setListRevision((current) => current + 1);
    setNotice("连接草稿已保存。核对影响后启用修订，API 编辑者才能选择；保存不代表连通检查通过。");
  }, []);
  const mutate = async () => {
    if (!canManage) {
      setDetailError("当前已无连接管理权限，不能修改；输入已保留。");
      return;
    }
    if (!detail || detail.connection.id !== selected || !confirmation || busy) return;
    const abort = new AbortController();
    activeRequest.current = abort;
    setBusy(true);
    setDetailError("");
    const action = confirmation;
    try {
      const result = await api<ConnectionDetail>(`${base}/${encodeURIComponent(detail.connection.id)}/${action === "activate" ? "activate" : "status"}`, {
        method: action === "activate" ? "POST" : "PUT",
        signal: abort.signal,
        body:
          action === "activate"
            ? { expectedStateVersion: detail.connection.stateVersion, revision: detail.draft.revision }
            : { expectedStateVersion: detail.connection.stateVersion, enabled: !detail.connection.enabled },
      });
      if (abort.signal.aborted) return;
      setDetail(result);
      setConfirmation(null);
      setDiagnostics(null);
      setListRevision((value) => value + 1);
      setNotice(
        action === "activate"
          ? `修订已启用，连接整体${result.connection.enabled ? "可用" : "仍停用"}。已有 API 保持原固定修订。`
          : result.connection.enabled
            ? "连接已恢复可用，已有 API 保持原修订。"
            : "连接已停用，引用所有历史修订的调用都会被阻断。",
      );
    } catch (error) {
      if (!abort.signal.aborted) setDetailError((error as Error).message);
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  const diagnose = async () => {
    if (!canManage) {
      setDetailError("当前已无连接管理权限，不能执行诊断。");
      return;
    }
    if (!detail || detail.connection.id !== selected || busy) return;
    const abort = new AbortController();
    activeRequest.current = abort;
    setBusy(true);
    setDetailError("");
    setDiagnostics(null);
    try {
      const value = await api<Diagnostics>(`${base}/${encodeURIComponent(detail.connection.id)}/diagnostics`, {
        method: "POST",
        body: { revision: detail.draft.revision },
        signal: abort.signal,
      });
      if (!abort.signal.aborted) {
        setDiagnostics(value);
        setListRevision((current) => current + 1);
      }
    } catch (error) {
      if (!abort.signal.aborted) setDetailError((error as Error).message);
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  const currentDetail = detail?.connection.id === selected ? detail : null;
  const header = currentDetail?.connection || (safeHeader?.id === selected ? safeHeader : null);
  const displayedRevision = currentDetail?.active || currentDetail?.draft;
  const sameRevision = currentDetail ? stringifyJson(currentDetail.connection.activeRevision) === stringifyJson(currentDetail.draft.revision) : false;
  const actionReason = !canManage ? noPermission : busy ? "正在处理上一个操作，请稍候" : undefined;
  const createReason = !canManage
    ? noPermission
    : configurationError
      ? `部署环境与凭据选项读取失败：${configurationError}`
      : !configuration
        ? "正在读取当前部署环境与可用凭据选项"
        : undefined;
  const drawerTitle = editor
    ? route.connectionView === "copy"
      ? "复制 Dubbo 服务连接"
      : selected === "new"
        ? "新增 Dubbo 服务连接"
        : "编辑连接草稿"
    : header?.name || "Dubbo 服务连接";

  const chips: FilterChip[] = query.filters.query
    ? [{ key: "query", text: `名称：${query.filters.query}`, label: `名称：${query.filters.query}`, onRemove: () => query.setFilter("query", "") }]
    : [];
  const columns: DataTableColumn<ConnectionSummary>[] = [
    {
      key: "name",
      title: "连接 / 环境",
      hideable: false,
      render: (item) => (
        <div className="op-cell-main">
          <button type="button" className="op-cell-main__title is-link" onClick={() => open(item.id)}>
            {item.name}
          </button>
          <span className="op-cell-sub op-code">{item.environmentId}</span>
        </div>
      ),
    },
    {
      key: "mode",
      title: "接入方式",
      width: "22%",
      render: (item) => (
        <div className="op-cell-main">
          <span>{accessText(item)}</span>
          <span className="op-cell-sub">
            {item.discoveryMode ? discoveryNames[item.discoveryMode] : "发现方式未读取"} · {item.providerMetadataMode ?? "—"}
          </span>
        </div>
      ),
    },
    {
      key: "revision",
      title: "修订 / 状态",
      width: 170,
      render: (item) => (
        <div className="op-cell-main">
          <ConnectionState item={item} />
          <span className="op-cell-sub">
            {item.activeRevision == null ? "尚未启用" : `已启用 r${stringifyJson(item.activeRevision)}`} · 草稿 r{stringifyJson(item.draftRevision)}
          </span>
        </div>
      ),
    },
    {
      key: "registryCheck",
      title: "最近检查（本实例）",
      width: "26%",
      render: (item) => <RegistryCheck check={item.registryCheck} revision={item.activeRevision ?? item.draftRevision} />,
    },
    {
      key: "actions",
      title: "操作",
      width: 120,
      hideable: false,
      render: (item) =>
        canManage ? (
          <span className="connection-row-actions">
            <Button type="link" size="small" onClick={() => open(item.id, "edit")}>
              编辑
            </Button>
            <Button type="link" size="small" onClick={() => open(item.id, "copy")}>
              复制
            </Button>
          </span>
        ) : (
          <Button type="link" size="small" onClick={() => open(item.id)}>
            查看摘要
          </Button>
        ),
    },
  ];

  const detailBody = (
    <div className="connection-drawer-body">
      {notice && <Alert type="success" showIcon role="status" title={notice} />}
      {currentDetail && displayedRevision && (
        <>
          <div className="connection-facts" aria-label="当前连接配置" role="group">
            <ReadonlyField label="环境" value={currentDetail.connection.environmentId} code />
            <ReadonlyField
              label="当前修订 / 整体状态"
              value={
                <span className="connection-inline">
                  {revisionText(currentDetail.connection.activeRevision)}
                  <ConnectionState item={currentDetail.connection} />
                </span>
              }
            />
            <ReadonlyField label="Nacos" value={displayedRevision.config.registry.address} code />
            <ReadonlyField label="Nacos 隔离" value={`${displayedRevision.config.registry.namespace || "默认 namespace"} / ${displayedRevision.config.registry.group}`} />
            <ReadonlyField label="发现方式" value={discoveryNames[displayedRevision.config.discoveryMode]} />
            <ReadonlyField label="提供方元数据模式" value={displayedRevision.config.providerMetadataMode} help="LOCAL / REMOTE 描述提供方实际模式，选择这里的值不会改变提供方。" />
            <ReadonlyField label="元数据中心" value={metadataNames[displayedRevision.config.metadata.type]} />
            <ReadonlyField label="最近检查（本实例）" value={<RegistryCheck check={currentDetail.connection.registryCheck} revision={currentDetail.draft.revision} />} />
          </div>
          <p className="op-muted connection-note">
            上方展示{currentDetail.active ? "当前已启用修订" : "尚未启用的草稿"} r{stringifyJson(displayedRevision.revision)}。
          </p>
          {!sameRevision && (
            <Alert type="info" showIcon title={`已保存草稿 r${stringifyJson(currentDetail.draft.revision)} 尚未启用，已有 API 不会自动切换连接修订。`} />
          )}
          {!confirmation && (
            <div className="connection-actions">
              <DisabledReason reason={actionReason}>
                <Button disabled={Boolean(actionReason)} onClick={() => void diagnose()}>
                  检查注册中心（已保存草稿）
                </Button>
              </DisabledReason>
              <DisabledReason reason={actionReason ?? (sameRevision ? "草稿与已启用修订相同，无需启用" : undefined)}>
                <Button
                  type="primary"
                  disabled={Boolean(actionReason) || sameRevision}
                  onClick={() => {
                    setImpactReady(false);
                    setConfirmation("activate");
                  }}
                >
                  核对影响并启用修订
                </Button>
              </DisabledReason>
              <DisabledReason reason={actionReason}>
                <Button
                  danger={currentDetail.connection.enabled}
                  disabled={Boolean(actionReason)}
                  onClick={() => {
                    setImpactReady(false);
                    setConfirmation("status");
                  }}
                >
                  {currentDetail.connection.enabled ? "停用连接" : "恢复连接可用"}
                </Button>
              </DisabledReason>
            </div>
          )}
          {confirmation && (
            <section className="connection-confirm" aria-label="连接影响确认">
              <h3>{confirmation === "activate" ? "核对影响并启用连接修订" : currentDetail.connection.enabled ? "停用 Dubbo 服务连接" : "恢复 Dubbo 服务连接"}</h3>
              <Alert
                type={confirmation === "status" && currentDetail.connection.enabled ? "warning" : "info"}
                showIcon
                title={
                  confirmation === "activate"
                    ? `将启用草稿 r${stringifyJson(currentDetail.draft.revision)}。已有 API 固定引用不自动升级；连接${currentDetail.connection.enabled ? "继续启用" : "仍保持整体停用"}。`
                    : currentDetail.connection.enabled
                      ? "停用会阻断引用此连接所有修订的调用，不只是隐藏下拉选项。"
                      : "恢复后解除所有修订的调用阻断；原有 API 仍使用其固定修订，客户授权不受此操作扩展。"
                }
              />
              {confirmation === "activate" && <ConnectionChanges detail={currentDetail} />}
              <ConnectionReferences api={api} id={currentDetail.connection.id} onReady={setImpactReady} />
              <div className="connection-actions">
                <Button disabled={busy} onClick={() => setConfirmation(null)}>
                  取消
                </Button>
                <DisabledReason reason={actionReason ?? (!impactReady ? "正在读取关联 API，读取完成后才能确认" : undefined)}>
                  <Button
                    type="primary"
                    danger={confirmation === "status" && currentDetail.connection.enabled}
                    disabled={Boolean(actionReason) || !impactReady}
                    onClick={() => void mutate()}
                  >
                    确认{confirmation === "activate" ? "启用修订" : currentDetail.connection.enabled ? "停用连接" : "恢复连接"}
                  </Button>
                </DisabledReason>
              </div>
            </section>
          )}
          {diagnostics && <ConnectionDiagnostics result={diagnostics} />}
        </>
      )}
      {!canManage && header && (
        <>
          <div className="connection-facts" role="group" aria-label="连接摘要">
            <ReadonlyField label="环境" value={header.environmentId} code />
            <ReadonlyField label="当前修订" value={revisionText(header.activeRevision)} />
            <ReadonlyField label="整体状态" value={<ConnectionState item={header} />} />
            <ReadonlyField label="最近检查（本实例）" value={<RegistryCheck check={header.registryCheck} revision={header.activeRevision} />} />
          </div>
          <Alert type="info" showIcon title="当前只有查看权限：可查看安全摘要；编辑、启用和检查需要“连接管理”权限。" />
        </>
      )}
      {(!canManage || currentDetail) && selected && <ConnectionHistory api={api} id={selected} canManage={canManage} />}
    </div>
  );

  return (
    <section className="op-list-page connection-page" aria-labelledby="connections-title">
      <PageHeader
        title={<span id="connections-title">Dubbo 服务连接</span>}
        count={list.data?.total}
        meta={
          <span className="connection-inline op-muted">
            当前环境 <span className="op-code">{configuration?.currentEnvironmentId || "当前部署环境"}</span>
            <FieldHelp label="使用">连接页只检查注册中心；业务签名由 API 手填或导入，运行元数据用于发现。保存草稿、启用可选修订和整体停用分别操作；不会自动改绑已有 API。</FieldHelp>
          </span>
        }
        secondaryActions={
          <Tooltip title="刷新列表">
            <Button icon={<ReloadOutlined />} aria-label="刷新连接列表" disabled={list.loading} onClick={list.reload} />
          </Tooltip>
        }
        primaryAction={
          <DisabledReason reason={createReason}>
            <Button type="primary" icon={<PlusOutlined />} disabled={Boolean(createReason)} onClick={() => open("new", "edit")}>
              新增连接
            </Button>
          </DisabledReason>
        }
      />
      {configurationError && (
        <Alert
          type="error"
          showIcon
          role="alert"
          title={configurationError}
          action={
            <Button size="small" onClick={() => setReload((value) => value + 1)}>
              重新加载配置选项
            </Button>
          }
        />
      )}
      <div className="op-list-surface">
        <FilterBar search={<NameSearch value={query.filters.query} onChange={(value) => query.setFilter("query", value)} />} chips={chips} onClearAll={() => query.clear()} />
        <DataTable<ConnectionSummary>
          caption="Dubbo 服务连接"
          rowKey={(item) => item.id}
          columns={columns}
          data={rows}
          loading={list.loading}
          settingsKey="dubbo-connections"
          onRowClick={(item) => open(item.id)}
          rowClassName={(item) => (item.id === selected ? "connection-row--selected" : "")}
          pagination={list.data ? { page: query.page, pageSize: query.pageSize, total: list.data.total, onChange: (page, size) => (size !== query.pageSize ? query.setPageSize(size) : query.setPage(page)) } : undefined}
          empty={
            list.error ? (
              <EmptyState kind="error" title="连接列表加载失败" description={list.error} action={<Button onClick={list.reload}>重新加载</Button>} />
            ) : chips.length ? (
              <EmptyState kind="noResult" title="没有符合条件的连接" action={<Button onClick={() => query.clear()}>清除筛选</Button>} />
            ) : (
              <EmptyState title="还没有 Dubbo 服务连接" description="登记注册中心连接后，API 编辑者才能选择 Dubbo 提供方。" />
            )
          }
        />
      </div>
      <EntityDrawer
        open={Boolean(selected)}
        width="lg"
        title={drawerTitle}
        status={!editor && header ? <ConnectionState item={header} /> : undefined}
        subtitle={!editor && header ? <span className="op-code">{header.environmentId}</span> : undefined}
        actions={
          !editor && currentDetail ? (
            <span className="connection-inline">
              <DisabledReason reason={actionReason}>
                <Button size="small" disabled={Boolean(actionReason)} onClick={() => open(currentDetail.connection.id, "copy")}>
                  复制为新连接
                </Button>
              </DisabledReason>
              <DisabledReason reason={actionReason}>
                <Button size="small" type="primary" disabled={Boolean(actionReason)} onClick={() => open(currentDetail.connection.id, "edit")}>
                  编辑草稿
                </Button>
              </DisabledReason>
            </span>
          ) : undefined
        }
        onClose={() => {
          if (!busy) close();
        }}
      >
        <section className="connection-drawer" aria-label={drawerTitle}>
          <LoadFeedback loading={loading} error={detailError} retry={() => setReload((value) => value + 1)} />
          {editor && !configuration && (
            <div className="connection-drawer-body">
              <LoadFeedback
                loading={canManage && !configurationError}
                error={canManage ? configurationError : "当前没有连接管理权限；可以返回查看安全连接摘要。"}
                retry={() => setReload((value) => value + 1)}
              />
              <p className="op-muted">连接字段需要当前部署环境及可用凭据选项。未取得选项前不能提交，请联系部署维护者核对。</p>
            </div>
          )}
          {editor && configuration && (selected === "new" || currentDetail) ? (
            <ConnectionForm
              key={`${selected}:${route.connectionView}`}
              api={api}
              configuration={configuration}
              detail={currentDetail}
              copy={route.connectionView === "copy"}
              canManage={canManage}
              onSaved={saved}
              onClose={currentDetail && route.connectionView === "edit" ? () => open(currentDetail.connection.id) : close}
            />
          ) : (
            !editor && detailBody
          )}
        </section>
      </EntityDrawer>
    </section>
  );
}

function ConnectionChanges({ detail }: { detail: ConnectionDetail }) {
  const fields: [string, (config: ConnectionConfig) => string][] = [
    ["Nacos 地址", (value) => value.registry.address],
    ["Namespace ID", (value) => value.registry.namespace || "默认 namespace"],
    ["注册 group", (value) => value.registry.group],
    ["Nacos 凭据引用", (value) => value.registry.credentialRef || "不使用认证"],
    ["元数据中心", (value) => metadataNames[value.metadata.type]],
    ["元数据地址", (value) => value.metadata.address || "未使用"],
    ["元数据 namespace", (value) => value.metadata.namespace || "未设置"],
    ["元数据 group", (value) => value.metadata.group || "未设置"],
    ["Redis database", (value) => (value.metadata.database == null ? "未使用" : String(value.metadata.database))],
    ["元数据凭据引用", (value) => value.metadata.credentialRef || "不使用认证"],
    ["服务发现方式", (value) => discoveryNames[value.discoveryMode]],
    ["提供方元数据模式", (value) => value.providerMetadataMode],
  ];
  const current = detail.active?.config;
  const changed = fields.filter(([, value]) => !current || value(current) !== value(detail.draft.config));
  if (!changed.length) return <p className="op-muted">连接配置与当前启用修订一致。</p>;
  return (
    <Table
      size="small"
      pagination={false}
      rowKey="name"
      dataSource={changed.map(([name, value]) => ({ name, before: current ? value(current) : "尚未启用", after: value(detail.draft.config) }))}
      columns={[
        { title: "变化字段", dataIndex: "name", width: 140 },
        { title: "当前配置", dataIndex: "before", render: (text: string) => <span className="connection-wrap">{text}</span> },
        { title: `候选 r${stringifyJson(detail.draft.revision)}`, dataIndex: "after", render: (text: string) => <span className="connection-wrap">{text}</span> },
      ]}
    />
  );
}

function ConnectionReferences({ api, id, onReady }: { api: AdminApi; id: string; onReady: (ready: boolean) => void }) {
  const [page, setPage] = useState(1);
  const list = usePage<ReferenceUsage>(api, `${base}/${encodeURIComponent(id)}/references?page=${page}&pageSize=20`);
  useEffect(() => onReady(Boolean(list.data) && !list.loading && !list.error), [list.data, list.loading, list.error, onReady]);
  return (
    <section className="connection-subsection">
      <h4>关联 API 与固定修订</h4>
      <LoadFeedback loading={list.loading} error={list.error} retry={list.reload} />
      {list.data && (
        <>
          <Table<ReferenceUsage>
            size="small"
            pagination={false}
            rowKey={(item) => `${item.apiId}:${item.kind}:${stringifyJson(item.revision)}`}
            dataSource={list.data.items}
            locale={{ emptyText: "当前没有引用此连接的 API。" }}
            columns={[
              {
                title: "API",
                render: (_, item) => (
                  <div className="op-cell-main">
                    <span>{item.name}</span>
                    <span className="op-cell-sub op-code">{item.apiId}</span>
                  </div>
                ),
              },
              { title: "引用来源", width: 110, render: (_, item) => referenceNames[item.kind] || item.kind },
              { title: "固定连接修订", width: 120, render: (_, item) => `r${stringifyJson(item.revision)}` },
            ]}
          />
          {list.data.total > 20 && <Pagination simple size="small" current={page} pageSize={20} total={list.data.total} onChange={setPage} />}
        </>
      )}
    </section>
  );
}

function ConnectionHistory({ api, id, canManage }: { api: AdminApi; id: string; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapse
      ghost
      size="small"
      onChange={(keys) => setOpen(keys.includes("history"))}
      items={[{ key: "history", label: "历史修订", children: open && <RevisionList api={api} id={id} canManage={canManage} /> }]}
    />
  );
}

function RevisionList({ api, id, canManage }: { api: AdminApi; id: string; canManage: boolean }) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState<ConnectionRevision | null>(null);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const list = usePage<Omit<ConnectionRevision, "config">>(api, `${base}/${encodeURIComponent(id)}/revisions?page=${page}&pageSize=20`);
  const select = async (value: number) => {
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    setRevision(null);
    setError("");
    try {
      const result = await api<ConnectionRevision>(`${base}/${encodeURIComponent(id)}/revisions/${stringifyJson(value)}`, { signal: abort.signal });
      if (!abort.signal.aborted) setRevision(result);
    } catch (failure) {
      if (!abort.signal.aborted) setError((failure as Error).message);
    }
  };
  return (
    <>
      <LoadFeedback loading={list.loading} error={list.error} retry={list.reload} />
      {list.data && (
        <>
          <Table<Omit<ConnectionRevision, "config">>
            size="small"
            pagination={false}
            rowKey={(item) => stringifyJson(item.revision)}
            dataSource={list.data.items}
            columns={[
              {
                title: "修订",
                width: 120,
                render: (_, item) =>
                  canManage ? (
                    <Button type="link" size="small" onClick={() => void select(item.revision)}>
                      r{stringifyJson(item.revision)}
                    </Button>
                  ) : (
                    `r${stringifyJson(item.revision)}`
                  ),
              },
              { title: "创建时间", render: (_, item) => item.createdAt },
            ]}
          />
          {list.data.total > 20 && <Pagination simple size="small" current={page} pageSize={20} total={list.data.total} onChange={setPage} />}
        </>
      )}
      {error && <Alert type="error" showIcon role="alert" title={error} />}
      {revision && (
        <>
          <h4>修订 r{stringifyJson(revision.revision)}（只读）</h4>
          <pre className="connection-code">{stringifyJson(revision.config, 2)}</pre>
        </>
      )}
    </>
  );
}
