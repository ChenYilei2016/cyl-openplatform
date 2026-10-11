import { createRequestKey } from "../shared/requestKey";
import { ArrowLeftOutlined, UploadOutlined } from "@ant-design/icons";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import { parseJson, stringifyJson } from "@cyl/open-platform-web-shared/json";
import { FieldHelp, PageHeader, StatusBadge, StickyActionBar, type StatusTone } from "@cyl/open-platform-web-shared/ui/components";
import { Alert, Button, Checkbox, Input, Table } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminApiError, type AdminApi } from "../access/api";
import type { ApiDefinition } from "../catalog/CatalogPanel";
import { adapterForm } from "../catalog/ResponseAdapterEditor";
import { responseSchemaSuggestion } from "../catalog/responseSchemaGuidance";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import PublicationDiff from "../publication/PublicationDiff";
import CandidateEditor from "./CandidateEditor";
import "./importing.css";

interface PreviewItem {
  index: number;
  operation: { service: string; version: string; method: string } | null;
  change: "CREATE" | "UPDATE" | "UNCHANGED" | "ERROR";
  expectedRevision: number;
  changedFields: string[];
  before: unknown;
  after: unknown;
  errors: string[];
  warnings?: string[];
}
interface Preview {
  documentDigest: string;
  items: PreviewItem[];
}
interface ImportResult {
  committed: boolean;
  items: {
    index: number;
    change: string;
    apiId: string | null;
    revision: number | null;
    errors: string[];
  }[];
}
interface PendingImport {
  key: string;
  documentDigest: string;
  selections: { index: number; expectedRevision: number }[];
  sourceKind: "PLATFORM" | "OPENAPI" | "HTTP";
  sourceDigest: string;
}
const pendingStorageKey = (operatorKey: string) =>
  `szopen.api-import.pending:${encodeURIComponent(operatorKey)}`;

/** 本tab仅保留重放身份和固定基线；正文、来源文本和秘密不进入存储。 */
export function readPendingImport(operatorKey?: string): PendingImport | null {
  if (!operatorKey) return null;
  const stored = sessionStorage.getItem(pendingStorageKey(operatorKey));
  if (stored === null) return null;
  if (stored.length > 8192)
    throw new Error("导入恢复信息不完整，请先核对原提交，不能开始新提交。");
  const value = parseJson<PendingImport>(stored);
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).sort().join() !==
      "documentDigest,key,selections,sourceDigest,sourceKind" ||
    typeof value.key !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value.key,
    ) ||
    !/^[0-9a-f]{64}$/.test(value.documentDigest) ||
    !/^[0-9a-f]{64}$/.test(value.sourceDigest) ||
    !["PLATFORM", "OPENAPI", "HTTP"].includes(value.sourceKind) ||
    !Array.isArray(value.selections) ||
    !value.selections.length ||
    value.selections.length > 20 ||
    new Set(value.selections.map((selection) => selection?.index)).size !==
      value.selections.length ||
    value.selections.some(
      (selection) =>
        !selection ||
        Object.keys(selection).sort().join() !== "expectedRevision,index" ||
        !Number.isInteger(selection.index) ||
        selection.index < 0 ||
        selection.index >= 20 ||
        !/^\d+$/.test(stringifyJson(selection.expectedRevision)) ||
        BigInt(stringifyJson(selection.expectedRevision)) >
          9223372036854775806n,
    )
  ) {
    throw new Error("导入恢复信息不完整，请先核对原提交，不能开始新提交。");
  }
  return value;
}

function submissionBody(pending: PendingImport, document: string): string {
  return `{"submissionKey":${stringifyJson(pending.key)},"sourceKind":${stringifyJson(pending.sourceKind)},"sourceDigest":${stringifyJson(pending.sourceDigest)},"document":${document},"documentDigest":${stringifyJson(pending.documentDigest)},"selections":${stringifyJson(pending.selections)}}`;
}

function definitiveRejection(failure: unknown): boolean {
  if (!(failure instanceof AdminApiError)) return false;
  const status =
    failure.code < 1000 ? failure.code : Math.floor(failure.code / 100000);
  return status >= 400 && status < 500 && status !== 401 && status !== 403;
}
const maxBytes = 256 * 1024;
const changeLabels = {
  CREATE: "新增",
  UPDATE: "更新",
  UNCHANGED: "无变化",
  ERROR: "错误",
};
const changeTones: Record<PreviewItem["change"], StatusTone> = {
  CREATE: "info",
  UPDATE: "warning",
  UNCHANGED: "neutral",
  ERROR: "error",
};

export default function ApiImport({
  api,
  onReturn,
  initialDocument = "",
  source,
  onOpen,
  onCommitted,
  operatorKey,
  preparedBatch = false,
  returnLabel,
}: {
  api: AdminApi;
  onReturn: (draft?: {
    document: string;
    canEditCandidates: boolean;
    committed: boolean;
    source?: { kind: "PLATFORM" | "OPENAPI" | "HTTP"; digest: string };
  }) => void;
  initialDocument?: string;
  source?: { kind: "PLATFORM" | "OPENAPI" | "HTTP"; digest: string };
  onOpen?: (id: string) => void;
  onCommitted?: (ids: string[]) => void;
  operatorKey?: string;
  preparedBatch?: boolean;
  returnLabel?: string;
}) {
  const navigation = useAdminNavigation();
  const fileInput = useRef<HTMLInputElement>(null);
  const recoveryFileInput = useRef<HTMLInputElement>(null);
  const storageKey = operatorKey ? pendingStorageKey(operatorKey) : null;
  const [restored] = useState(() => {
    try {
      return { pending: readPendingImport(operatorKey), error: "" };
    } catch {
      return {
        pending: null,
        error:
          "无法读取本tab的导入恢复信息，请恢复浏览器存储访问并核对原提交，勿重复创建。",
      };
    }
  });
  const [document, setDocument] = useState(initialDocument);
  const [detail, setDetail] = useState<PreviewItem | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [editing, setEditing] = useState<PreviewItem | null>(null);
  const [itemJson, setItemJson] = useState<string | null>(null);
  const hasSourceRevision = useMemo(() => {
    if (itemJson === null) return false;
    try {
      const value = parseJson<unknown>(itemJson);
      return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.prototype.hasOwnProperty.call(value, "expectedRevision");
    } catch { return false; }
  }, [itemJson]);
  const [sourceOpen, setSourceOpen] = useState(!initialDocument);
  const resultLabels = useRef<Record<number, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState(restored.error);
  const [busy, setBusy] = useState(false);
  const submission = useRef<{
    pending: PendingImport;
    bodyText?: string;
  } | null>(restored.pending ? { pending: restored.pending } : null);
  const [recoveryDocument, setRecoveryDocument] = useState("");
  const [recovery, setRecovery] = useState<"unknown" | "not-found" | null>(
    restored.pending || restored.error ? "unknown" : null,
  );
  const active = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const releaseGuard = useRef<(() => void) | null>(null);
  const lastPreview = useRef<Preview | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (editing && itemJson === null) return;
    const release = navigation.registerDraft({
      page: navigation.route.page === "imports" ? "imports" : "catalog",
      apiId: navigation.route.apiId ?? "import",
      dirty: () =>
        busy || recovery !== null || (!result?.committed && !!document),
      busy: () => busy || recovery !== null,
      save: async () => false,
    });
    releaseGuard.current = release;
    return release;
  }, [
    navigation.registerDraft,
    navigation.route.apiId,
    navigation.route.page,
    busy,
    recovery,
    editing,
    itemJson,
    document,
    result?.committed,
  ]);
  function replaceDocument(value: string) {
    if (recovery) return;
    lastPreview.current = null;
    submission.current = null;
    setRecovery(null);
    setDocument(value);
    setPreview(null);
    setSelected([]);
    setResult(null);
    setError("");
  }
  const selectedItems =
    preview?.items.filter((item) => selected.includes(item.index)) ?? [];

  function clearPending() {
    try {
      if (storageKey) sessionStorage.removeItem(storageKey);
    } catch {
      setError(
        "结果已确认，但浏览器暂时无法清除恢复标记；刷新后请再次查询原结果。",
      );
    }
    submission.current = null;
    setRecovery(null);
    setPreview(null);
    setSelected([]);
    setRecoveryDocument("");
  }

  function acceptResult(value: ImportResult) {
    if (
      !value ||
      typeof value.committed !== "boolean" ||
      !Array.isArray(value.items) ||
      !value.items.length ||
      value.items.length > 20 ||
      value.items.some(
        (item) =>
          !item ||
          !Number.isInteger(item.index) ||
          item.index < 0 ||
          item.index >= 20 ||
          typeof item.change !== "string" ||
          (item.apiId !== null && typeof item.apiId !== "string") ||
          !Array.isArray(item.errors) ||
          item.errors.some((error) => typeof error !== "string") ||
          (item.revision !== null &&
            !/^\d+$/.test(stringifyJson(item.revision))),
      )
    ) {
      throw new Error("原提交结果格式不完整，请继续查询。");
    }
    setResult(value);
    if (value.committed)
      onCommitted?.(
        value.items.flatMap((item) => (item.apiId ? [item.apiId] : [])),
      );
    clearPending();
  }

  async function loadPreview(
    nextDocument = document,
    retained: PreviewItem[] = [],
  ) {
    if (busy || recovery) return;
    lastPreview.current = null;
    setError("");
    setPreview(null);
    setSelected([]);
    setResult(null);
    try {
      if (new TextEncoder().encode(nextDocument).length > maxBytes)
        throw new Error("来源超过 256 KiB，请拆小文件。");
      const value = parseJson<Record<string, unknown>>(nextDocument);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("来源必须是 JSON 对象。");
      if (
        Array.isArray(value.apis) &&
        (value.apis.length < 1 || value.apis.length > 20)
      )
        throw new Error("每次导入仅支持 1–20 项。");
    } catch (error) {
      setError((error as Error).message);
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      const value = await api<Preview>("/api-imports/preview", {
        method: "POST",
        bodyText: nextDocument,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setPreview(value);
        lastPreview.current = value;
        setDetail(null);
        setSourceOpen(false);
        resultLabels.current = Object.fromEntries(
          value.items.map((item) => [
            item.index,
            item.operation
              ? `${item.operation.service}/${item.operation.version}/${item.operation.method}`
              : `第 ${item.index + 1} 项`,
          ]),
        );
        setSelected(
          value.items
            .filter(
              (item) =>
                (preparedBatch && item.change === "CREATE") ||
                retained.some(
                  (old) =>
                    old.index === item.index &&
                    old.change === item.change &&
                    stringifyJson(old.operation) ===
                      stringifyJson(item.operation) &&
                    stringifyJson(old.expectedRevision) ===
                      stringifyJson(item.expectedRevision),
                ),
            )
            .map((item) => item.index),
        );
      }
    } catch (error) {
      if (!controller.signal.aborted) setError((error as Error).message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    if (initialDocument && !restored.pending && !restored.error)
      void loadPreview();
    // 候选批次初次进入自动读取差异；后续修改仍需明确重新预览。
  }, []);

  async function confirm() {
    if (
      writing.current ||
      busy ||
      recovery ||
      !preview ||
      !selectedItems.length
    )
      return;
    writing.current = true;
    setError("");
    setResult(null);
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    let sourceDigest: string;
    try {
      sourceDigest =
        source?.digest ??
        Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(document),
            ),
          ),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
    } catch {
      if (!controller.signal.aborted) {
        setError("无法计算来源摘要，尚未发送写入请求。");
        writing.current = false;
        setBusy(false);
      }
      return;
    }
    if (controller.signal.aborted) return;
    const key = createRequestKey();
    const pending: PendingImport = {
      key,
      documentDigest: preview.documentDigest,
      selections: selectedItems.map(({ index, expectedRevision }) => ({
        index,
        expectedRevision,
      })),
      sourceKind: source?.kind ?? "PLATFORM",
      sourceDigest,
    };
    const bodyText = submissionBody(pending, document);
    if (new TextEncoder().encode(bodyText).length > maxBytes) {
      setError("确认请求超过 256 KiB，请拆小来源文件后重新预览。");
      writing.current = false;
      setBusy(false);
      return;
    }
    try {
      if (storageKey)
        sessionStorage.setItem(storageKey, stringifyJson(pending));
    } catch {
      setError(
        "无法保存提交恢复信息，尚未发送写入请求。请允许本tab使用会话存储后重试。",
      );
      writing.current = false;
      setBusy(false);
      return;
    }
    submission.current = { pending, bodyText };
    try {
      const value = await api<ImportResult>("/api-imports/confirm", {
        method: "POST",
        bodyText,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        acceptResult(value);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError((error as Error).message);
        if (definitiveRejection(error)) clearPending();
        else setRecovery("unknown");
        if (
          error instanceof AdminApiError &&
          error.data &&
          typeof error.data === "object" &&
          "committed" in error.data &&
          error.data.committed === false &&
          "items" in error.data &&
          Array.isArray(error.data.items)
        )
          setResult(error.data as ImportResult);
      }
    } finally {
      if (!controller.signal.aborted) {
        writing.current = false;
        setBusy(false);
      }
    }
  }

  async function recover(retry: boolean) {
    const request = submission.current;
    if (
      !request ||
      busy ||
      writing.current ||
      (retry && (recovery !== "not-found" || !request.bodyText))
    )
      return;
    const controller = new AbortController();
    active.current = controller;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await api<ImportResult>(
        retry
          ? "/api-imports/confirm"
          : `/api-imports/requests/${request.pending.key}`,
        retry
          ? {
              method: "POST",
              bodyText: request.bodyText,
              signal: controller.signal,
            }
          : { signal: controller.signal },
      );
      if (!controller.signal.aborted) acceptResult(value);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (
        !retry &&
        failure instanceof AdminApiError &&
        (failure.code === 404 || failure.code === 40400001)
      )
        setRecovery("not-found");
      else if (retry && definitiveRejection(failure)) clearPending();
      else setRecovery("unknown");
      setError((failure as Error).message);
    } finally {
      if (!controller.signal.aborted) writing.current = false;
      setBusy(false);
    }
  }

  async function restoreBody() {
    const request = submission.current;
    if (!request || busy || recovery !== "not-found") return;
    setError("");
    if (
      !recoveryDocument.trim() ||
      new TextEncoder().encode(recoveryDocument).length > maxBytes
    ) {
      setError(
        "请重新提供不超过256KiB的原始完整平台配置JSON，不是cURL或OpenAPI来源。",
      );
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      const checked = await api<Preview>("/api-imports/preview", {
        method: "POST",
        bodyText: recoveryDocument,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (checked.documentDigest !== request.pending.documentDigest)
        throw new Error(
          "配置摘要与原提交不一致，未发送写入。请提供原始完整配置或继续查询原结果。",
        );
      const bodyText = submissionBody(request.pending, recoveryDocument);
      if (new TextEncoder().encode(bodyText).length > maxBytes)
        throw new Error("原提交请求超过256KiB，未发送写入，请核对完整原文。");
      request.bodyText = bodyText;
      setDocument(recoveryDocument);
      setRecoveryDocument("");
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError((failure as Error).message);
        if (
          failure instanceof AdminApiError &&
          [401, 403, 40100001, 40300001].includes(failure.code)
        )
          setRecovery("unknown");
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const editItem = (item: PreviewItem) => {
    if (busy || recovery) return;
    try {
      const parsed = parseJson<{ apis?: unknown[] }>(document);
      const items = Array.isArray(parsed.apis) ? parsed.apis : [parsed];
      if (item.index >= items.length)
        throw new Error("请在高级配置JSON中修正来源结构。");
      setError("");
      releaseGuard.current?.();
      setEditing(item);
      setDetail(null);
      setItemJson(
        item.after ? null : stringifyJson(items[item.index], 2),
      );
      navigation.navigate(
        { ...navigation.route, apiId: "new", step: "outer" },
        true,
      );
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  const applyItem = async (bodyText: string) => {
    if (!editing) return false;
    try {
      const parsed = parseJson<{ apis?: unknown[] }>(document);
      const replacement = parseJson(bodyText);
      if (Array.isArray(parsed.apis)) parsed.apis[editing.index] = replacement;
      else if (editing.index !== 0) throw new Error("来源结构已变化，请重新预览。");
      const next = stringifyJson(Array.isArray(parsed.apis) ? parsed : replacement);
      if (new TextEncoder().encode(next).length > maxBytes)
        throw new Error("修正后超过256KiB，请拆小批次。");
      const retained = selectedItems.filter(
        (item) => item.index !== editing.index,
      );
      setDocument(next);
      setEditing(null);
      setItemJson(null);
      await loadPreview(next, retained);
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    }
  };
  if (editing && itemJson === null)
    return (
      <CandidateEditor
        key={editing.index}
        api={api}
        initial={editing.after as Partial<ApiDefinition>}
        title={`修正第 ${editing.index + 1} 项 · ${resultLabels.current[editing.index]}`}
        description="确认候选后重新核对本批，不直接写入草稿；覆盖已有 API 需重新选择。"
        reminders={editing.errors}
        backLabel="返回差异预览"
        onCancel={() => {
          if (window.confirm("放弃本次未确认修改并返回差异预览？")) setEditing(null);
        }}
        onPrepared={applyItem}
      />
    );
  const returnToSource = () => {
    if (busy || recovery !== null) return;
    if (editing && itemJson !== null && !window.confirm("放弃本项未应用的 JSON 修改并返回？")) return;
    releaseGuard.current?.();
    onReturn({
      document,
      canEditCandidates: !!lastPreview.current && lastPreview.current.items.every((item) => !!item.after),
      committed: result?.committed === true,
      source:
        source ??
        (restored.pending
          ? {
              kind: restored.pending.sourceKind,
              digest: restored.pending.sourceDigest,
            }
          : undefined),
    });
  };
  const toggle = (index: number, checked: boolean) =>
    setSelected((current) => (checked ? [...current, index] : current.filter((value) => value !== index)));
  return (
    <section className="op-import" aria-labelledby="import-title">
      <PageHeader
        breadcrumb={
          <Button type="link" size="small" className="op-import__back" icon={<ArrowLeftOutlined aria-hidden />} disabled={busy || recovery !== null} onClick={returnToSource}>
            {returnLabel ?? (result?.committed ? "返回并刷新 API 目录" : "返回 API 目录")}
          </Button>
        }
        title={<span id="import-title">核对并写入草稿</span>}
        meta={
          <span className="op-muted">
            {initialDocument
              ? "已根据本批配置读取差异；已有 API 需主动勾选覆盖。"
              : "上传或粘贴平台导出的接口配置 JSON，每批 1–20 项、最多 256 KiB。"}{" "}
            仅更新草稿；权限组须已存在并启用。更新会完整替换契约字段，已发布版本保持原状。
          </span>
        }
      />
      {!operatorKey && (
        <Alert className="op-config__banner" type="info" showIcon role="note" title="当前入口未提供可绑定的登录身份，恢复信息仅在当前页面保留；提交结果确认前请勿刷新。" />
      )}
      <details
        className="op-import__card op-import__details"
        open={sourceOpen}
        onToggle={(event) => setSourceOpen(event.currentTarget.open)}
      >
        <summary>接口配置 JSON（高级）</summary>
        <fieldset className="op-import__fieldset" disabled={busy || recovery !== null}>
          <div className="op-import__toolbar">
            <input
              ref={fileInput}
              type="file"
              className="op-visually-hidden"
              aria-label="上传接口配置 JSON 文件"
              tabIndex={-1}
              accept=".json,application/json"
              disabled={busy}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (file.size > maxBytes) {
                  setError("文件超过 256 KiB，请拆小文件。");
                  return;
                }
                setBusy(true);
                try {
                  replaceDocument(await file.text());
                } catch {
                  setError("无法读取文件，请重新选择或粘贴文本。");
                } finally {
                  setBusy(false);
                }
              }}
            />
            <Button size="small" icon={<UploadOutlined aria-hidden />} disabled={busy} onClick={() => fileInput.current?.click()}>
              上传文件
            </Button>
            <span className="op-muted">来源与预览仅保留在当前页面；修改文本或更换文件会清除旧预览和勾选。</span>
          </div>
          <Input.TextArea
            aria-label="接口配置 JSON"
            className="op-import__code"
            autoSize={{ minRows: 10, maxRows: 24 }}
            spellCheck={false}
            disabled={busy}
            value={document}
            onChange={(event) => replaceDocument(event.target.value)}
          />
          <div className="op-import__row">
            <Button type="primary" disabled={busy} loading={busy && !recovery} onClick={() => void loadPreview()}>
              预览导入差异
            </Button>
          </div>
        </fieldset>
      </details>
      {busy && !recovery && <p role="status" className="op-muted">正在核对配置…</p>}
      {initialDocument && !preview && !busy && !recovery && !result && (
        <div className="op-import__row">
          <Button onClick={() => void loadPreview()}>重新读取导入差异</Button>
        </div>
      )}
      {recovery && (
        <Alert
          className="op-config__banner"
          type="warning"
          showIcon
          role="status"
          title={`提交结果未知。请先查询原提交，保留本页直到结果确认。提交标识：${submission.current?.pending.key ?? "—"}`}
          description={
            <div className="op-import__recovery">
              <p>请使用原提交账号恢复。本 tab 只保存提交标识、摘要和原选择，不保存来源原文、请求正文或秘密。</p>
              <div className="op-import__row">
                <Button disabled={busy || !submission.current} onClick={() => void recover(false)}>
                  查询原提交结果
                </Button>
                {recovery === "not-found" && submission.current?.bodyText && (
                  <Button disabled={busy} onClick={() => void recover(true)}>
                    使用原标识和原内容重试
                  </Button>
                )}
              </div>
              {recovery === "not-found" && submission.current && !submission.current.bodyText && (
                <div className="op-import__restore">
                  <p>
                    暂未查到原结果。刷新后原正文已清除；可继续查询，或重新提供原提交的完整平台配置 JSON。摘要一致后只允许沿用原提交标识、原选择及原修订重试。
                  </p>
                  <div className="op-import__toolbar">
                    <input
                      ref={recoveryFileInput}
                      type="file"
                      className="op-visually-hidden"
                      aria-label="重新上传原完整配置"
                      tabIndex={-1}
                      accept=".json,application/json"
                      disabled={busy}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file || busy) return;
                        if (file.size > maxBytes) {
                          setError("原配置超过256KiB，请核对文件。");
                          return;
                        }
                        setBusy(true);
                        setError("");
                        try {
                          setRecoveryDocument(await file.text());
                        } catch {
                          setError("读取原配置失败，请重新选择。");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                    <Button size="small" icon={<UploadOutlined aria-hidden />} disabled={busy} onClick={() => recoveryFileInput.current?.click()}>
                      重新上传原完整配置
                    </Button>
                  </div>
                  <Input.TextArea
                    aria-label="原提交的完整平台配置 JSON"
                    className="op-import__code"
                    rows={8}
                    disabled={busy}
                    value={recoveryDocument}
                    onChange={(event) => setRecoveryDocument(event.target.value)}
                  />
                  <div className="op-import__row">
                    <Button type="primary" disabled={busy || !recoveryDocument.trim()} onClick={() => void restoreBody()}>
                      核对原配置摘要
                    </Button>
                  </div>
                </div>
              )}
            </div>
          }
        />
      )}
      <ErrorFeedback error={error} />
      {editing && itemJson !== null && (
        <div className="op-import__card" role="group" aria-label="修正单项配置">
          <h2 className="op-import__title">修正第 {editing.index + 1} 项配置</h2>
          <p className="op-muted">该项结构暂不能进入表单；只需修正本项，其他条目保留。</p>
          {editing.errors.length > 0 && (
            <ul className="op-import__list op-import__list--error">
              {editing.errors.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          )}
          <Input.TextArea
            aria-label="本项配置 JSON"
            className="op-import__code"
            value={itemJson}
            onChange={(event) => setItemJson(event.target.value)}
            autoSize={{ minRows: 12, maxRows: 28 }}
            spellCheck={false}
          />
          <StickyActionBar>
            <Button
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setItemJson(null);
                setError("");
              }}
            >
              取消本项修改
            </Button>
            {hasSourceRevision && (
              <Button disabled={busy} onClick={() => {
                try {
                  const value = parseJson<Record<string, unknown>>(itemJson);
                  delete value.expectedRevision;
                  void applyItem(stringifyJson(value, 2));
                } catch (failure) { setError((failure as Error).message); }
              }}>
                移除 expectedRevision 并重新预览
              </Button>
            )}
            <Button type="primary" disabled={busy} onClick={() => void applyItem(itemJson)}>
              应用并重新预览
            </Button>
          </StickyActionBar>
        </div>
      )}
      {preview && !editing && (
        <div className="op-import__card" role="group" aria-label="差异预览">
          <div className="op-import__heading">
            <h2 className="op-import__title">
              {detail ? "核对单项差异" : `差异预览 · ${preview.items.length} 项`}
              <FieldHelp label="导入选择与覆盖">
                新增项可批量选择；已有 API 必须主动选择覆盖。更新完整替换草稿配置，选中集全部成功或全部回滚，已发布版本保持。错误和无变化条目不写入。
              </FieldHelp>
            </h2>
            {detail ? (
              <Button onClick={() => setDetail(null)}>返回差异列表</Button>
            ) : (
              <Button
                disabled={busy || !!recovery}
                onClick={() =>
                  setSelected((current) => [
                    ...new Set([...current, ...preview.items.filter((item) => item.change === "CREATE").map((item) => item.index)]),
                  ])
                }
              >
                选择全部新增
              </Button>
            )}
          </div>
          {!detail ? (
            <Table<PreviewItem>
              rowKey="index"
              size="small"
              pagination={false}
              dataSource={preview.items}
              columns={[
                {
                  title: "选择",
                  width: 68,
                  render: (_, item) => (
                    <Checkbox
                      aria-label={`第 ${item.index + 1} 项 · ${changeLabels[item.change]}`}
                      disabled={busy || !!recovery || item.change === "ERROR" || item.change === "UNCHANGED"}
                      checked={selected.includes(item.index)}
                      onChange={(event) => toggle(item.index, event.target.checked)}
                    />
                  ),
                },
                {
                  title: "API / 调用标识",
                  render: (_, item) => (
                    <div className="op-import__cell">
                      <strong>{(item.after as ApiDefinition | null)?.name ?? `第 ${item.index + 1} 项`}</strong>
                      <code className="op-import__code-text">
                        {item.operation ? `${item.operation.service}/${item.operation.version}/${item.operation.method}` : "尚未识别调用标识，请先修正本项 JSON"}
                      </code>
                    </div>
                  ),
                },
                {
                  title: "变化",
                  width: 150,
                  render: (_, item) => (
                    <div className="op-import__cell">
                      <StatusBadge tone={changeTones[item.change]}>{changeLabels[item.change]}</StatusBadge>
                      {stringifyJson(item.expectedRevision) !== "0" && (
                        <span className="op-muted">当前草稿 r{stringifyJson(item.expectedRevision)}</span>
                      )}
                    </div>
                  ),
                },
                {
                  title: "校验与提醒",
                  render: (_, item) => (
                    <div className="op-import__cell">
                      {item.errors.length ? (
                        <ul className="op-import__list op-import__list--error">
                          {item.errors.map((message, index) => (
                            <li key={index}>{message}</li>
                          ))}
                        </ul>
                      ) : (
                        <span>{item.change === "UNCHANGED" ? "无变化，无需写入" : item.change === "UPDATE" ? "需主动选择覆盖" : "可写入新草稿"}</span>
                      )}
                      {item.warnings?.map((warning, index) => (
                        <span className="op-muted" key={index}>
                          {warning}
                        </span>
                      ))}
                      {Boolean(item.after) &&
                        responseSchemaSuggestion(
                          adapterForm((item.after as ApiDefinition).responseAdapter),
                          stringifyJson((item.after as ApiDefinition).responseSchema ?? null),
                        ) && <span className="op-import__warning">返回结构可能仍包含 Response 外壳，请先「修正此项」，核对提取后的业务数据结构。</span>}
                    </div>
                  ),
                },
                {
                  title: "操作",
                  width: 160,
                  render: (_, item) => (
                    <div className="op-import__row">
                      <Button type="link" size="small" disabled={busy} onClick={() => setDetail(item)}>
                        字段差异
                      </Button>
                      <Button type="link" size="small" disabled={busy || !!recovery} onClick={() => editItem(item)}>
                        修正此项
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          ) : (
            <>
              <div className="op-import__row">
                <strong>{resultLabels.current[detail.index]}</strong>
                <StatusBadge tone={changeTones[detail.change]}>{changeLabels[detail.change]}</StatusBadge>
                <span className="op-muted">预期修订 {stringifyJson(detail.expectedRevision)}</span>
                <Button disabled={busy || !!recovery} onClick={() => editItem(detail)}>
                  修正此项
                </Button>
                {["CREATE", "UPDATE"].includes(detail.change) && (
                  <Checkbox
                    checked={selected.includes(detail.index)}
                    disabled={busy || !!recovery}
                    onChange={(event) => toggle(detail.index, event.target.checked)}
                  >
                    选中此项写入
                  </Checkbox>
                )}
              </div>
              {!!detail.errors.length && (
                <ul className="op-import__list op-import__list--error">
                  {detail.errors.map((message, index) => (
                    <li key={index}>{message}</li>
                  ))}
                </ul>
              )}
              {Boolean(detail.after) && (
                <PublicationDiff
                  api={api}
                  before={detail.before as ApiDefinition | null}
                  after={detail.after as ApiDefinition}
                  beforeLabel="当前草稿"
                  afterLabel="候选完整替换"
                />
              )}
            </>
          )}
          <StickyActionBar
            status={
              <span>
                <strong>
                  已选 {selectedItems.length} 项 · 新增 {selectedItems.filter((item) => item.change === "CREATE").length} / 覆盖{" "}
                  {selectedItems.filter((item) => item.change === "UPDATE").length}
                </strong>{" "}
                <span className="op-muted">
                  {selectedItems.length
                    ? "完整替换选中草稿，全部成功或全部回滚；不会直接发布。"
                    : "请选择要写入的项；错误及无变化不写入。"}
                </span>
              </span>
            }
          >
            <Button
              type="primary"
              aria-label="确认写入草稿"
              disabled={busy || !!recovery || !selectedItems.length}
              loading={busy}
              onClick={() => void confirm()}
            >
              确认写入草稿（{selectedItems.length}）
            </Button>
          </StickyActionBar>
        </div>
      )}
      {result && (
        <div className="op-import__card" role="group" aria-label="导入结果">
          <div className="op-import__heading">
            <h2 className="op-import__title">{result.committed ? "选中集已写入草稿" : "选中集未写入，请重新预览核对"}</h2>
            {!result.committed && (
              <Button disabled={busy} onClick={() => void loadPreview()}>
                重新预览本批
              </Button>
            )}
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="index"
            dataSource={result.items}
            columns={[
              {
                title: "API",
                render: (_, item) => resultLabels.current[item.index] ?? `第 ${item.index + 1} 项`,
              },
              {
                title: "结果",
                render: (_, item) => (
                  <div className="op-import__cell">
                    <span>{changeLabels[item.change as keyof typeof changeLabels] ?? item.change}</span>
                    {item.revision !== null && <span className="op-muted">修订：{stringifyJson(item.revision)}</span>}
                    {item.errors.length > 0 && <span className="op-import__error">{item.errors.join("；")}</span>}
                  </div>
                ),
              },
              {
                title: "继续",
                render: (_, item) =>
                  item.apiId ? (
                    onOpen ? (
                      <Button type="link" size="small" onClick={() => onOpen(item.apiId!)}>
                        打开 API 继续测试与发布
                      </Button>
                    ) : (
                      <span>API ID：{item.apiId}</span>
                    )
                  ) : (
                    "请先修正错误"
                  ),
              },
            ]}
          />
        </div>
      )}
    </section>
  );
}
