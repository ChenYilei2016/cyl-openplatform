import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Checkbox, Input, Modal, Tag } from "antd";
import type { AdminApi, Scope } from "../access/api";
import {
  LoadFeedback,
  Pagination,
  usePage,
} from "@cyl/open-platform-web-shared/components";
import { FieldHelp, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import CatalogList from "./CatalogList";
import ApiWorkspace from "./workspace/ApiWorkspace";
import CreateWorkspace from "./workspace/CreateWorkspace";
import { placeholderDefinition } from "./workspace/draftModel";
import ApiCopyDialog, { type ApiCopyDraft } from "./create/ApiCopyDialog";
import NewApiDialog from "./create/NewApiDialog";
import QuickCreate from "./create/QuickCreate";
import { isQuickSource, type CreateSource } from "./create/quickCreateModel";
import "./editors.css";
import DraftDebug from "../debug/DraftDebug";
import PublishPage from "../publication/PublishPage";
import VersionsPage from "./versions/VersionsPage";
import type { ApiDraft } from "./workspace/useApiDraft";
import ReleaseReview from "../publication/ReleaseReview";
import type { PublicationSubmission } from "../publication/types";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { readPendingImport } from "../importing/ApiImport";
import type {
  ApiDocument,
  SchemaNode,
} from "@cyl/open-platform-web-shared/documentation/types";
import type { ApiLifecycle } from "@cyl/open-platform-web-shared/lifecycle";

export interface ApiSummary {
  portalVisible?: boolean;
  id: string;
  service: string;
  version: string;
  method: string;
  name: string;
  category: string;
  owner: string;
  ownerName?: string;
  ownerProfileLinked?: boolean;
  ownerEmployeeNo?: string | null;
  ownerTenantId?: string | null;
  ownerTenantName?: string | null;
  internalClass?: string | null;
  internalMethod?: string | null;
  protocol: string;
  draftRevision: number;
  liveDraftRevision?: number | null;
  hasUnpublishedChanges?: boolean;
  enabled?: boolean;
  pendingReleaseId?: string | null;
  /** 当前草稿是否打开“可作为 MCP 工具”。 */
  mcpToolEnabled?: boolean;
}
export interface ApiDefinition extends Omit<ApiSummary, 'ownerName' | 'ownerProfileLinked' | 'ownerEmployeeNo' | 'ownerTenantId' | 'ownerTenantName' | 'internalClass' | 'internalMethod' | 'mcpToolEnabled' | 'portalVisible'> {
  description?: string | null;
  employeeRequired?: boolean | null;
  operationKind?: "QUERY" | "MUTATION";
  idempotencyField?: string | null;
  mcpTool?: { enabled: boolean; aiDescription?: string | null };
  lifecycle?: ApiLifecycle;
  scopeCodes: string[];
  requestSchema: SchemaNode;
  responseSchema: SchemaNode;
  responseAdapter?: import("./ResponseAdapterEditor").ResponseAdapter;
  errorDefinitions: unknown[];
  binding: unknown;
  mappings: unknown[];
}
export interface ApiWorkspace {
  portalVisible?: boolean;
  definition: ApiDefinition;
  publication: {
    apiId: string;
    stateVersion: number;
    enabled: boolean;
    liveReleaseId: string | null;
    pendingReleaseId: string | null;
  };
  liveDraftRevision: number | null;
  pendingDraftRevision: number | null;
}
export type DraftPreview = ApiDocument;

export default function CatalogPanel({
  api,
  permissions = [],
  operatorKey,
  pendingSubmissions: suppliedSubmissions,
  publicationNotes,
}: {
  api: AdminApi;
  permissions?: string[];
  operatorKey?: string;
  pendingSubmissions?: Map<string, PublicationSubmission>;
  publicationNotes?: Map<string, string>;
}) {
  let hasPendingImport = false;
  try { hasPendingImport = Boolean(readPendingImport(operatorKey)); } catch { /* 损坏的暂存由导入页报告，不阻断列表。 */ }
  const navigation = useAdminNavigation();
  const route = navigation.route;
  const selected = route.apiId;
  const step = route.step;
  const pendingSubmissions = useMemo(
    () => suppliedSubmissions ?? new Map<string, PublicationSubmission>(),
    [suppliedSubmissions],
  );
  const [publicationAction, setPublicationAction] = useState<{ apiId: string; action: "status" | "transfer" } | null>(null);
  const [copySource, setCopySource] = useState<ApiSummary | null>(null);
  const [copyDraft, setCopyDraft] = useState<ApiCopyDraft | null>(null);
  const copyDefinition = useMemo(() => copyDraft && placeholderDefinition(copyDraft.initialDefinition), [copyDraft]);
  useEffect(() => {
    if (selected !== "new") setCopyDraft(null);
  }, [selected]);
  const [definition, setDefinition] = useState<ApiDefinition | null>(null);
  const [workspace, setWorkspace] = useState<ApiWorkspace | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const refreshRequest = useRef<AbortController | null>(null);
  const workspaceContext = useRef({ api, selected });
  workspaceContext.current = { api, selected };
  useEffect(() => () => refreshRequest.current?.abort(), [api, selected]);
  const refreshWorkspace = async () => {
    if (
      !selected ||
      selected === "new" ||
      workspaceContext.current.api !== api ||
      workspaceContext.current.selected !== selected
    )
      return;
    refreshRequest.current?.abort();
    const controller = new AbortController();
    refreshRequest.current = controller;
    setRefreshing(true);
    setRefreshError("");
    try {
      const value = await api<ApiWorkspace>(
        `/apis/${encodeURIComponent(selected)}/workspace`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setWorkspace(value);
    } catch (failure) {
      if (!controller.signal.aborted)
        setRefreshError((failure as Error).message);
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
    }
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const debugInput = useRef({ apiId: "", text: "{}" });
  useEffect(() => {
    debugInput.current = { apiId: "", text: "{}" };
  }, [selected]);
  const [revision, setRevision] = useState(0);
  const [listRevision, setListRevision] = useState(0);
  const publicationChanged = () => {
    setRestoreMessage("");
    setListRevision((value) => value + 1);
    void refreshWorkspace();
  };
  const [restoreRevision, setRestoreRevision] = useState(0);
  const [restoreMessage, setRestoreMessage] = useState("");
  useEffect(() => setRestoreMessage(""), [step]);
  const releaseId = route.releaseId;
  const setReleaseId = (id: string | null) =>
    navigation.navigate({ ...route, releaseId: id });
  const [exampleSource, setExampleSource] = useState<{
    apiId: string;
    data: unknown;
  } | null>(null);
  useEffect(() => {
    refreshRequest.current?.abort();
    setDefinition(null);
    setWorkspace(null);
    setRefreshError("");
    setRefreshing(false);
    setRestoreMessage("");
    setExampleSource(null);
    setError("");
    if (!selected || selected === "new") {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void api<ApiWorkspace>(`/apis/${encodeURIComponent(selected)}/workspace`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) {
          setDefinition(value.definition);
          setWorkspace(value);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, selected, revision]);
  const select = (id: string, nextStep = "outer") => {
    navigation.navigate({
      ...route,
      page: "catalog",
      apiId: id,
      releaseId: null,
      step: nextStep,
    });
  };
  const source = route.source;
  const toList = () => navigation.navigate({ ...route, page: "catalog", apiId: null, step: "outer", releaseId: null, source: undefined });
  const chooseSource = (next: CreateSource) => {
    if (next === "openapi" || next === "json")
      navigation.navigate({ ...route, page: "imports", apiId: null, step: "outer", releaseId: null, source: next });
    else navigation.navigate({ ...route, page: "catalog", apiId: "new", step: "outer", releaseId: null, source: next });
  };
  /** 112b：发布、版本与生命周期页签；查看某次发布快照时，审核详情以抽屉叠在当前页签之上（116）。 */
  const pages = (draft: ApiDraft, tab: "pub" | "history") => (
    <>
      {releaseId && (
        <ReleaseReview
        publicationNotes={publicationNotes}
        api={api}
        releaseId={releaseId}
        canReview={permissions.includes("REVIEW_APIS")}
        onChanged={publicationChanged}
        onBack={() => setReleaseId(null)}
        backLabel={tab === "history" ? "返回版本与生命周期" : "返回发布"}
      />
      )}
      {tab === "pub" ? (
      <PublishPage
        key={draft.definition.id}
        api={api}
        definition={draft.definition}
        canPublish={permissions.includes("PUBLISH_APIS")}
        requestedAction={publicationAction?.apiId === draft.definition.id ? publicationAction.action : undefined}
        onActionHandled={() => setPublicationAction(null)}
        pendingSubmissions={pendingSubmissions}
        publicationNotes={publicationNotes}
        onChanged={publicationChanged}
        onReview={setReleaseId}
        onTransfer={(id) => navigation.navigate({ ...route, page: "transfers", transferId: "new", releaseId: id, query: "", pageNo: 1 })}
        unsavedNotice={
          draft.hasUnsavedChanges() && (
            <Alert
              type="warning"
              showIcon
              className="op-publish__notice"
              title={`配置有未保存的修改；发布只会提交已保存的 r${stringifyJson(draft.definition.draftRevision)}。`}
              action={
                <Button size="small" onClick={() => navigation.navigate({ ...route, step: "outer", releaseId: null })}>
                  前往保存
                </Button>
              }
            />
          )
        }
      />
    ) : (
      <VersionsPage
        key={draft.definition.id}
        draft={draft}
        workspace={workspace}
        canManage={permissions.includes("MANAGE_APIS")}
        canPublish={permissions.includes("PUBLISH_APIS")}
        canReadAffected={permissions.includes("MANAGE_APPLICATIONS")}
        pendingSubmissions={pendingSubmissions}
        publicationNotes={publicationNotes}
        onChanged={publicationChanged}
        onReview={setReleaseId}
        onGoPublish={() => navigation.navigate({ ...route, step: "pub", releaseId: null })}
        onOpenTransfer={(transferId) => navigation.navigate({ ...route, page: "transfers", transferId, releaseId: null, query: "", pageNo: 1 })}
        onRestored={(value, changed) => {
          setDefinition(value);
          void refreshWorkspace();
          setExampleSource(null);
          setRestoreRevision((current) => current + 1);
          setListRevision((current) => current + 1);
          setRestoreMessage(
            changed
              ? `已恢复为新草稿 r${stringifyJson(value.draftRevision)}，生效版本未改变。`
              : `内容相同，未增加草稿修订，仍为 r${stringifyJson(value.draftRevision)}。`,
          );
        }}
      />
      )}
    </>
  );
  // 110：/apis/new 无来源（或复制但尚未选定来源）时，在列表之上打开来源面板。
  const choosing = selected === "new" && !isQuickSource(source) && !(source === "copy" && copyDraft);
  if (selected === "new" && isQuickSource(source))
    return (
      <QuickCreate
        key={source}
        api={api}
        source={source}
        canManageConnections={permissions.includes("MANAGE_CONNECTIONS")}
        onCancel={toList}
        onChangeSource={() => navigation.navigate({ ...route, page: "catalog", apiId: "new", step: "outer", source: undefined })}
        onCreated={(saved) => {
          setListRevision((value) => value + 1);
          navigation.navigate({ ...route, page: "catalog", apiId: saved.id, step: "outer", releaseId: null, source: undefined }, true);
        }}
      />
    );
  // 116：复制新 API 使用与已有 API 相同的配置页，保存时以幂等创建键创建。
  if (selected === "new" && !choosing && copyDraft)
    return (
      <CreateWorkspace
        api={api}
        definition={copyDefinition!}
        creation={{ kind: "copy", copy: copyDraft }}
        canManageConnections={permissions.includes("MANAGE_CONNECTIONS")}
        breadcrumb={
          <>
            <a href="#/apis" onClick={(event) => { event.preventDefault(); toList(); }}>
              API 列表
            </a>{" "}
            / 复制新 API
          </>
        }
        context={(leaving) => <CopySourceNote copy={copyDraft} leaving={leaving} onRechoose={toList} />}
        onCreated={(saved) => {
          setListRevision((value) => value + 1);
          navigation.navigate({ ...route, page: "catalog", apiId: saved.id, step: "outer", releaseId: null, source: undefined }, true);
        }}
      />
    );
  if (selected && selected !== "new")
    return (
      <section className="api-workspace">
        <Suspense fallback={<p role="status">正在加载 API 工作区…</p>}>
          <LoadFeedback
            loading={loading}
            error={error}
            retry={() => setRevision((value) => value + 1)}
          />
          <LoadFeedback
            loading={false}
            error={refreshError}
            retry={() => void refreshWorkspace()}
          />
          {definition && (
            <>
              {restoreMessage && (
                <Alert className="op-config__banner" type="success" showIcon role="status" title={restoreMessage} />
              )}
              <ApiWorkspace
                    key={`${definition.id}:${revision}:${restoreRevision}`}
                    api={api}
                    definition={definition}
                    workspace={workspace}
                    canManageConnections={permissions.includes("MANAGE_CONNECTIONS")}
                    refreshing={refreshing}
                    onRefresh={() => void refreshWorkspace()}
                    exampleSource={exampleSource}
                    onExampleHandled={() => setExampleSource(null)}
                    onReload={() => setRevision((value) => value + 1)}
                    onSaved={(value) => {
                      setDefinition(value);
                      void refreshWorkspace();
                      setExampleSource(null);
                    }}
                    debug={(actions, active) => (
                      <DraftDebug
                        key={definition.id}
                        api={api}
                        isActive={active}
                        definition={definition}
                        editor={actions}
                        initialInput={debugInput.current.apiId === definition.id ? debugInput.current.text : "{}"}
                        onInputChange={(text) => {
                          debugInput.current = { apiId: definition.id, text };
                        }}
                        onUseExample={(data) => {
                          setExampleSource({ apiId: definition.id, data });
                          select(definition.id, "doc");
                        }}
                      />
                    )}
                    pages={pages}
                  />
            </>
          )}
        </Suspense>
      </section>
    );
  return (
    <>
      {hasPendingImport && (
        <Alert
          className="op-config__banner"
          type="warning"
          showIcon
          role="status"
          title="有一份导入结果尚待核对。"
          action={<Button size="small" onClick={() => navigation.navigate({ ...route, page: "imports", apiId: null, step: "outer" })}>核对原导入</Button>}
        />
      )}
      <CatalogList
        key={listRevision}
        api={api}
        accessKey={permissions.join(",")}
        onSelect={select}
        canPublish={permissions.includes("PUBLISH_APIS")}
        onPublicationAction={(apiId, action) => { setPublicationAction({ apiId, action }); select(apiId, "pub"); }}
        onCopy={setCopySource}
      />
      <NewApiDialog
        key={source === "copy" ? "copy" : "sources"}
        api={api}
        open={choosing && !copySource}
        initialStep={source === "copy" ? "copy" : "sources"}
        onClose={toList}
        onChoose={chooseSource}
        onCopy={setCopySource}
      />
      {copySource && (
        <ApiCopyDialog
          api={api}
          source={copySource}
          onClose={() => setCopySource(null)}
          onConfirm={(draft) => {
            setCopyDraft(draft);
            setCopySource(null);
            navigation.navigate({
              ...route,
              page: "catalog",
              apiId: "new",
              step: "outer",
              source: "copy",
            });
          }}
        />
      )}
    </>
  );
}

/** 复制新 API 的来源说明：固定的来源快照、来源提醒，以及重新选择来源的入口。 */
function CopySourceNote({ copy, leaving, onRechoose }: { copy: ApiCopyDraft; leaving: boolean; onRechoose: () => void }) {
  return (
    <Alert
      type="info"
      showIcon
      title={`从固定${copy.sourceKind === "DRAFT" ? "草稿" : "生效快照"} r${stringifyJson(copy.sourceRevision)} 预填，尚未创建；保存后创建新 API。`}
      description={
        <>
          <p className="op-create__hint">若来源已变化，请返回列表重新选择来源；返回前会提示处理当前未保存输入。</p>
          {copy.warnings.length > 0 && (
            <ul className="op-create__list">
              {copy.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
        </>
      }
      action={
        <Button size="small" disabled={leaving} onClick={onRechoose}>
          返回列表重新选择复制来源
        </Button>
      }
    />
  );
}

export function CatalogScopes({
  api,
  codes,
  onChange,
  disabled = false,
}: {
  api: AdminApi;
  codes: string[];
  onChange: (codes: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [selection, setSelection] = useState(codes);
  const [known, setKnown] = useState<Record<string, Scope>>({});
  const scopes = usePage<Scope>(
    api,
    `/apis/scopes?page=${page}&pageSize=20&query=${encodeURIComponent(filter)}`,
  );
  useEffect(() => {
    if (scopes.data)
      setKnown((current) => ({
        ...current,
        ...Object.fromEntries(
          scopes.data!.items.map((scope) => [scope.code, scope]),
        ),
      }));
  }, [scopes.data]);
  const toggle = (code: string, checked: boolean) =>
    setSelection((current) => (checked ? [...current, code] : current.filter((item) => item !== code)));
  return (
    <div className="op-scope-field">
      <span className="op-scope-field__label">
        调用权限组
        <FieldHelp label="调用权限组">决定哪些调用方可以获准访问此接口；不清楚时联系平台维护者。展示分类不能替代权限组。</FieldHelp>
      </span>
      <div className="op-scope-field__selection">
        <Button
          disabled={disabled}
          onClick={() => {
            setSelection(codes);
            setOpen(true);
          }}
        >
          选择权限组…
        </Button>
        {codes.length ? (
          codes.map((code) => (
            <Tag key={code} title={code}>
              {known[code]?.name ?? code}
            </Tag>
          ))
        ) : (
          <span className="op-muted">尚未选择</span>
        )}
      </div>
      <Modal
        open={open}
        title="选择调用权限组"
        okText="确认选择"
        cancelText="取消"
        okButtonProps={{ disabled: selection.some((code) => known[code]?.enabled === false) }}
        onOk={() => {
          onChange(selection);
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      >
        <div className="op-scope-picker">
          <Input.Search
            aria-label="搜索权限组"
            placeholder="搜索名称或代码"
            maxLength={100}
            value={query}
            enterButton="搜索"
            onChange={(event) => setQuery(event.target.value)}
            onSearch={(value) => {
              setFilter(value.trim());
              setPage(1);
            }}
          />
          <LoadFeedback {...scopes} retry={scopes.reload} />
          <ul className="op-scope-picker__list">
            {scopes.data?.items.map((scope) => (
              <li key={scope.id} className="op-scope-picker__item">
                <Checkbox
                  checked={selection.includes(scope.code)}
                  disabled={!scope.enabled && !selection.includes(scope.code)}
                  onChange={(event) => toggle(scope.code, event.target.checked)}
                >
                  <span className="op-scope-picker__name">{scope.name}</span>
                  <code className="op-scope-picker__code">{scope.code}</code>
                </Checkbox>
                {!scope.enabled && <StatusBadge tone="error">不可选，请移除既有选择</StatusBadge>}
              </li>
            ))}
            {selection
              .filter((code) => !scopes.data?.items.some((scope) => scope.code === code))
              .map((code) => (
                <li key={code} className="op-scope-picker__item">
                  <Checkbox checked onChange={() => toggle(code, false)}>
                    <span className="op-scope-picker__name">{known[code]?.name ?? code}</span>
                    <span className="op-muted">已选，可取消</span>
                  </Checkbox>
                </li>
              ))}
          </ul>
          {scopes.data && (
            <Pagination
              page={page}
              total={scopes.data.total}
              onChange={setPage}
              label="API 权限组分页"
            />
          )}
          <p className="op-muted">停用权限组不可新增选择；保存时会再次校验权限组有效性。</p>
        </div>
      </Modal>
    </div>
  );
}
