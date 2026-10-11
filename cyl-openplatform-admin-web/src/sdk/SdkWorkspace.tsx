import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Pagination, Select } from "antd";
import { AdminApiError, type AdminApi } from "../access/api";
import { ErrorFeedback, LoadFeedback, usePage } from "@cyl/open-platform-web-shared/components";
import { DisabledReason, EntityDrawer, FieldLabel, ReadonlyField, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import {
  type SdkAsset,
  type SdkAssetKind,
  type SdkArchivePreview,
  type SdkClient,
} from "@cyl/open-platform-web-shared/sdk/api";
import AssetDownload from "@cyl/open-platform-web-shared/sdk/AssetDownload";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import type { DocumentSummary } from "@cyl/open-platform-web-shared/documentation/types";

/** SDK 抽屉：先校验 ZIP 清单再登记，上传与发布、撤下分步且都需明确操作；未保存或待核对时离开受保护。 */
export default function SdkWorkspace({
  id,
  kind,
  api,
  client,
  permissions,
  close,
  changed,
}: {
  id: string;
  kind: SdkAssetKind;
  api: AdminApi;
  client: SdkClient;
  permissions: string[];
  close: () => void;
  changed: () => void;
}) {
  const navigation = useAdminNavigation();
  const [asset, setAsset] = useState<SdkAsset | null>(null),
    [loading, setLoading] = useState(id !== "new");
  const [name, setName] = useState(""),
    [notes, setNotes] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [archive, setArchive] = useState<SdkArchivePreview | null>(null);
  const [selectedApi, setSelectedApi] = useState<DocumentSummary | null>(null);
  const [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [needsCheck, setNeedsCheck] = useState(false);
  const [compared, setCompared] = useState(false);
  const [confirmation, setConfirmation] = useState<
    "publish" | "withdraw" | null
  >(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null),
    inspection = useRef<AbortController | null>(null);
  const currentAsset = useRef<SdkAsset | null>(null);
  const initializedId = useRef<string | null>(null);
  const unknownCreate = useRef<Record<string, string> | null>(null);
  const canManage = permissions.includes("MANAGE_APIS"),
    canPublish = permissions.includes("PUBLISH_APIS");
  const dirty = asset
    ? name !== asset.name || notes !== asset.releaseNotes || !!file
    : !!name || !!notes || !!file;
  const guard = useRef({ dirty, busy });
  guard.current = { dirty: dirty || needsCheck || busy, busy };
  useEffect(
    () =>
      navigation.registerDraft({
        sdkAssetId: () => currentAsset.current?.id ?? id,
        dirty: () => guard.current.dirty,
        busy: () => guard.current.busy,
        save: async () => false,
        canSave: false,
        leaveMessage:
          "SDK 尚有未保存内容或待核对结果。离开前可先完成保存或核对。",
      }),
    [navigation.registerDraft, id, busy],
  );
  useEffect(
    () => () => {
      request.current?.abort();
      inspection.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const changedObject = initializedId.current !== id && currentAsset.current?.id !== id;
    initializedId.current = id;
    if (changedObject) {
      inspection.current?.abort(); inspection.current = null; setChecking(false);
      request.current?.abort(); request.current = null; setBusy(false);
      unknownCreate.current = null; setSelectedApi(null); currentAsset.current = null;
      setAsset(null); setName(''); setNotes(''); clearFile(); setError(''); setNotice('');
      setNeedsCheck(false); setConfirmation(null); setCompared(false);
    }
    // 同一对象只保留已加载内容；首读被取消时（含StrictMode）必须重新读取。
    if (id === 'new') { setLoading(false); return; }
    if (currentAsset.current?.id === id) return;
    setError('');
    const abort = new AbortController();
    setLoading(true);
    void client
      .read<SdkAsset>("/" + encodeURIComponent(id), { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) {
          currentAsset.current = value;
          setAsset(value);
          setName(value.name);
          setNotes(value.releaseNotes);
        }
      })
      .catch((reason) => {
        if (!abort.signal.aborted) setError(reason.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [client, id]);
  function clearFile() {
    setFile(null);
    setArchive(null);
    if (fileInput.current) fileInput.current.value = "";
  }
  async function inspect(next: File | null) {
    inspection.current?.abort();
    setFile(next);
    setArchive(null);
    setError("");
    setNotice("");
    if (!next) {
      setChecking(false);
      return;
    }
    const abort = new AbortController();
    inspection.current = abort;
    setChecking(true);
    try {
      const value = await client.inspect!(next, abort.signal);
      if (abort.signal.aborted) return;
      setArchive(value);
      setName((current) => current || next.name.replace(/\.zip$/i, ""));
    } catch (reason) {
      if (!abort.signal.aborted) setError((reason as Error).message);
    } finally {
      if (!abort.signal.aborted) setChecking(false);
    }
  }
  function accepted(value: SdkAsset, resetText = false) {
    currentAsset.current = value;
    setAsset(value);
    // 登记取得真实ID后替换new地址；保留本侧栏的文件与请求，不重挂载或重发上传。
    if (id === "new")
      navigation.navigate({ ...navigation.route, sdkAssetId: value.id }, true);
    if (resetText) {
      setName(value.name);
      setNotes(value.releaseNotes);
    }
    changed();
  }
  async function mutate(
    action: (signal: AbortSignal) => Promise<SdkAsset>,
    message: string,
    resetText = false,
  ) {
    if (request.current || needsCheck) return;
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await action(abort.signal);
      if (abort.signal.aborted) return;
      accepted(value, resetText);
      setConfirmation(null);
      setNotice(message);
      return value;
    } catch (reason) {
      if (!abort.signal.aborted) {
        setError((reason as Error).message);
        setNeedsCheck(
          !(
            reason instanceof AdminApiError &&
            reason.httpStatus !== undefined &&
            reason.httpStatus < 500 &&
            reason.httpStatus !== 409
          ),
        );
      }
    } finally {
      if (!abort.signal.aborted) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  async function register() {
    if (
      !canManage ||
      !archive ||
      !file ||
      !name.trim() ||
      (kind === "LEGACY_API" && !selectedApi)
    )
      return;
    const body = {
      kind,
      name: name.trim(),
      releaseNotes: notes,
      ...(kind === "LEGACY_API" && selectedApi
        ? { apiId: selectedApi.apiId, releaseId: selectedApi.releaseId }
        : {}),
      sdkVersion: archive.manifest.sdkVersion,
      language: archive.manifest.language,
      runtime: archive.manifest.runtime,
      gatewayProtocol: archive.manifest.gatewayProtocol,
    };
    unknownCreate.current = body;
    await mutate(
      async (signal) => {
        const created = await client.read<SdkAsset>("", {
          method: "POST",
          body,
          signal,
        });
        if (signal.aborted) return created;
        accepted(created, true);
        unknownCreate.current = null;
        const uploaded = await client.upload!(created, file, signal);
        if (!signal.aborted) clearFile();
        return uploaded;
      },
      "ZIP 已校验并保存，尚未发布。核对后可明确发布。",
      true,
    );
  }
  async function reconcile() {
    if (request.current) return;
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    setError("");
    try {
      let current: SdkAsset | null = null;
      if (asset)
        current = await client.read<SdkAsset>(
          "/" + encodeURIComponent(asset.id),
          { signal: abort.signal },
        );
      else if (id !== "new")
        current = await client.read<SdkAsset>("/" + encodeURIComponent(id), {
          signal: abort.signal,
        });
      else if (unknownCreate.current) {
        const body = unknownCreate.current;
        const params = new URLSearchParams({
          kind: body.kind,
          sdkVersion: body.sdkVersion,
          language: body.language,
          page: "1",
          pageSize: "20",
        });
        if (body.apiId) params.set("apiId", body.apiId);
        const page = await client.read<{ items: SdkAsset[] }>("?" + params, {
          signal: abort.signal,
        });
        current = page.items[0] ?? null;
      }
      if (abort.signal.aborted) return;
      if (current) {
        const matches =
          !!archive &&
          current.sha256 === archive.sha256 &&
          current.sizeBytes === archive.sizeBytes;
        accepted(current, !asset && id !== "new");
        setCompared(!!asset || id === "new");
        if (matches) {
          clearFile();
        }
        setNotice(
          matches
            ? "已确认所选 ZIP 保存成功；以当前发布状态为准。"
            : `已核对 SDK ${current.sdkVersion} · 修订 ${stringifyJson(current.revision)}。输入已保留，请确认当前内容后继续。`,
        );
      } else
        setNotice(
          "当前未查到此版本的登记，可按原版本明确重试；系统不会自动重新提交。",
        );
      setNeedsCheck(false);
      setLoading(false);
      setConfirmation(null);
    } catch (reason) {
      if (!abort.signal.aborted) setError((reason as Error).message);
    } finally {
      if (!abort.signal.aborted) {
        setBusy(false);
        request.current = null;
      }
    }
  }
  const editable = !asset || asset.status === "DRAFT";
  const mismatch =
    asset &&
    archive &&
    (["sdkVersion", "language", "runtime", "gatewayProtocol"] as const).filter(
      (key) => asset[key] !== archive.manifest[key],
    );
  const metadataDirty =
    !!asset && (name !== asset.name || notes !== asset.releaseNotes);
  const blocked = busy || needsCheck;
  // 发布与撤下前须先处理进行中的操作、待核对结果和未保存内容。
  const changeReason = busy
    ? "正在处理上一个操作"
    : needsCheck
      ? "先核对上次操作的结果"
      : metadataDirty
        ? "名称或说明有未保存修改，先保存草稿"
        : file
          ? "所选 ZIP 尚未保存"
          : undefined;
  const status =
    asset?.status === "PUBLISHED"
      ? "已发布"
      : asset?.status === "WITHDRAWN"
        ? "已撤下"
        : asset?.sizeBytes
          ? "待发布"
          : "待上传";
  return (
    <EntityDrawer
      open
      width="lg"
      title={asset ? `${asset.name} · ${asset.sdkVersion}` : kind === "PLATFORM" ? "登记平台 SDK" : "登记历史接口 SDK"}
      status={asset ? <StatusBadge tone={asset.status === "PUBLISHED" ? "success" : asset.status === "WITHDRAWN" ? "neutral" : "warning"}>{status}</StatusBadge> : undefined}
      subtitle={asset ? <span className="op-muted">修订 {stringifyJson(asset.revision)}</span> : undefined}
      onClose={() => {
        if (!busy) close();
      }}
      footer={
        <div className="sdk-drawer-footer">
          <Button onClick={close} disabled={busy}>
            关闭
          </Button>
          {needsCheck && (
            <Button
              type="primary"
              disabled={busy}
              onClick={() => void reconcile()}
            >
              核对最新结果，保留输入
            </Button>
          )}
          {asset?.status === "DRAFT" && canPublish && (
            <DisabledReason reason={changeReason ?? (!asset.sizeBytes ? "先上传并保存 ZIP" : undefined)}>
              <Button type="primary" disabled={Boolean(changeReason) || !asset.sizeBytes} onClick={() => setConfirmation("publish")}>
                发布 SDK
              </Button>
            </DisabledReason>
          )}
          {asset && asset.status !== "WITHDRAWN" && canPublish && (
            <DisabledReason reason={changeReason}>
              <Button danger disabled={Boolean(changeReason)} onClick={() => setConfirmation("withdraw")}>
                撤下 SDK
              </Button>
            </DisabledReason>
          )}
        </div>
      }
    >
      <LoadFeedback
        loading={loading}
        error={""}
        retry={() => void reconcile()}
      />
      {!loading && !asset && id !== "new" && (
        <Button onClick={() => void reconcile()}>重新读取 SDK</Button>
      )}
      <ErrorFeedback error={error} />
      {busy && <p role="status">正在处理 SDK，请稍候…</p>}
      {notice && <Alert type="success" showIcon role="status" title={notice} />}
      {(asset || id === "new") && (
        <>
          <div className="sdk-workspace-status">
            {!asset && <StatusBadge tone="warning">{status}</StatusBadge>}
            <span>
              {asset?.status === "PUBLISHED"
                ? asset.kind === "PLATFORM"
                  ? "已公开，可匿名下载"
                  : "仅绑定接口授权范围可下载"
                : asset?.status === "WITHDRAWN"
                  ? "客户不可下载；此版本不能恢复发布"
                  : asset?.sizeBytes
                    ? "ZIP 已保存；客户暂不可下载"
                    : "先选择 ZIP，系统会校验并读取清单"}
            </span>
            {asset && (
              <>
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() => void reconcile()}
                >
                  刷新 SDK 状态
                </Button>
              </>
            )}
          </div>
          {!asset && kind === "LEGACY_API" && (
            <LegacyApiPicker
              api={api}
              value={selectedApi}
              onChange={setSelectedApi}
              disabled={blocked}
            />
          )}
          <div className="sdk-workspace-grid">
            <section className="sdk-section">
              <h3>{editable ? "1. 文件与运行要求" : "文件与运行要求"}</h3>
              {editable && canManage && (
                <div className="sdk-field">
                  <FieldLabel label="SDK ZIP 文件" help="ZIP 最大 2 MiB，展开最大 8 MiB/64 项；根目录须含 sdk-manifest.json。这里维护客户调用 SDK，不是内部 Provider SDK；平台不执行包内程序。" />
                  <input
                    aria-label="SDK ZIP 文件"
                    ref={fileInput}
                    type="file"
                    accept=".zip,application/zip"
                    disabled={blocked}
                    onChange={(event) =>
                      void inspect(event.target.files?.[0] ?? null)
                    }
                  />
                </div>
              )}
              {file && (
                <Button
                  size="small"
                  disabled={blocked}
                  onClick={() => {
                    inspection.current?.abort();
                    clearFile();
                    setChecking(false);
                    setError("");
                  }}
                >
                  取消所选文件
                </Button>
              )}
              {checking && <p role="status">正在校验 ZIP 与清单…</p>}
              {asset?.sizeBytes && (
                <p>已保存 ZIP：{(asset.sizeBytes / 1024).toFixed(1)} KiB</p>
              )}
              {(archive || asset) && (
                <div className="sdk-facts">
                  {(["sdkVersion", "language", "runtime"] as const).map((key, index) => (
                    <ReadonlyField key={key} label={["SDK 版本", "语言", "运行环境"][index]} value={(archive?.manifest ?? asset)?.[key]} />
                  ))}
                </div>
              )}
              {archive && (
                <p role="status">
                  所选文件已通过格式校验 ·{" "}
                  {(archive.sizeBytes / 1024).toFixed(1)} KiB
                </p>
              )}
              {!!mismatch?.length && (
                <p role="alert" className="op-cell-sub op-cell-sub--error">
                  所选 ZIP 与登记的
                  {mismatch
                    .map(
                      (key) =>
                        ({
                          sdkVersion: "版本",
                          language: "语言",
                          runtime: "运行环境",
                          gatewayProtocol: "协议",
                        })[key],
                    )
                    .join("、")}
                  不一致。请选择同一版本的包，或另行登记新版本。
                </p>
              )}
              {asset && (
                <>
                  <details>
                    <summary>文件摘要与清单</summary>
                    <code className="sdk-digest">
                      {asset.sha256 || "尚未上传"}
                    </code>
                    <pre>
                      {stringifyJson(
                        {
                          format: "cyl-openplatform.sdk/v1",
                          sdkVersion: asset.sdkVersion,
                          language: asset.language,
                          gatewayProtocol: asset.gatewayProtocol,
                          runtime: asset.runtime,
                        },
                        2,
                      )}
                    </pre>
                  </details>
                  <AssetDownload asset={asset} client={client} />
                </>
              )}
              {asset && editable && canManage && (
                <Button
                  disabled={
                    blocked ||
                    checking ||
                    !archive ||
                    !file ||
                    !!mismatch?.length
                  }
                  onClick={() =>
                    void mutate(async (signal) => {
                      const value = await client.upload!(asset, file!, signal);
                      if (!signal.aborted) clearFile();
                      return value;
                    }, "ZIP 已保存，尚未发布。")
                  }
                >
                  保存所选 ZIP
                </Button>
              )}
            </section>
            <section className="sdk-section">
              <h3>{editable ? "2. 名称与版本说明" : "版本发布说明"}</h3>
              {compared && asset && metadataDirty && (
                <details className="sdk-current-metadata" open>
                  <summary>
                    服务器当前内容 · 修订 {stringifyJson(asset.revision)}
                    （你的输入已保留）
                  </summary>
                  <p>名称：{asset.name}</p>
                  <p className="sdk-notes">
                    版本说明：{asset.releaseNotes || "未填写"}
                  </p>
                </details>
              )}
              {editable ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!canManage) return;
                    if (!asset) void register();
                    else
                      void mutate(
                        (signal) =>
                          client.read("/" + encodeURIComponent(asset.id), {
                            method: "PUT",
                            body: {
                              expectedRevision: asset.revision,
                              name: name.trim(),
                              releaseNotes: notes,
                            },
                            signal,
                          }),
                        "草稿说明已保存。",
                        true,
                      );
                  }}
                >
                  <label className="sdk-field">
                    <FieldLabel label="SDK 名称" required />
                    <Input
                      aria-label="SDK 名称"
                      value={name}
                      maxLength={100}
                      required
                      disabled={blocked || !canManage}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label className="sdk-field">
                    <FieldLabel label="版本发布说明" />
                    <Input.TextArea
                      aria-label="版本发布说明"
                      value={notes}
                      maxLength={4000}
                      rows={7}
                      disabled={blocked || !canManage}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="说明本版本能力、认证方式、运行要求及使用变化"
                    />
                  </label>
                  <Button
                    htmlType="submit"
                    type={asset ? "default" : "primary"}
                    disabled={
                      blocked ||
                      checking ||
                      !canManage ||
                      !name.trim() ||
                      (!asset &&
                        (!archive || (kind === "LEGACY_API" && !selectedApi)))
                    }
                  >
                    {asset ? "保存 SDK 草稿" : "登记并保存 ZIP"}
                  </Button>
                </form>
              ) : (
                <p className="sdk-notes">
                  {asset?.releaseNotes || "暂无版本发布说明。"}
                </p>
              )}
              {asset?.kind === "LEGACY_API" && (
                <p>
                  绑定接口：{asset.service} / {asset.version} / {asset.method}
                  <br />
                  <span className="op-cell-sub">固定发布记录：{asset.releaseId}</span>
                </p>
              )}
              {asset?.status === "PUBLISHED" && asset.kind === "PLATFORM" && (
                <a
                  href={`/portal/?section=sdk&asset=${encodeURIComponent(asset.id)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看客户下载页 ↗
                </a>
              )}
              {metadataDirty && (
                <span className="op-cell-sub op-cell-sub--warning">说明有未保存修改，先保存后再发布。</span>
              )}
            </section>
          </div>
        </>
      )}
      {confirmation && asset && (
        <section className="sdk-confirm" role="alertdialog" aria-label={confirmation === "publish" ? "发布 SDK" : "撤下 SDK"}>
          <Alert
            type={confirmation === "publish" ? "info" : "warning"}
            showIcon
            title={confirmation === "publish" ? "发布 SDK" : "撤下 SDK"}
            description={
              confirmation === "publish"
                ? `发布SDK ${asset.sdkVersion} 后内容不可修改。${asset.kind === "PLATFORM" ? "此版本将公开供客户匿名下载。" : "此版本仅按绑定API授权下载。"}请确认已核对包内源码、README和版本说明。`
                : `撤下SDK ${asset.sdkVersion} 后客户不能继续下载，此版本不能恢复；已下载文件不受影响。`
            }
          />
          <div className="sdk-actions">
            <Button autoFocus disabled={busy} onClick={() => setConfirmation(null)}>
              取消
            </Button>
            <Button
              type="primary"
              danger
              disabled={busy || !canPublish || needsCheck}
              onClick={() =>
                void mutate(
                  (signal) =>
                    client.read("/" + encodeURIComponent(asset.id) + "/" + confirmation, {
                      method: "POST",
                      body: { expectedRevision: asset.revision },
                      signal,
                    }),
                  confirmation === "publish" ? "SDK 已发布。" : "SDK 已撤下。",
                )
              }
            >
              确认{confirmation === "publish" ? "发布 SDK" : "撤下 SDK"}
            </Button>
          </div>
        </section>
      )}
    </EntityDrawer>
  );
}
function LegacyApiPicker({
  api,
  value,
  onChange,
  disabled,
}: {
  api: AdminApi;
  value: DocumentSummary | null;
  onChange: (value: DocumentSummary) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const list = usePage<DocumentSummary>(
    api,
    `/documents?page=${page}&pageSize=20&query=${encodeURIComponent(query)}`,
  );
  return (
    <section className="sdk-legacy-choice">
      <label className="sdk-field">
        <FieldLabel label="绑定的生效 API" required />
        <Select
          aria-label="绑定的生效 API"
          value={value?.apiId}
          disabled={disabled}
          placeholder="搜索名称并选择生效 API"
          showSearch={{
            filterOption: false,
            onSearch: (text) => {
              setQuery(text);
              setPage(1);
            },
          }}
          options={[
            ...(value &&
            !list.data?.items.some((item) => item.apiId === value.apiId)
              ? [value]
              : []),
            ...(list.data?.items ?? []),
          ].map((item) => ({
            value: item.apiId,
            label: `${item.name} · ${item.service}/${item.version}/${item.method}`,
          }))}
          onChange={(id) => {
            const selected = list.data?.items.find((item) => item.apiId === id);
            if (selected) onChange(selected);
          }}
          popupRender={(menu) => (
            <>
              {menu}
              <LoadFeedback {...list} retry={list.reload} />
              {list.data && list.data.total > 20 && <Pagination simple size="small" current={page} pageSize={20} total={list.data.total} onChange={setPage} />}
            </>
          )}
        />
      </label>
      {value && <span className="op-cell-sub">固定发布 {value.releaseId} · 不进入匿名平台目录</span>}
    </section>
  );
}
