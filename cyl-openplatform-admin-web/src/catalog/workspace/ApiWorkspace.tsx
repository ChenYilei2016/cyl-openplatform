import PortalVisibilitySwitch from "../PortalVisibilitySwitch";
import { ApiOutlined, EllipsisOutlined, ReloadOutlined, SendOutlined } from "@ant-design/icons";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { Alert, App, Button, Dropdown, Modal, Space, Tabs, Tooltip } from "antd";
import { useState, type ReactNode } from "react";
import type { AdminApi } from "../../access/api";
import type { DebugEditorActions } from "../../debug/types";
import { useAdminNavigation } from "../../navigation/AdminNavigation";
import type { ApiDefinition, ApiWorkspace as WorkspaceState } from "../CatalogPanel";
import ConfigPage from "./ConfigPage";
import { useApiDraft, type ApiDraft } from "./useApiDraft";
import { useWholeJsonEditor } from "./useWholeJsonEditor";
import "./workspace.css";

const tabs = [
  { key: "outer", label: "配置" },
  { key: "mcp", label: "MCP 配置（可选）" },
  { key: "test", label: "调试" },
  { key: "pub", label: "发布" },
  { key: "history", label: "版本与生命周期" },
];
const tabOf = (step: string) => (["mcp", "test", "pub", "history"].includes(step) ? step : "outer");

/** API 工作区：页头（名称、状态、主操作）+ 配置与操作页签；配置页常驻以保留未保存输入（111）。 */
export default function ApiWorkspace({
  api,
  definition,
  workspace,
  canManageConnections = false,
  refreshing = false,
  onRefresh,
  onSaved,
  onReload,
  exampleSource,
  onExampleHandled,
  pages,
  debug,
}: {
  api: AdminApi;
  definition: ApiDefinition;
  workspace: WorkspaceState | null;
  canManageConnections?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onSaved: (value: ApiDefinition) => void;
  onReload: () => void;
  exampleSource?: { apiId: string; data: unknown } | null;
  onExampleHandled?: () => void;
  /** 112b：发布、版本与生命周期页签的内容，与配置页共用同一份工作草稿。 */
  pages?: (draft: ApiDraft, tab: "pub" | "history") => ReactNode;
  /** 112：调试页使用新样式，渲染在旧样式作用域之外；同一 API 内切换页签时保持挂载。 */
  debug?: (actions: DebugEditorActions, active: boolean) => ReactNode;
}) {
  const navigation = useAdminNavigation();
  const route = navigation.route;
  const { message } = App.useApp();
  const draft = useApiDraft({ api, definition, onSaved, onReload, exampleSource, onExampleHandled });
  const tab = tabOf(route.step);
  /** 调试页首次打开后才挂载，之后保持挂载以保留身份与输入。 */
  const [debugVisited, setDebugVisited] = useState(tab === "test");
  if (tab === "test" && !debugVisited) setDebugVisited(true);
  /** 调试页使用的编辑器动作：保存、读取响应规则、跳到目标配置等。 */
  const debugActions: DebugEditorActions = {
    dirty: draft.hasUnsavedChanges,
    save: async () => (!draft.hasUnsavedChanges() ? definition : (await draft.save()) ? draft.savedDefinition() : null),
    saveError: draft.saveError,
    setBusy: draft.setTesting,
    setGeneratorState: (state) => draft.editorState("debug", state),
    requestSchema: draft.parsedRequest ?? undefined,
    adapter: draft.adapter,
    responseSchemaText: draft.sections.responseSchema,
    changeAdapter: draft.setAdapter,
    changeResponseSchema: (text) => draft.change("responseSchema", text),
    configureTarget: () => draft.locate("/binding"),
    reload: draft.requestReload,
    repairResponse: (sample, structure) => {
      if (sample) draft.setResponseSample({ text: sample });
      draft.locate(structure ? "/responseSchema" : "/responseAdapter");
    },
    setResponseSample: (sample) => draft.setResponseSample(sample ? { text: sample } : undefined),
  };
  const wholeJson = useWholeJsonEditor(draft);
  const go = (step: string) => navigation.navigate({ ...route, step, releaseId: null });
  const exportConfig = async () => {
    try {
      const config = await api<unknown>(`/api-imports/exports/${encodeURIComponent(definition.id)}?revision=${stringifyJson(definition.draftRevision)}`);
      const url = URL.createObjectURL(new Blob([stringifyJson(config, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${definition.service}-${definition.method}.json`;
      link.click();
      URL.revokeObjectURL(url);
      message.success?.("已导出已保存修订的配置；敏感值已移除，重新导入时请核对内部绑定、默认值和示例。");
    } catch (failure) {
      draft.setError((failure as Error).message);
    }
  };
  // 维护声明在“版本与生命周期”页签编辑，其改动提示显示在该页签上。
  const lifecycleDirty = draft.changed.includes("lifecycle");
  const mcpDirty = draft.changed.includes("mcpTool");
  const configDirty = draft.changed.some(field => field !== "lifecycle" && field !== "mcpTool") || draft.unappliedEdits || draft.manualBindingPending;
  const serverAhead = workspace && !refreshing && stringifyJson(workspace.definition.draftRevision) !== stringifyJson(definition.draftRevision);
  return (
    <section className="op-api-workspace" aria-label="API 工作区">
      <header className="op-api-workspace__head">
        <div className="op-api-workspace__breadcrumb">
          <a
            href="#/apis"
            aria-label="返回 API 列表"
            onClick={(event) => {
              event.preventDefault();
              navigation.navigate({ ...route, apiId: null, step: "outer", releaseId: null });
            }}
          >
            API 列表
          </a>{" "}
          / {definition.name}
        </div>
        <div className="op-api-workspace__title-row">
          <div className="op-api-workspace__title">
            <h1>{draft.metadata.name.trim() || definition.name}</h1>
            <div className="op-api-workspace__badges" aria-label="发布状态">
              <StatusBadge tone="neutral">草稿 r{stringifyJson(definition.draftRevision)}</StatusBadge>
              {workspace &&
                (workspace.liveDraftRevision == null ? (
                  <StatusBadge tone="neutral">尚未发布</StatusBadge>
                ) : workspace.publication.enabled ? (
                  <StatusBadge tone="success">生效 r{stringifyJson(workspace.liveDraftRevision)}</StatusBadge>
                ) : (
                  <StatusBadge tone="warning">生效 r{stringifyJson(workspace.liveDraftRevision)} · 已停用</StatusBadge>
                ))}
              {workspace?.pendingDraftRevision != null && <StatusBadge tone="info">待审 r{stringifyJson(workspace.pendingDraftRevision)}</StatusBadge>}
              {draft.hasUnsavedChanges() && <StatusBadge tone="warning">有未保存修改</StatusBadge>}
              {serverAhead && <StatusBadge tone="warning">服务器草稿 r{stringifyJson(workspace!.definition.draftRevision)} · 本地输入保留</StatusBadge>}
              {onRefresh && (
                <Tooltip title="刷新状态">
                  <Button type="text" size="small" icon={<ReloadOutlined aria-hidden />} aria-label="刷新状态" loading={refreshing} onClick={onRefresh} />
                </Tooltip>
              )}
            </div>
          </div>
          <Space className="op-api-workspace__actions">
            <Button icon={<ApiOutlined aria-hidden />} onClick={() => go("test")} disabled={tab === "test"}>
              调试
            </Button>
            {/* 发布页底栏已有提交按钮，页头不再重复。 */}
            {tab !== "pub" && (
              <Button type="primary" icon={<SendOutlined aria-hidden />} onClick={() => go("pub")}>
                提交发布
              </Button>
            )}
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  { key: "json", label: "以 JSON 编辑整份配置" },
                  { key: "export", label: "导出已保存配置（脱敏）" },
                  { type: "divider" },
                  { key: "reload", label: "重新加载最新草稿", disabled: draft.busy },
                ],
                onClick: ({ key }) => {
                  if (key === "json") wholeJson.open();
                  else if (key === "export") void exportConfig();
                  else draft.requestReload();
                },
              }}
            >
              <Button icon={<EllipsisOutlined aria-hidden />} aria-label="更多操作" />
            </Dropdown>
          </Space>
        </div>
        <code className="op-api-workspace__identity">
          {definition.service}.{definition.method} · 外部版本 {definition.version}
        </code>
        <Space><span>门户展示</span><PortalVisibilitySwitch key={definition.id} api={api} apiId={definition.id} initial={workspace?.portalVisible ?? true} refreshing={refreshing} /></Space>
        <Tabs
          className="op-api-workspace__tabs"
          activeKey={tab}
          onTabClick={(key) => go(key)}
          items={tabs.map((item) => ({
            key: item.key,
            label:
              (item.key === "outer" && configDirty) || (item.key === "mcp" && mcpDirty) || (item.key === "history" && lifecycleDirty) ? (
                <span className="op-api-workspace__tab-dirty" aria-label={`${item.label}，有未保存修改`}>
                  {item.label}
                  <span className="op-config__dot" aria-hidden />
                </span>
              ) : (
                item.label
              ),
          }))}
        />
      </header>
      <ConfigPage draft={draft} workspace={workspace} canManageConnections={canManageConnections} active={tab === "outer" || tab === "mcp"} />
      {tab !== "outer" && tab !== "mcp" && draft.error && <Alert className="op-config__banner" type="error" showIcon title={draft.error} closable onClose={() => draft.setError("")} />}
      {debug && debugVisited && <div hidden={tab !== "test"}>{debug(debugActions, tab === "test")}</div>}
      {(tab === "pub" || tab === "history") && pages?.(draft, tab)}
      {wholeJson.drawer}
      <Modal
        open={draft.reloadAsked}
        title="放弃本地修改并重新加载？"
        okText="确认放弃并重新加载"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        onOk={draft.confirmReload}
        onCancel={draft.cancelReload}
      >
        将丢弃 {draft.changed.length + draft.pendingCount()} 处未保存修改{draft.unappliedEdits || draft.manualBindingPending || draft.pendingCount() ? "及未应用输入" : ""}，采用服务器最新草稿。
      </Modal>
    </section>
  );
}
