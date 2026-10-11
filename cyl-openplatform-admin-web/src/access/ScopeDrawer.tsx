import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import { ConfirmAction, EmptyState, EntityDrawer, FieldLabel, ReadonlyField, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, useDebouncedCallback, type DataTableColumn } from "@cyl/open-platform-web-shared/ui/list";
import { useRead, useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Button, Input, Select, Switch, Tooltip } from "antd";
import { useEffect, useRef, useState } from "react";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { AdminApiError, type AdminApi, type Page, type Scope, type ScopeApi } from "./api";
import { defaultGrantText, enabledText, publicAccessText, scopeApiState, scopeHelp } from "./scopeModel";
import ScopeTenantGrants from "./ScopeTenantGrants";

type Tab = "settings" | "apis" | "tenants";
interface Values {
  code: string;
  name: string;
  enabled: boolean;
  defaultForNewApplication: boolean;
  publicAccess: boolean;
}
const blank: Values = { code: "", name: "", enabled: true, defaultForNewApplication: false, publicAccess: false };
const valuesOf = (scope: Scope): Values => ({
  code: scope.code,
  name: scope.name,
  enabled: scope.enabled,
  defaultForNewApplication: scope.defaultForNewApplication,
  publicAccess: scope.publicAccess,
});
const conflict = (error: unknown) => error instanceof AdminApiError && (error.code === 409 || Math.floor(error.code / 100000) === 409);

/** 权限组抽屉：设置页编辑名称与三个开关；API 页列出草稿或已发布版本携带该组的 API，并通过 API 草稿增删；已开通租户页维护租户权限。 */
export default function ScopeDrawer({
  api,
  scopeId,
  initial,
  canEditApis,
  created = false,
  onClose,
  onCreated,
  onChanged,
}: {
  api: AdminApi;
  scopeId: string;
  initial: Scope | null;
  canEditApis: boolean;
  /** 刚创建：提示下一步去 API 页加入 API。 */
  created?: boolean;
  onClose: () => void;
  onCreated: (scope: Scope) => void;
  onChanged: () => void;
}) {
  const navigation = useAdminNavigation();
  const creating = scopeId === "new";
  const [revision, setRevision] = useState(0);
  const detail = useRead<Scope>(api, `/scopes/${encodeURIComponent(scopeId)}`, revision, !creating, { keepPrevious: true });
  const scope = creating ? null : (detail.data ?? initial);
  const tab: Tab = creating ? "settings" : navigation.route.scopeTab ?? "settings";
  const setTab = (scopeTab: Tab) => navigation.navigate({ ...navigation.route, scopeTab });
  const [values, setValues] = useState<Values>(scope ? valuesOf(scope) : blank);
  const [baseline, setBaseline] = useState<Values>(scope ? valuesOf(scope) : blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(created ? "权限组已创建。可在“API”页加入 API，发布后持有此组的凭据即可调用。" : "");
  const writing = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const release = useRef<(() => void) | undefined>(undefined);

  // 首次读到（或保存后重新读到）权限组时，以最新记录为基线；有未保存输入时不覆盖。
  const loadedKey = scope ? JSON.stringify(valuesOf(scope)) : "";
  useEffect(() => {
    if (!scope) return;
    const latest = valuesOf(scope);
    setValues((current) => (JSON.stringify(current) === JSON.stringify(baseline) ? latest : current));
    setBaseline(latest);
  }, [loadedKey]);

  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
  const enabledChanged = !creating && values.enabled !== baseline.enabled;

  const save = async () => {
    if (writing.current || !formRef.current?.reportValidity()) return false;
    writing.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { code, ...body } = values;
      const saved = await api<Scope>(creating ? "/scopes" : `/scopes/${encodeURIComponent(scopeId)}`, {
        method: creating ? "POST" : "PUT",
        body: creating ? { ...body, name: body.name.trim(), code: code.trim() } : { ...body, name: body.name.trim() },
      });
      setBaseline(valuesOf(saved));
      setValues(valuesOf(saved));
      onChanged();
      if (creating) {
        release.current?.();
        onCreated(saved);
      } else {
        setNotice("权限组已保存。");
        setRevision((value) => value + 1);
      }
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    release.current = navigation.registerDraft({
      scopeId,
      dirty: () => dirty || writing.current,
      busy: () => writing.current,
      leaveMessage: enabledChanged
        ? "权限组设置尚未保存。保存会同时启停该组，使持有此组的全部凭据旧 Token 失效；也可放弃本次输入。"
        : "权限组设置尚未保存。保存后继续，或放弃本次输入。",
      save,
    });
    return release.current;
  }, [navigation.registerDraft, scopeId, dirty, busy, values, enabledChanged]);

  const close = () => {
    if (!busy) onClose();
  };

  const settings = (
    <form
      ref={formRef}
      id="scope-settings"
      className="scope-settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (!enabledChanged) void save();
      }}
    >
      {creating ? (
        <label className="scope-field">
          <FieldLabel label="权限组代码" required help="小写字母或数字开头，可含 _ . : -，最长 64 位；创建后不能修改。" />
          <Input
            aria-label="权限组代码"
            required
            maxLength={64}
            pattern="[a-z0-9][a-z0-9_.:\-]{0,63}"
            disabled={busy}
            value={values.code}
            onChange={(event) => setValues((current) => ({ ...current, code: event.target.value }))}
          />
        </label>
      ) : (
        <ReadonlyField label="权限组代码" value={values.code} code reason="代码创建后固定，被 API 与凭据引用。" />
      )}
      <label className="scope-field">
        <FieldLabel label="权限组名称" required />
        <Input
          aria-label="权限组名称"
          required
          maxLength={100}
          disabled={busy}
          value={values.name}
          onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
        />
      </label>
      <div className="scope-switches" role="group" aria-label="权限组开关">
        <div className="scope-switch">
          <Switch aria-label="启用权限组" checked={values.enabled} disabled={busy} onChange={(enabled) => setValues((current) => ({ ...current, enabled }))} />
          <div>
            <strong>启用</strong>
            <p>{scopeHelp.enabled}</p>
          </div>
        </div>
        <div className="scope-switch">
          <Switch
            aria-label="新凭据默认授予"
            checked={values.defaultForNewApplication}
            disabled={busy}
            onChange={(defaultForNewApplication) => setValues((current) => ({ ...current, defaultForNewApplication }))}
          />
          <div>
            <strong>新凭据默认授予</strong>
            <p>{scopeHelp.defaultGrant}</p>
          </div>
        </div>
        <div className="scope-switch">
          <Switch
            aria-label="公共通用"
            checked={values.publicAccess}
            disabled={busy}
            onChange={(publicAccess) => setValues((current) => ({ ...current, publicAccess }))}
          />
          <div>
            <strong>公共通用</strong>
            <p>{scopeHelp.publicAccess}</p>
          </div>
        </div>
      </div>
      {enabledChanged && (
        <p className="scope-warning" role="status">
          保存后持有此组的全部凭据旧Token失效（包括调用其他组的Token），接入方需要重新签发。{values.enabled ? "" : "停用后该组不可调用。"}
        </p>
      )}
      {!creating && values.defaultForNewApplication !== baseline.defaultForNewApplication && (
        <p className="scope-note">默认授予只影响之后创建的新凭据，不修改已有授权。</p>
      )}
      {!creating && values.publicAccess !== baseline.publicAccess && (
        <p className="scope-note">
          {values.publicAccess
            ? "保存后所有租户立即可在 MCP 工具与门户中使用此组的 API；不影响凭据与 Token。"
            : "保存后立即收回：只有在“已开通租户”中开通的租户还能使用此组的 API；不影响凭据与 Token。"}
        </p>
      )}
      <ErrorFeedback error={error} />
      {notice && (
        <p className="scope-success" role="status">
          {notice}
        </p>
      )}
    </form>
  );

  const saveButton = (
    <Button type="primary" htmlType={enabledChanged ? "button" : "submit"} form="scope-settings" loading={busy} disabled={!creating && !dirty}>
      {creating ? "创建权限组" : "保存权限组"}
    </Button>
  );
  const footer =
    creating || (scope && tab === "settings") ? (
      <div className="scope-drawer-footer">
        <Button disabled={busy} onClick={close}>
          {creating ? "取消" : "关闭"}
        </Button>
        {enabledChanged ? (
          <ConfirmAction
            title={values.enabled ? "启用权限组？" : "停用权限组？"}
            description="持有此组的全部凭据的旧 Token 将失效，接入方需要重新签发。"
            okText={values.enabled ? "启用并保存" : "停用并保存"}
            danger={!values.enabled}
            onConfirm={() => {
              void save();
            }}
          >
            {saveButton}
          </ConfirmAction>
        ) : (
          saveButton
        )}
      </div>
    ) : undefined;

  return (
    <EntityDrawer
      open
      width="lg"
      title={creating ? "新建权限组" : (scope?.name ?? "权限组")}
      status={scope && <StatusBadge tone={scope.enabled ? "success" : "neutral"}>{enabledText(scope.enabled)}</StatusBadge>}
      subtitle={
        scope && (
          <span className="scope-subtitle">
            <span className="op-code">{scope.code}</span>
            <span>新凭据默认授予：{defaultGrantText(scope)}</span>
            <span>公共通用：{publicAccessText(scope)}</span>
            <span>API {scope.apiCount ?? 0} 个 · 凭据 {scope.credentialCount ?? 0} 个</span>
          </span>
        )
      }
      loading={!creating && !scope && detail.loading}
      onClose={close}
      footer={footer}
      tabs={
        scope
          ? [
              { key: "settings", label: "设置", children: settings },
              {
                key: "apis",
                label: `API (${scope.apiCount ?? 0})`,
                children: (
                  <ScopeApis
                    api={api}
                    scope={scope}
                    canEdit={canEditApis}
                    onChanged={() => {
                      setRevision((value) => value + 1);
                      onChanged();
                    }}
                  />
                ),
              },
              { key: "tenants", label: `已开通租户 (${scope.tenantCount ?? 0})`, children: <ScopeTenantGrants api={api} scope={scope} onChanged={() => { setRevision(value => value + 1); onChanged(); }} /> },
            ]
          : undefined
      }
      activeTab={tab}
      onTabChange={(key) => setTab(key as Tab)}
    >
      {creating ? settings : detail.error && <ErrorFeedback error={detail.error} />}
    </EntityDrawer>
  );
}

interface ApiOption {
  id: string;
  name: string;
  service: string;
  version: string;
  method: string;
  draftRevision: number;
}
const operation = (item: Pick<ApiOption, "service" | "method" | "version">) => `${item.service}.${item.method} · ${item.version}`;

/** API 与权限组的关联在各 API 草稿的 scopeCodes 中：增删生成新的草稿修订，发布后才影响调用。 */
function ScopeApis({ api, scope, canEdit, onChanged }: { api: AdminApi; scope: Scope; canEdit: boolean; onChanged: () => void }) {
  const navigation = useAdminNavigation();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const list = useReadPage<ScopeApi>(api, `/scopes/${encodeURIComponent(scope.id)}/apis?page=${page}&pageSize=20`, revision, true, { keepPrevious: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [options, setOptions] = useState<ApiOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const searchRequest = useRef<AbortController | null>(null);
  useEffect(() => () => searchRequest.current?.abort(), []);

  const search = useDebouncedCallback((text: string) => {
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    const parameters = new URLSearchParams({ page: "1", pageSize: "10" });
    if (text.trim()) parameters.set("query", text.trim());
    api<Page<ApiOption>>(`/apis?${parameters}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setOptions(result.items);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError((failure as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
  });

  const change = async (target: { id: string; name: string; draftRevision: number }, included: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await api<{ draftRevision: number; changed: boolean }>(`/apis/${encodeURIComponent(target.id)}/scope-codes`, {
        method: "PUT",
        body: { expectedRevision: target.draftRevision, scopeCode: scope.code, included },
      });
      setNotice(
        saved.changed
          ? `已${included ? "加入" : "移除"}「${target.name}」草稿（新修订 r${saved.draftRevision}），发布该 API 后生效。`
          : `「${target.name}」草稿${included ? "已包含" : "已不包含"}此权限组，未产生新修订。`,
      );
      setSelected(undefined);
      setRevision((value) => value + 1);
      onChanged();
    } catch (failure) {
      if (conflict(failure)) {
        setError("该 API 草稿已被他人修改，列表已刷新，请核对后重试。");
        setRevision((value) => value + 1);
      } else setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const publish = (apiId: string) => navigation.navigate({ page: "catalog", apiId, step: "pub", query: "", pageNo: 1 });

  const columns: DataTableColumn<ScopeApi>[] = [
    {
      key: "api",
      title: "API",
      hideable: false,
      render: (item) => (
        <span className="op-cell-main">
          <span className="op-cell-main__title">{item.name}</span>
          <span className="op-cell-sub scope-code">{operation(item)}</span>
        </span>
      ),
    },
    {
      key: "state",
      title: "状态",
      width: 220,
      render: (item) => {
        const state = scopeApiState(item);
        return (
          <StatusBadge tone={state.tone} detail={state.detail}>
            {state.label}
          </StatusBadge>
        );
      },
    },
    {
      key: "actions",
      title: "操作",
      width: 168,
      hideable: false,
      render: (item) =>
        canEdit ? (
          <div className="op-row-actions">
            {item.draftIncluded ? (
              <ConfirmAction
                title={`从「${item.name}」草稿移除此权限组？`}
                description={
                  item.liveIncluded
                    ? "生成新的草稿修订；发布该 API 后，持有此组的凭据将不能再调用它。发布前已生效版本保持不变。"
                    : "生成新的草稿修订，撤回尚未发布的加入。"
                }
                okText="移除"
                danger
                onConfirm={() => change(item, false)}
                disabled={busy}
              >
                <Button type="link" size="small" danger disabled={busy}>
                  移除<span className="sr-only"> {item.name}</span>
                </Button>
              </ConfirmAction>
            ) : (
              <Button type="link" size="small" disabled={busy || !scope.enabled} onClick={() => void change(item, true)}>
                撤销移除<span className="sr-only"> {item.name}</span>
              </Button>
            )}
            {item.draftIncluded !== item.liveIncluded && (
              <Button type="link" size="small" onClick={() => publish(item.id)}>
                去发布<span className="sr-only"> {item.name}</span>
              </Button>
            )}
          </div>
        ) : (
          <span className="op-muted">只读</span>
        ),
    },
  ];

  const selectedOption = options.find((item) => item.id === selected);
  const addDisabledReason = !scope.enabled ? "权限组已停用，不能加入 API；请先在“设置”中启用。" : undefined;
  const pending = (list.data?.items ?? []).filter((item) => item.draftIncluded !== item.liveIncluded).length;

  return (
    <div className="scope-apis">
      <p className="scope-note">
        API 与权限组的关联保存在各 API 的草稿中。在这里加入或移除会修改该 API 的草稿（生成新修订），需在 API 工作区发布后才影响调用；已发布版本在此之前保持不变。
        {pending > 0 && ` 本页有 ${pending} 个 API 的增删尚未发布。`}
      </p>
      {canEdit ? (
        <div className="scope-add" role="group" aria-label="加入 API">
          <Select<string>
            showSearch
            allowClear
            aria-label="搜索要加入的 API"
            placeholder="搜索 API 名称或 service.method"
            filterOption={false}
            loading={searching}
            disabled={busy || Boolean(addDisabledReason)}
            value={selected}
            onSearch={(text) => search.run(text)}
            onFocus={() => options.length === 0 && search.flush("")}
            onChange={(value) => setSelected(value)}
            notFoundContent={searching ? "正在搜索…" : "没有匹配的 API"}
            options={options.map((item) => ({ value: item.id, label: `${item.name} · ${operation(item)}` }))}
            className="scope-add__select"
          />
          <Tooltip title={addDisabledReason}>
            <Button type="primary" disabled={busy || !selectedOption || Boolean(addDisabledReason)} onClick={() => selectedOption && void change(selectedOption, true)}>
              加入草稿
            </Button>
          </Tooltip>
        </div>
      ) : (
        <p className="scope-note">你没有 API 管理权限，这里只能查看。如需调整，请联系 API 负责人在 API 配置的“谁可以调用”中修改并发布。</p>
      )}
      <ErrorFeedback error={error} />
      {notice && (
        <p className="scope-success" role="status">
          {notice}
        </p>
      )}
      <DataTable<ScopeApi>
        caption="权限组包含的 API"
        rowKey={(item) => item.id}
        columns={columns}
        data={list.error ? [] : (list.data?.items ?? [])}
        loading={list.loading}
        pagination={list.data ? { page, pageSize: 20, total: list.data.total, onChange: (next) => setPage(next) } : undefined}
        empty={
          list.error ? (
            <EmptyState kind="error" title="API 列表加载失败" description={list.error} action={<Button onClick={list.reload}>重新加载</Button>} />
          ) : (
            <EmptyState title="还没有 API 使用此权限组" description={canEdit ? "搜索 API 并加入草稿，发布后持有此组的凭据即可调用。" : undefined} />
          )
        }
      />
    </div>
  );
}
