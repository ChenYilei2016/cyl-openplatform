import { createRequestKey } from "../shared/requestKey";
import { SearchOutlined } from "@ant-design/icons";
import { ErrorFeedback, usePage } from "@cyl/open-platform-web-shared/components";
import EmployeeProfileSearch, { type EmployeeProfileOption } from "@cyl/open-platform-web-shared/employees/EmployeeProfileSearch";
import { parseJson, stringifyJson } from "@cyl/open-platform-web-shared/json";
import { FieldLabel, FormSection, IdText, PersonTag, StickyActionBar } from "@cyl/open-platform-web-shared/ui/components";
import { useDebouncedCallback } from "@cyl/open-platform-web-shared/ui/list";
import { Alert, Button, Input, Modal, Pagination, Select, Steps, Tag } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminApiError, type AdminApi } from "../access/api";
import type { Binding } from "../catalog/BindingEditor";
import PublicationDiff from "../publication/PublicationDiff";
import { publicationTime } from "../publication/publicationDisplay";
import SnapshotView from "../publication/SnapshotView";
import type { EffectiveRelease, ReleaseDetail, ReleaseSummary } from "../publication/types";
import TransferDetail, { TransferActions } from "./TransferDetail";
import type { ConnectionDirectory, ConnectionOption, EnvironmentPreview, OutgoingTransfer, Target } from "./types";
import "./transfers.css";

const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"];

interface PendingTransfer {
  id: string;
  body: string;
  storeKey: string;
  releaseId: string;
  targetId: string;
}

/** 会话按 API 保留未决正文，原传输号及来源始终从固定正文恢复。 */
function readPendingTransfer(
  store: Map<string, string>,
  source?: Pick<EffectiveRelease, "apiId" | "releaseId">,
): PendingTransfer | null {
  for (const [storeKey, body] of store) {
    const request = parseJson<{
      transferId: string;
      releaseId: string;
      targetId: string;
    }>(body);
    if (
      !source ||
      storeKey === `api:${source.apiId}` ||
      request.releaseId === source.releaseId
    ) {
      return {
        id: request.transferId,
        body,
        storeKey,
        releaseId: request.releaseId,
        targetId: request.targetId,
      };
    }
  }
  return null;
}

export default function EnvironmentReleasePanel({
  api,
  pendingTransfers,
  source,
  canPublish = true,
  initialReleaseId,
  onStateChange,
}: {
  api: AdminApi;
  pendingTransfers?: Map<string, string>;
  source?: EffectiveRelease;
  canPublish?: boolean;
  initialReleaseId?: string;
  onStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const [stage, setStage] = useState(0);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [targetError, setTargetError] = useState("");
  const [revision, setRevision] = useState(0);
  const [selectedRelease, setSelectedRelease] = useState<ReleaseDetail | null>(
    null,
  );
  const snapshot = source?.snapshot ?? selectedRelease?.snapshot;
  const releaseId = source?.releaseId ?? selectedRelease?.id ?? "";
  const sourceBinding = snapshot?.binding as Binding | undefined;
  const [targetId, setTargetId] = useState("");
  const [targetOwner, setTargetOwner] = useState<EmployeeProfileOption | null>(
    null,
  );
  const [choosingOwner, setChoosingOwner] = useState(false);
  const [binding, setBinding] = useState("");
  const [bindingError, setBindingError] = useState("");
  const advanced = useRef<HTMLDetailsElement>(null);
  const bindingInput = useRef<TextAreaRef>(null);
  const showBindingError = (message: string) => {
    setBindingError(message);
    setStage(0);
  };
  const [connection, setConnection] = useState<ConnectionOption | null>(null);
  const [httpUrl, setHttpUrl] = useState<string | null>(null);
  const [httpMethod, setHttpMethod] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [candidate, setCandidate] = useState<{
    preview: EnvironmentPreview;
    body: string;
    context: string;
  } | null>(null);
  const previewRequest = useRef<AbortController | null>(null);
  const operationContext = useRef(0);
  const previewContext = stringifyJson([
    releaseId,
    targetId,
    targetOwner?.id,
    binding,
    connection,
    httpUrl,
    httpMethod,
    comment,
  ]);
  const preview =
    candidate?.context === previewContext ? candidate.preview : null;
  const [confirmation, setConfirmation] = useState(false);
  const [localPendingTransfers] = useState(() => new Map<string, string>());
  const pendingStore = pendingTransfers ?? localPendingTransfers;
  const [pending, setPendingState] = useState(() =>
    readPendingTransfer(pendingStore, source),
  );
  const [originalChecked, setOriginalChecked] = useState(false);
  const clearPending = (request: PendingTransfer) => {
    // 旧工作区的晚到回调只能清理自己的正文，不能删除同 API 后来的未决发送。
    if (pendingStore.get(request.storeKey) === request.body)
      pendingStore.delete(request.storeKey);
    setPendingState((current) =>
      current?.id === request.id && current.body === request.body
        ? null
        : current,
    );
  };
  const [detail, setDetail] = useState<OutgoingTransfer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");
  useEffect(() => {
    if (bindingError && !busy && stage === 0) {
      if (advanced.current) advanced.current.open = true;
      bindingInput.current?.focus();
    }
  }, [bindingError, busy, stage]);
  const locked = busy || !!pending;
  const dirty =
    busy ||
    !!pending ||
    (!detail &&
      !!(
        (selectedRelease && selectedRelease.id !== initialReleaseId) ||
        targetId ||
        targetOwner ||
        binding ||
        connection ||
        httpUrl ||
        httpMethod ||
        comment
      ));
  useEffect(() => {
    onStateChange?.({ dirty, busy });
  }, [dirty, busy, onStateChange]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);
  useEffect(() => {
    const controller = new AbortController();
    setTargetError("");
    void api<Target[]>("/environment-releases/targets", {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setTargets(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setTargetError(error.message);
      });
    return () => controller.abort();
  }, [api, revision]);
  useEffect(() => {
    setCandidate(null);
    setConfirmation(false);
    setStage(0);
    if (previewRequest.current) {
      previewRequest.current.abort();
      previewRequest.current = null;
      setBusy(false);
    }
  }, [previewContext]);
  useEffect(() => setPreviewError(""), [previewContext]);
  useEffect(() => () => previewRequest.current?.abort(), []);
  useEffect(() => {
    operationContext.current += 1;
    setPendingState(readPendingTransfer(pendingStore, source));
    setOriginalChecked(false);
    setDetail(null);
    setBusy(false);
    setTargetId("");
    setTargetOwner(null);
    setChoosingOwner(false);
    setConnection(null);
    setBinding("");
    setHttpUrl(null);
    setHttpMethod(null);
    setComment("");
    return () => {
      operationContext.current += 1;
    };
  }, [pendingStore, source?.apiId]);
  const invalidate = () => {
    setCandidate(null);
    setConfirmation(false);
    setError("");
    setPreviewError("");
  };
  const selectRelease = useCallback((value: ReleaseDetail | null) => {
    setSelectedRelease(value);
    setConnection(null);
    setBinding("");
    setHttpUrl(null);
    setHttpMethod(null);
    setCandidate(null);
    setConfirmation(false);
    setError("");
  }, []);
  const createPreviewBody = () => {
    if (!releaseId || !targetId)
      throw new Error("请选择固定来源发布与目标环境。");
    setBindingError("");
    let override;
    try {
      override = binding.trim() ? parseJson(binding) : undefined;
    } catch {
      const message = "目标绑定 JSON 格式不正确，请检查后重新预览。";
      showBindingError(message);
      throw new Error(message);
    }
    if (
      override !== undefined &&
      (!override || typeof override !== "object" || Array.isArray(override))
    ) {
      showBindingError("绑定覆盖必须是 JSON 对象。");
      throw new Error("绑定覆盖必须是 JSON 对象。");
    }
    if (sourceBinding?.protocol === "DUBBO") {
      if (!connection || !sourceBinding.dubbo)
        throw new Error("请明确选择目标环境的 Dubbo 连接与固定修订。");
      override = {
        ...sourceBinding,
        dubbo: {
          ...sourceBinding.dubbo,
          connectionId: connection.id,
          connectionRevision: connection.revision,
        },
      };
    } else if (
      !binding.trim() &&
      sourceBinding?.http &&
      (httpUrl !== null || httpMethod !== null)
    ) {
      override = {
        ...sourceBinding,
        http: {
          ...sourceBinding.http,
          url: httpUrl ?? sourceBinding.http.url,
          ...(httpUrl === null ? {} : {targetMode: "URL" as const}),
          method: httpMethod ?? sourceBinding.http.method,
        },
      };
    }
    const fields = stringifyJson({
      releaseId,
      targetId,
      targetOwnerId: targetOwner?.id,
    });
    // 高级绑定保持原文，由发布预览的严格JSON读取器校验重复键、数值和结构。
    const bindingText =
      binding.trim() && sourceBinding?.protocol !== "DUBBO"
        ? binding
        : override === undefined
          ? null
          : stringifyJson(override);
    const body =
      bindingText === null
        ? fields
        : `${fields.slice(0, -1)},"binding":${bindingText}}`;
    if (new TextEncoder().encode(body).length > 256 * 1024) {
      showBindingError(
        "目标绑定过大，发送正文不能超过 256 KiB。请缩减后重新预览。",
      );
      throw new Error("正文不能超过 256 KiB。");
    }
    return body;
  };
  const loadPreview = async () => {
    previewRequest.current?.abort();
    const controller = new AbortController();
    previewRequest.current = controller;
    setBusy(true);
    invalidate();
    setDetail(null);
    try {
      const body = createPreviewBody();
      const value = await api<EnvironmentPreview>(
        "/environment-releases/preview",
        { method: "POST", bodyText: body, signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        setCandidate({ preview: value, body, context: previewContext });
        setStage(1);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setPreviewError((failure as Error).message);
    } finally {
      if (previewRequest.current === controller) {
        previewRequest.current = null;
        setBusy(false);
      }
    }
  };
  const send = async () => {
    if (!canPublish) {
      setError("当前已无 API 发布权限，请联系总管理员。发布输入已保留。");
      return;
    }
    const context = operationContext.current;
    setBusy(true);
    setError("");
    setConfirmation(false);
    setOriginalChecked(false);
    let request = pending;
    try {
      if (!request) {
        if (!preview || !candidate || !snapshot)
          throw new Error("请重新预览目标差异。");
        const outstanding = readPendingTransfer(pendingStore, {
          apiId: snapshot.id,
          releaseId,
        });
        if (outstanding) {
          setPendingState(outstanding);
          throw new Error("此 API 已有结果未确认的原传输，请先查询原传输。");
        }
        const id = createRequestKey();
        const submission = stringifyJson({
          transferId: id,
          expectedRevision: preview.expectedRevision,
          previewDigest: preview.previewDigest,
          comment,
        });
        const body = `${candidate.body.slice(0, -1)},${submission.slice(1)}`;
        if (new TextEncoder().encode(body).length > 256 * 1024) {
          showBindingError(
            "目标绑定过大，发送正文不能超过 256 KiB。请缩减后重新预览。",
          );
          throw new Error("正文不能超过 256 KiB。");
        }
        request = {
          id,
          storeKey: `api:${snapshot.id}`,
          releaseId,
          targetId,
          body,
        };
        pendingStore.set(request.storeKey, request.body);
        setPendingState(request);
      }
      const result = await api<OutgoingTransfer>("/environment-releases", {
        method: "POST",
        bodyText: request.body,
      });
      const ownsPending = pendingStore.get(request.storeKey) === request.body;
      if (
        result.deliveryState === "ACCEPTED" ||
        result.deliveryState === "REJECTED"
      )
        clearPending(request);
      if (context !== operationContext.current || !ownsPending) return;
      setDetail(result);
      setStage(2);
      setCandidate(null);
      setRevision((value) => value + 1);
    } catch (failure) {
      const ownsPending =
        !request || pendingStore.get(request.storeKey) === request.body;
      if (
        request &&
        failure instanceof AdminApiError &&
        [400, 403, 409, 422].includes(
          failure.code < 1000
            ? failure.code
            : Math.floor(failure.code / 100000),
        )
      )
        clearPending(request);
      if (context !== operationContext.current || !ownsPending) return;
      setError((failure as Error).message);
      setCandidate(null);
      setStage(0);
    } finally {
      if (context === operationContext.current) setBusy(false);
    }
  };
  const loadTransfer = async (id: string, action?: "retry" | "refresh") => {
    const context = operationContext.current;
    const request = pending?.id === id ? pending : null;
    setBusy(true);
    setError("");
    try {
      // 重试前先读取原记录，已受理或拒绝的传输不能再发一遍。
      let value = await api<OutgoingTransfer>(
        `/environment-releases/${encodeURIComponent(id)}`,
      );
      const ownsPending =
        !request || pendingStore.get(request.storeKey) === request.body;
      const settledByRead =
        !!request && ["ACCEPTED", "REJECTED"].includes(value.deliveryState);
      if (request && settledByRead) clearPending(request);
      if (context !== operationContext.current || !ownsPending) return;
      if (
        action === "refresh" ||
        (action === "retry" &&
          ["READY", "UNKNOWN"].includes(value.deliveryState))
      ) {
        value = await api<OutgoingTransfer>(
          `/environment-releases/${encodeURIComponent(id)}/${action}`,
          { method: "POST" },
        );
        const stillOwnsPending =
          !request ||
          pendingStore.get(request.storeKey) === request.body ||
          (settledByRead && !pendingStore.has(request.storeKey));
        if (request && ["ACCEPTED", "REJECTED"].includes(value.deliveryState))
          clearPending(request);
        if (context !== operationContext.current || !stillOwnsPending) return;
      }
      setDetail(value);
      setStage(2);
      if (request) {
        setCandidate(null);
        setOriginalChecked(
          !["ACCEPTED", "REJECTED"].includes(value.deliveryState),
        );
      }
      if (action) setRevision((value) => value + 1);
    } catch (failure) {
      if (
        context !== operationContext.current ||
        (request && pendingStore.get(request.storeKey) !== request.body)
      )
        return;
      if (
        !action &&
        request &&
        failure instanceof AdminApiError &&
        (failure.code === 404 || Math.floor(failure.code / 100000) === 404)
      ) {
        setOriginalChecked(true);
        setError("暂未查到原传输记录，可用原传输号和原正文重试。");
      } else setError((failure as Error).message);
    } finally {
      if (context === operationContext.current) setBusy(false);
    }
  };
  const hint = !releaseId
    ? "请选择来源快照"
    : !targetId
      ? "请选择目标环境"
      : sourceBinding?.protocol === "DUBBO" && !connection
        ? "请选择目标 Dubbo 连接"
        : "下一步只读核对目标，不会提交发布";
  const detailTarget = detail ? targets?.find((target) => target.id === detail.request.targetEnvironment) : undefined;
  return (
    <section className="op-transfer-setup" aria-label="跨环境发布">
      <Steps size="small" current={pending ? 2 : stage} items={[{ title: "选择来源与目标" }, { title: "核对固定差异" }, { title: "跟踪目标结果" }]} />
      <ErrorFeedback error={error} />
      {previewError && (
        <Alert
          type="error"
          showIcon
          title="目标预览未通过"
          description={<div className="feedback-detail">{previewError}</div>}
          closable={{ "aria-label": "关闭预览错误" }}
          onClose={() => setPreviewError("")}
          action={<Button disabled={locked || !canPublish} onClick={() => void loadPreview()}>重新预览</Button>}
        />
      )}
      <div hidden={!!pending || stage > 0} className="op-transfer-setup__stage">
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
        {!targets && !targetError && (
          <p role="status" className="op-muted">
            正在读取目标环境…
          </p>
        )}
        {targets?.length === 0 && <Alert type="warning" showIcon role="status" title="尚未配置可发送的目标环境，请联系平台维护者配置后重试。" />}
        <FormSection title="来源 · 固定发布快照" description="只发送这份已通过的固定快照，不含后续草稿；授权、凭据及目标独立开关不随配置迁移。" columns={1}>
          {!source && <ReleasePicker api={api} busy={locked} revision={revision} initialId={initialReleaseId} onSelect={selectRelease} />}
          {snapshot && (
            <div className="op-transfer__source">
              <strong>{snapshot.name}</strong>
              <span className="op-muted">
                {snapshot.service}/{snapshot.version}/{snapshot.method} · r{stringifyJson(snapshot.draftRevision)}
              </span>
              <span className="op-transfer__label">
                <span className="op-muted">固定发布</span>
                <IdText value={releaseId} label="固定发布编号" maxChars={40} />
              </span>
            </div>
          )}
        </FormSection>
        <FormSection title="目标 · 环境与接入" description="目标需已配置同名分类、启用的权限组及人员档案；不同环境人员引用通常不同，请按姓名选择目标负责人。审核规则由目标决定，预览时实时核对。" columns={1}>
          {!!targets?.length && (
            <>
              <div className="op-transfer__field">
                <FieldLabel label="目标环境" required />
                <Select
                  aria-label="目标环境"
                  value={targetId || undefined}
                  placeholder="请选择目标环境"
                  disabled={locked}
                  options={targets.map((target) => ({ value: target.id, label: `${target.name}（${target.id}）` }))}
                  onChange={(value: string) => {
                    setTargetId(value);
                    setTargetOwner(null);
                    setChoosingOwner(false);
                    setConnection(null);
                    invalidate();
                  }}
                />
              </div>
              {!releaseId && <p className="op-muted">先选择来源快照，再核对目标接入配置。</p>}
              {releaseId && targetId && (
                <>
                  {snapshot && (
                    <details open={snapshot.scopeCodes.length <= 6}>
                      <summary>目标需启用的权限组（{snapshot.scopeCodes.length}）</summary>
                      <p className="op-muted">按代码核对，名称相同不代表同一权限组。跨环境发布不会自动创建权限组。</p>
                      <div>
                        {snapshot.scopeCodes.map((code) => <Tag key={code}>{code}</Tag>)}
                        {!snapshot.scopeCodes.length && <span>当前固定快照未配置权限组，请在来源配置并发布新快照。</span>}
                      </div>
                    </details>
                  )}
                  {sourceBinding?.protocol === "DUBBO" && (
                    <TargetConnectionPicker
                      key={targetId}
                      api={api}
                      targetId={targetId}
                      disabled={locked}
                      selected={connection}
                      onSelect={(value) => {
                        setConnection(value);
                        invalidate();
                      }}
                    />
                  )}
                  {sourceBinding?.protocol === "HTTP" && sourceBinding.http && (
                    <div className="op-transfer__http">
                      <div className="op-transfer__field">
                        <FieldLabel label="目标环境固定 URL（可选覆盖服务名发现）" />
                        <Input
                          type="url"
                          aria-label="目标环境固定 URL（可选覆盖服务名发现）"
                          required={sourceBinding.http.targetMode !== "SERVICE_NAME"}
                          value={httpUrl ?? (sourceBinding.http.targetMode === "SERVICE_NAME" ? "" : (sourceBinding.http.url ?? ""))}
                          disabled={locked || !!binding.trim()}
                          onChange={(event) => {
                            setHttpUrl(event.target.value === "" && sourceBinding.http?.targetMode === "SERVICE_NAME" ? null : event.target.value);
                            invalidate();
                          }}
                        />
                      </div>
                      <div className="op-transfer__field">
                        <FieldLabel label="目标 HTTP 方法" />
                        <Select
                          aria-label="目标 HTTP 方法"
                          value={httpMethod ?? sourceBinding.http.method}
                          disabled={locked || !!binding.trim()}
                          options={httpMethods.map((method) => ({ value: method, label: method }))}
                          onChange={(value: string) => {
                            setHttpMethod(value);
                            invalidate();
                          }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="op-transfer__owner">
                    <span className="op-transfer__label">
                      <span className="op-muted">目标负责人</span>
                      {targetOwner ? <PersonTag name={targetOwner.displayName} employeeNo={targetOwner.employeeNo} id={targetOwner.id} /> : <span>沿用来源人员引用</span>}
                    </span>
                    <Button size="small" disabled={locked} onClick={() => setChoosingOwner((value) => !value)}>
                      {choosingOwner ? "收起人员选择" : "选择目标负责人"}
                    </Button>
                  </div>
                  {choosingOwner && (
                    <EmployeeProfileSearch
                      key={targetId}
                      api={api}
                      path={`/environment-releases/targets/${encodeURIComponent(targetId)}/owners`}
                      tenantLabel="目标环境的当前租户"
                      onSelect={(person) => {
                        setTargetOwner(person);
                        setChoosingOwner(false);
                        invalidate();
                      }}
                    />
                  )}
                  {sourceBinding?.protocol !== "DUBBO" && (
                    <details ref={advanced} className="op-transfer__fold">
                      <summary>目标准备与高级配置</summary>
                      <div className="op-transfer__field">
                        <FieldLabel label="目标绑定覆盖 JSON（可选）" />
                        <Input.TextArea
                          ref={bindingInput}
                          aria-label="目标绑定覆盖 JSON（可选）"
                          aria-invalid={!!bindingError}
                          aria-describedby={bindingError ? "transfer-binding-error" : undefined}
                          className="op-transfer__code"
                          rows={7}
                          value={binding}
                          disabled={locked}
                          onChange={(event) => {
                            setBinding(event.target.value);
                            setBindingError("");
                            invalidate();
                          }}
                        />
                        {bindingError && (
                          <span id="transfer-binding-error" role="status" className="op-transfer__field-error">
                            {bindingError}
                          </span>
                        )}
                        <span className="op-muted">留空沿用上方配置；填写时完整替换内部绑定。</span>
                      </div>
                    </details>
                  )}
                  <div className="op-transfer__field">
                    <FieldLabel label="跨环境发布备注" />
                    <Input.TextArea
                      aria-label="跨环境发布备注"
                      autoSize={{ minRows: 2, maxRows: 4 }}
                      maxLength={500}
                      value={comment}
                      disabled={locked}
                      onChange={(event) => {
                        setComment(event.target.value);
                        invalidate();
                      }}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </FormSection>
        <StickyActionBar status={hint}>
          <Button type="primary" loading={busy} disabled={locked || !canPublish || !releaseId || !targetId || (sourceBinding?.protocol === "DUBBO" && !connection)} onClick={() => void loadPreview()}>
            预览目标差异
          </Button>
        </StickyActionBar>
      </div>
      {pending && (
        <Alert
          type="warning"
          showIcon
          role="status"
          title="发送结果待核对"
          description={`原传输号：${pending.id} · 固定来源发布 ${pending.releaseId} → 目标 ${pending.targetId}。已保留原请求，重试不会换编号或正文。`}
          action={
            <div className="op-transfer__actions">
              <Button size="small" disabled={busy} onClick={() => void loadTransfer(pending.id)}>
                查询原传输
              </Button>
              {originalChecked && (
                <Button size="small" disabled={busy || !canPublish} onClick={() => void send()}>
                  同键重试原发送
                </Button>
              )}
            </div>
          }
        />
      )}
      {preview && !pending && stage === 1 && (
        <section className="op-transfer-setup__stage" aria-labelledby="transfer-preview-title">
          <div className="op-transfer__heading">
            <h3 id="transfer-preview-title">目标差异：{preview.change === "CREATE" ? "首次发布" : preview.change === "UPDATE" ? "更新已有 API" : preview.change}</h3>
            <span className="op-muted">
              目标 {preview.environmentId} · 草稿 r{stringifyJson(preview.expectedRevision)} · {preview.auditRequired ? "发送后需目标审核" : "发送后按目标免审规则处理"}
            </span>
          </div>
          {targetOwner && (
            <span className="op-transfer__label">
              <span className="op-muted">目标负责人</span>
              <PersonTag name={targetOwner.displayName} employeeNo={targetOwner.employeeNo} id={targetOwner.id} />
            </span>
          )}
          {preview.pendingReleaseId && <Alert type="warning" showIcon title="目标已有待审核提交，请先在目标环境处理原提交。" />}
          <PublicationDiff before={preview.before} after={preview.definition} beforeLabel="目标当前草稿" afterLabel="拟发送固定快照" />
          <details className="op-transfer__fold">
            <summary>查看完整目标契约（管理专用）</summary>
            <SnapshotView definition={preview.definition} />
          </details>
          <StickyActionBar status="确认后按上述差异完整替换目标草稿并提交固定发布">
            <Button disabled={busy} onClick={() => setStage(0)}>
              返回调整配置
            </Button>
            <Button type="primary" disabled={busy || !canPublish || !!preview.pendingReleaseId} onClick={() => setConfirmation(true)}>
              核对跨环境发送
            </Button>
          </StickyActionBar>
        </section>
      )}
      <Modal
        open={confirmation}
        title="跨环境发送"
        okText="确认跨环境发送"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: !canPublish }}
        cancelButtonProps={{ disabled: busy }}
        confirmLoading={busy}
        onOk={() => void send()}
        onCancel={() => setConfirmation(false)}
        // 发送失败可能需要把焦点定位到绑定输入，关闭后不再抢回原触发按钮。
        focusTriggerAfterClose={false}
        destroyOnHidden
      >
        <p>{canPublish ? "确认按上述差异完整替换目标草稿并提交固定发布？目标将重新校验修订和审核配置；受理不表示全部节点已生效。" : "当前已无 API 发布权限，不能发送；已填写内容保留。"}</p>
      </Modal>
      {detail && (
        <section className="op-transfer-setup__stage" aria-labelledby="transfer-result-title">
          <div className="op-transfer__heading">
            <h3 id="transfer-result-title">{detail.request.definition?.name ?? "固定快照交付"}</h3>
            <span className="op-muted">
              {detail.request.sourceEnvironment} → {detailTarget?.name ?? detail.request.targetEnvironment}
            </span>
            <span className="op-transfer__actions">
              <TransferActions transfer={detail} busy={busy} canOperate={canPublish} onRefresh={() => void loadTransfer(detail.id, "refresh")} onRetry={() => void loadTransfer(detail.id, "retry")} />
            </span>
          </div>
          <TransferDetail transfer={detail} target={detailTarget} canOperate={canPublish} />
          {detail.deliveryState === "REJECTED" && !pending && (
            <div>
              <Button
                disabled={busy}
                onClick={() => {
                  setDetail(null);
                  setStage(0);
                }}
              >
                调整配置重新预览
              </Button>
            </div>
          )}
        </section>
      )}
    </section>
  );
}

function ReleasePicker({ api, busy, revision, initialId, onSelect }: { api: AdminApi; busy: boolean; revision: number; initialId?: string; onSelect: (release: ReleaseDetail | null) => void }) {
  const [page, setPage] = useState(1);
  const [id, setId] = useState(initialId ?? "");
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<ReleaseDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const releases = usePage<ReleaseSummary>(api, `/publications?page=${page}&pageSize=20&status=APPLIED&query=${encodeURIComponent(filter)}`, revision);
  const search = useDebouncedCallback((value: string) => {
    setFilter(value.trim());
    setPage(1);
  });
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api<ReleaseDetail>(`/publications/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          setPicked(value);
          onSelect(value);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, id, onSelect]);
  const items = releases.data?.items ?? [];
  const options = [
    ...(picked && !items.some((item) => item.id === picked.id) ? [{ value: picked.id, label: `${picked.name} · r${stringifyJson(picked.draftRevision)}` }] : []),
    ...items.map((item) => ({ value: item.id, label: `${item.name} · ${item.service}/${item.version}/${item.method} · r${stringifyJson(item.draftRevision)} · ${publicationTime(item.submittedAt)}` })),
  ];
  return (
    <div className="op-transfer__picker">
      <Input
        allowClear
        aria-label="搜索来源快照"
        prefix={<SearchOutlined aria-hidden />}
        placeholder="按接口名称或 service 搜索已通过发布"
        maxLength={100}
        value={text}
        disabled={busy}
        onChange={(event) => {
          setText(event.target.value);
          search.run(event.target.value);
        }}
        onPressEnter={() => search.flush(text)}
      />
      {releases.error && (
        <Alert
          type="error"
          showIcon
          title={releases.error}
          action={
            <Button size="small" onClick={releases.reload}>
              重新加载
            </Button>
          }
        />
      )}
      <div className="op-transfer__field">
        <FieldLabel label="来源发布快照" required />
        <Select
          aria-label="来源发布快照"
          value={id || undefined}
          placeholder="请选择已通过发布"
          loading={releases.loading || loading}
          disabled={busy || loading}
          options={options}
          notFoundContent={releases.loading ? "正在加载…" : "没有匹配的已通过发布"}
          onChange={(value: string) => {
            onSelect(null);
            setId(value);
          }}
        />
      </div>
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          action={
            <Button
              size="small"
              onClick={() => {
                setId("");
                onSelect(null);
              }}
            >
              重新选择
            </Button>
          }
        />
      )}
      {releases.data && releases.data.total > 20 && <Pagination simple size="small" current={page} pageSize={20} total={releases.data.total} disabled={busy || loading} onChange={setPage} />}
    </div>
  );
}

function TargetConnectionPicker({ api, targetId, disabled, selected, onSelect }: { api: AdminApi; targetId: string; disabled: boolean; selected: ConnectionOption | null; onSelect: (value: ConnectionOption) => void }) {
  const [page, setPage] = useState(1);
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("");
  const connections = usePage<ConnectionOption>(api, `/environment-releases/targets/${encodeURIComponent(targetId)}/dubbo-connections?page=${page}&pageSize=20&query=${encodeURIComponent(filter)}`);
  const directory = connections.data as ConnectionDirectory | null;
  const search = useDebouncedCallback((value: string) => {
    setFilter(value.trim());
    setPage(1);
  });
  const keyOf = (item: ConnectionOption) => `${item.id}:${stringifyJson(item.revision)}`;
  return (
    <section className="op-transfer__picker" aria-label="目标 Dubbo 连接映射">
      <Alert type="info" showIcon role="status" title="必须明确选择目标环境的连接与修订；不会自动沿用来源连接。" />
      <Input
        allowClear
        aria-label="搜索目标 Dubbo 连接"
        prefix={<SearchOutlined aria-hidden />}
        placeholder="按连接名称搜索"
        maxLength={100}
        value={text}
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value);
          search.run(event.target.value);
        }}
        onPressEnter={() => search.flush(text)}
      />
      {connections.error && (
        <Alert
          type="error"
          showIcon
          title={connections.error}
          action={
            <Button size="small" onClick={connections.reload}>
              重新加载
            </Button>
          }
        />
      )}
      {directory && (
        <>
          <div className="op-transfer__field">
            <FieldLabel label="目标 Dubbo 连接" required />
            <Select
              aria-label="目标 Dubbo 连接"
              value={selected ? keyOf(selected) : undefined}
              placeholder="请选择目标连接及修订"
              disabled={disabled}
              notFoundContent="没有可选连接"
              options={[
                ...(selected && !directory.items.some((item) => keyOf(item) === keyOf(selected)) ? [{ value: keyOf(selected), label: `${selected.name} · 已选 r${stringifyJson(selected.revision)}` }] : []),
                ...directory.items.map((item) => ({ value: keyOf(item), label: `${item.name} · r${stringifyJson(item.revision)}` })),
              ]}
              onChange={(value: string) => {
                const item = directory.items.find((candidate) => keyOf(candidate) === value);
                if (item) onSelect(item);
              }}
            />
          </div>
          <span className="op-muted">
            目录来自 {directory.environmentId} / {directory.nodeId}。{selected?.description}
          </span>
          {!directory.items.length && <span className="op-muted">没有可选连接；请联系目标环境维护者配置连接或调整搜索条件。</span>}
          {directory.total > 20 && <Pagination simple size="small" current={page} pageSize={20} total={directory.total} disabled={disabled} onChange={setPage} />}
        </>
      )}
    </section>
  );
}
