import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import { parseJson, stringifyJson } from "@cyl/open-platform-web-shared/json";
import { defaultLifecycle, type ApiLifecycle } from "@cyl/open-platform-web-shared/lifecycle";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCopyCreation } from "./useCopyCreation";
import { useDraftStash } from "./useDraftStash";
import { useExampleCandidate } from "./useExampleCandidate";
import { useFieldFocus } from "./useFieldFocus";
import { splitWholeJson } from "./wholeJson";
import { AdminApiError, type AdminApi } from "../../access/api";
import { useAdminNavigation } from "../../navigation/AdminNavigation";
import { bindingSignature, newBinding, type Binding } from "../BindingEditor";
import type { ApiDefinition } from "../CatalogPanel";
import type { AdapterForm } from "../ResponseAdapterEditor";
import type { Mapping } from "../SchemaEditor";
import { failureIssues, type CandidateValidation, type FieldIssue } from "../WorkspaceValidation";
import {
  bindingShape,
  changedFields as diffFields,
  emptyRequest,
  mappingsShape,
  missingCandidateFields,
  contentOf,
  parseSchema,
  repositionMappings,
  requestBody,
  sectionOf,
  stashKey,
  stringify,
  tryParse,
  type DraftContent,
  type DraftCreation,
  type McpToolDraft,
  type OperationKind,
  type DraftMetadata,
  type DraftSections,
  type SectionKey,
} from "./draftModel";

/** 只有 HTTP 409 表示保存时的修订冲突；其他 409xxxxx 业务码按普通错误显示。 */
const isConflict = (failure: unknown) => failure instanceof AdminApiError && failure.httpStatus === 409;

export interface ConflictState {
  message: string;
  latest?: ApiDefinition | null;
  loading?: boolean;
}

/**
 * API 草稿的唯一状态源：内容、基线、校验、保存、冲突、暂存都在这里；页面分区组件只读写这里暴露的值（111）。
 * 传入 creation 时承载尚未创建的草稿（116：复制新 API、导入候选），definition 为占位定义。
 */
export function useApiDraft({
  api,
  definition,
  onSaved,
  onReload,
  exampleSource,
  onExampleHandled,
  creation,
}: {
  api: AdminApi;
  definition: ApiDefinition;
  onSaved?: (value: ApiDefinition) => void;
  onReload?: () => void;
  exampleSource?: { apiId: string; data: unknown } | null;
  onExampleHandled?: () => void;
  creation?: DraftCreation;
}) {
  const navigation = useAdminNavigation();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = useMemo(() => contentOf(definition), []); // 仅首次；保存后由 baseline 推进。
  const [metadata, setMetadata] = useState<DraftMetadata>(initial.metadata);
  const [sections, setSections] = useState<DraftSections>(initial.sections);
  const [lifecycle, setLifecycle] = useState<ApiLifecycle>(initial.lifecycle);
  const [adapter, setAdapterState] = useState<AdapterForm>(initial.adapter);
  const [codes, setCodesState] = useState<string[]>(initial.codes);
  const [employeeRequired, setEmployeeRequiredState] = useState(initial.employeeRequired);
  const [operationKind, setOperationKind] = useState<OperationKind>(initial.operationKind);
  const [idempotencyField, setIdempotencyField] = useState(initial.idempotencyField);
  const [mcpTool, setMcpToolState] = useState<McpToolDraft>(initial.mcpTool);
  const baseline = useRef<DraftContent>(initial);
  const content: DraftContent = { metadata, sections, lifecycle, adapter, codes, employeeRequired, operationKind, idempotencyField, mcpTool };
  const latestState = useRef(content);
  latestState.current = content;
  /** 尚未创建的草稿在创建（或候选确认）成功前始终算作未保存。 */
  const pendingCreation = useRef(creation !== undefined);
  const [inputEpoch, setInputEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  /** 调试页带来的提供方返回样例，只用于配置页验证返回规则，不保存。 */
  const [responseSample, setResponseSample] = useState<{ text: string }>();
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const saving = useRef(false);
  const savedDefinition = useRef<ApiDefinition>(definition);
  const lastSaveError = useRef<Error | null>(null);
  const copying = useCopyCreation({ api, saving, setBusy, setError, onCreated: (saved) => {
    baseline.current = latestState.current;
    pendingCreation.current = false;
    onSaved?.(saved);
  } });

  /* ------------------------------ 解析后的模型 ------------------------------ */
  const lastBinding = useRef<Binding>(bindingShape(definition.binding) ? definition.binding : newBinding("HTTP"));
  const confirmedBinding = useRef<Binding>(lastBinding.current);
  const lastMappings = useRef<Mapping[]>(mappingsShape(definition.mappings) ? definition.mappings : []);
  const lastRequest = useRef<SchemaNode>(definition.requestSchema ?? emptyRequest);
  // 原文无效时表单模型不覆盖。
  const bindingModel = tryParse(sections.binding, bindingShape);
  if (bindingModel) lastBinding.current = bindingModel;
  const mappingsModel = tryParse(sections.mappings, mappingsShape);
  if (mappingsModel) lastMappings.current = mappingsModel;
  const parsedRequest = parseSchema(sections.requestSchema);
  if (parsedRequest) lastRequest.current = parsedRequest;

  /* ---------------------------- 待应用的局部输入 ---------------------------- */
  const [manualBindingPending, setManualBindingPending] = useState(false);
  const [bindingCandidate, setBindingCandidate] = useState<Binding | null>(null);
  const [editors, setEditors] = useState<Record<string, { pending: boolean; busy: boolean }>>({});
  const unappliedEdits = Object.values(editors).some((state) => state.pending);
  const editorBusy = Object.values(editors).some((state) => state.busy);
  const unappliedSections = [...new Set(Object.entries(editors).filter(([, state]) => state.pending)
    .map(([key]) => key.startsWith("request") ? "request" as const : "response" as const))];
  const editorState = (key: string, state: { pending: boolean; busy: boolean }) =>
    setEditors((current) => (current[key]?.pending === state.pending && current[key]?.busy === state.busy ? current : { ...current, [key]: state }));
  const example = useExampleCandidate({ api, responseSchemaText: sections.responseSchema, onError: setError });
  const candidate = example.candidate;

  /* --------------------------------- 修改 --------------------------------- */
  const change = (key: keyof DraftSections, text: string) => {
    // 切换 HTTP 方法时按既有规则调整映射位置（GET/DELETE 不能携带正文）。
    const positioned = key === "binding" ? repositionMappings(text, lastBinding.current, sections.mappings, creation ? { binding: null, mappings: null } : definition) : undefined;
    setSections((current) => ({ ...current, [key]: text, ...(positioned === undefined ? {} : { mappings: positioned }) }));
  };
  const updateMetadata = (key: keyof DraftMetadata, value: string) => setMetadata((current) => ({ ...current, [key]: value }));
  const updateLifecycle = (patch: Partial<ApiLifecycle>) => setLifecycle((current) => ({ ...current, ...patch }));
  /** Dubbo 目标签名变化需确认；同签名直接写入。 */
  const requestBindingChange = (value: Binding) => {
    if (bindingSignature(value) === bindingSignature(confirmedBinding.current)) change("binding", stringify(value));
    else setBindingCandidate(value);
  };
  /** 整份 JSON 需确认绑定时整体挂起：确认后一次性应用，取消则什么都不改。 */
  const pendingWhole = useRef<ReturnType<typeof splitWholeJson> | null>(null);
  const applyPatch = (patch: ReturnType<typeof splitWholeJson>) => {
    setMetadata((current) => ({ ...current, ...patch.metadata }));
    // 绑定与映射以 JSON 原文为准，不再按方法变化重排映射。
    setSections((current) => ({ ...current, ...patch.sections, ...(patch.binding ? { binding: stringify(patch.binding) } : {}) }));
    if (patch.codes) setCodesState(patch.codes);
    if (patch.employeeRequired !== undefined) setEmployeeRequiredState(patch.employeeRequired);
    if (patch.operationKind) setOperationKind(patch.operationKind);
    if (patch.idempotencyField !== undefined) setIdempotencyField(patch.idempotencyField);
    if (patch.mcpTool) setMcpToolState(patch.mcpTool);
    if (patch.lifecycle) setLifecycle(patch.lifecycle);
    if (patch.adapter) setAdapterState(patch.adapter);
  };
  const confirmBinding = () => {
    if (bindingCandidate) {
      confirmedBinding.current = bindingCandidate;
      if (pendingWhole.current) applyPatch(pendingWhole.current);
      else change("binding", stringify(bindingCandidate));
    }
    pendingWhole.current = null;
    setBindingCandidate(null);
  };
  const cancelBinding = () => {
    pendingWhole.current = null;
    setBindingCandidate(null);
  };
  const changeRootDescription = (key: "requestSchema" | "responseSchema", description: string) => {
    const schema = parseSchema(sections[key]);
    if (schema) change(key, stringify({ ...schema, description }));
  };
  /** 负责人默认补齐不算用户修改。 */
  const defaultOwner = (owner: string) => {
    baseline.current = { ...baseline.current, metadata: { ...baseline.current.metadata, owner } };
    setMetadata((current) => ({ ...current, owner }));
  };

  /* ------------------------------ 改动与未保存 ------------------------------ */
  const changed = diffFields(content, baseline.current);
  const pendingInputs = () =>
    Array.from(formRef.current?.elements ?? []).filter((element) => "validity" in element && (element as HTMLInputElement).validity.customError) as HTMLInputElement[];
  const dirty = changed.length > 0;
  // 读取最新内容与基线：保存成功后同一轮里（如创建后跳转）立即视为已保存。
  const hasUnsavedChanges = () =>
    diffFields(latestState.current, baseline.current).length > 0 || pendingCreation.current || copying.pending() ||
    unappliedEdits || saving.current || candidate !== null || manualBindingPending || bindingCandidate !== null || pendingInputs().length > 0;
  const changedSections = new Set<SectionKey>([
    ...unappliedSections,
    ...changed.map((field) => sectionOf(`/${field}`)),
    ...(manualBindingPending ? (["target"] as SectionKey[]) : []),
    ...(candidate ? (["response"] as SectionKey[]) : []),
  ]);

  /* --------------------------------- 定位 --------------------------------- */
  const { focusPath, setFocusPath } = useFieldFocus(formRef, navigation.route.step === "outer" || navigation.route.step === "mcp");
  const locate = (path: string) => {
    // 维护声明在“版本与生命周期”页签编辑（112b）；尚未创建的草稿没有该页签，问题只在检查面板列出。
    if (path.startsWith("/lifecycle")) {
      if (!creation && navigation.route.step !== "history") navigation.navigate({ ...navigation.route, step: "history", releaseId: null });
      return;
    }
    const step = !creation && sectionOf(path) === "mcp" ? "mcp" : "outer";
    if (navigation.route.step !== step) navigation.navigate({ ...navigation.route, step, releaseId: null });
    setFocusPath(path || "/name");
  };
  /** 有未应用的局部输入（如固定值 JSON）时，先定位过去。 */
  const requireAppliedEdits = () => {
    const input = pendingInputs()[0];
    if (!input) return true;
    const focus = () => {
      input.focus();
      input.scrollIntoView?.({ block: "center" });
    };
    setError(input.validationMessage);
    if (navigation.route.step !== "outer") {
      // 配置页在其他页签下是隐藏的，切回后再聚焦。
      navigation.navigate({ ...navigation.route, step: "outer", releaseId: null });
      requestAnimationFrame(() => requestAnimationFrame(focus));
    } else focus();
    return false;
  };

  /* --------------------------------- 校验 --------------------------------- */
  const contentKey = stringifyJson([content, definition.draftRevision, inputEpoch]);
  const latestContent = useRef(contentKey);
  latestContent.current = contentKey;
  const [validation, setValidation] = useState<{ key: string; result: CandidateValidation } | null>(null);
  const [checkingKey, setCheckingKey] = useState<string | null>(null);
  const currentValidation = validation?.key === contentKey ? validation.result : null;
  const validationRequest = useRef<AbortController | null>(null);
  useEffect(() => () => validationRequest.current?.abort(), [contentKey]);
  /** 尚未创建的草稿不带 expectedRevision。 */
  const candidateRequest = (expectedRevision: ApiDefinition["draftRevision"] | null = creation ? null : definition.draftRevision) => ({
    bodyText: requestBody(content, expectedRevision),
  });
  const rememberIssues = (failure: unknown, key: string) => {
    const issues = failureIssues(failure);
    if (!issues.length || latestContent.current !== key) return false;
    setValidation({
      key,
      result: {
        valid: false,
        fieldIssues: issues,
        truncated: failure instanceof AdminApiError && (failure.data as { truncated?: boolean })?.truncated === true,
        checkedDraftRevision: creation ? null : definition.draftRevision,
      },
    });
    locate(issues[0].path);
    return true;
  };
  /** 导入候选在请求服务端前先列出已知必填缺项。 */
  const showMissingCandidateFields = () => {
    if (creation?.kind !== "candidate") return false;
    const fieldIssues = missingCandidateFields(metadata, sections.responseSchema);
    if (!fieldIssues.length) return false;
    setValidation({ key: contentKey, result: { valid: false, fieldIssues, truncated: false, checkedDraftRevision: null } });
    locate(fieldIssues[0].path);
    return true;
  };
  const validationPath = creation ? "/apis/validate" : `/apis/${encodeURIComponent(definition.id)}/validate`;
  const validate = async () => {
    if (manualBindingPending) {
      locate("/binding");
      setError("请先应用或撤销未应用的手工签名，再校验。");
      return;
    }
    if (!requireAppliedEdits() || showMissingCandidateFields()) return;
    validationRequest.current?.abort();
    const controller = new AbortController();
    validationRequest.current = controller;
    const key = contentKey;
    setCheckingKey(key);
    setError("");
    try {
      const result = await api<CandidateValidation>(validationPath, {
        method: "POST",
        bodyText: candidateRequest().bodyText,
        signal: controller.signal,
      });
      if (controller.signal.aborted || latestContent.current !== key) return;
      setValidation({ key, result });
      if (!result.valid && result.fieldIssues.length) locate(result.fieldIssues[0].path);
    } catch (failure) {
      if (!controller.signal.aborted && latestContent.current === key && !rememberIssues(failure, key)) setError((failure as Error).message);
    } finally {
      if (latestContent.current === key) setCheckingKey(null);
    }
  };

  /* ------------------------------ 本地暂存 ------------------------------ */
  const currentStashKey = creation ? null : stashKey(definition.id, definition.draftRevision);
  const stash = useDraftStash({
    storageKey: currentStashKey,
    initial,
    content,
    dirty,
    apply: (next) => {
      setMetadata(next.metadata);
      setSections(next.sections);
      setLifecycle(next.lifecycle ?? defaultLifecycle);
      setAdapterState(next.adapter);
      setCodesState(next.codes);
      setEmployeeRequiredState(next.employeeRequired);
      setOperationKind(next.operationKind);
      setIdempotencyField(next.idempotencyField);
      setMcpToolState(next.mcpTool);
    },
  });

  /* --------------------------------- 示例 --------------------------------- */
  useEffect(() => {
    if (!exampleSource || exampleSource.apiId !== definition.id) return;
    if (candidate) {
      setError("还有未确认的公开示例，请先确认或取消，再选择新的测试片段。");
      return;
    }
    locate("/responseSchema");
    void example.open(exampleSource.data);
  }, [exampleSource, definition.id]);
  const closeExample = () => {
    example.clear();
    onExampleHandled?.();
  };

  /* --------------------------------- 保存 --------------------------------- */
  const save = async (expectedRevision = definition.draftRevision): Promise<boolean> => {
    if (unappliedEdits) {
      setError("请先应用或取消未完成的字段编辑或 JSON 生成，再保存草稿。");
      return false;
    }
    lastSaveError.current = null;
    if (saving.current || !requireAppliedEdits()) return false;
    if (copying.recovery) {
      setError("请先查询原创建结果；确认未创建后使用原请求重试。当前输入已保留。");
      return false;
    }
    if (showMissingCandidateFields()) return false;
    if (manualBindingPending) {
      locate("/binding");
      setError("手工签名尚未应用，请先核对并应用，或撤销未应用签名，再保存草稿。");
      return false;
    }
    if (candidate) {
      setError("还有未确认的公开示例。请先确认写入当前草稿，或取消候选，再保存。");
      return false;
    }
    if (bindingCandidate) {
      setError("请先确认或取消内部绑定替换，再保存。");
      return false;
    }
    setError("");
    setBusy(true);
    saving.current = true;
    // 以发起保存时的内容作为新基线；保存期间的输入仍算未保存。
    const sending = latestState.current;
    try {
      // 已有 API 的绑定（含整份 JSON 写入的）必须遵守同一目标签名确认；比较前先严格解析。
      const parsedBinding = creation ? null : parseJson<unknown>(sections.binding);
      if (bindingShape(parsedBinding) && bindingSignature(parsedBinding) !== bindingSignature(confirmedBinding.current)) {
        const validated = await api<Binding>("/apis/validate-json", { method: "POST", bodyText: sections.binding });
        if (!bindingShape(validated)) throw new Error("内部绑定结构不完整，请检查后重试。");
        locate("/binding");
        requestBindingChange(validated);
        return false;
      }
      if (creation?.kind === "candidate") {
        // 候选只复用只读字段校验并定位错误；确认后交回导入批次，由导入事务统一核验，不创建草稿。
        const bodyText = candidateRequest().bodyText;
        const result = await api<CandidateValidation>("/apis/validate", { method: "POST", bodyText });
        setValidation({ key: contentKey, result });
        if (!result.valid) {
          if (result.fieldIssues.length) locate(result.fieldIssues[0].path);
          return false;
        }
        if ((await creation.onPrepared(bodyText)) === false) return false;
        baseline.current = sending;
        pendingCreation.current = false;
        return true;
      }
      if (!sections.responseSchema.trim()) {
        locate("/responseSchema");
        throw new Error("请先在响应处理中填写真实响应结构，再保存。");
      }
      const { bodyText } = candidateRequest(creation ? null : expectedRevision);
      let path = `/apis/${encodeURIComponent(definition.id)}`;
      let request: { method: "PUT" | "POST"; bodyText: string } = { method: "PUT", bodyText };
      if (creation?.kind === "copy") {
        // 原请求正文保持原始 JSON 片段；结果未知时不因后续输入变化而改写幂等请求。
        path = "/api-copies";
        request = { method: "POST", bodyText: copying.start(creation.copy, metadata, bodyText) };
      }
      const { changed: contentChanged, ...saved } = await api<ApiDefinition & { changed?: boolean }>(path, request);
      baseline.current = sending;
      pendingCreation.current = false;
      copying.succeeded();
      stash.clear();
      setConflict(null);
      saving.current = false;
      setSaveMessage(contentChanged === false ? `内容未变化，仍为 r${stringifyJson(saved.draftRevision)}` : `已保存为修订 r${stringifyJson(saved.draftRevision)}，尚未发布`);
      setValidation(null);
      savedDefinition.current = saved;
      onSaved?.(saved);
      return true;
    } catch (failure) {
      lastSaveError.current = failure as Error;
      if (!creation && isConflict(failure)) setConflict({ message: (failure as Error).message });
      else if (!rememberIssues(failure, contentKey)) setError((failure as Error).message);
      copying.failed(failure);
      return false;
    } finally {
      setBusy(false);
      saving.current = false;
    }
  };
  /** 冲突处理：读取对方修订、以对方修订为基线覆盖、或放弃本地修改。 */
  const loadConflict = async () => {
    setConflict((current) => current && { ...current, loading: true });
    try {
      const latest = await api<ApiDefinition>(`/apis/${encodeURIComponent(definition.id)}`);
      setConflict((current) => current && { ...current, latest, loading: false });
      return latest;
    } catch (failure) {
      setConflict((current) => current && { ...current, loading: false, message: (failure as Error).message });
      return null;
    }
  };
  const overwrite = async () => {
    const latest = conflict?.latest ?? (await loadConflict());
    if (latest) await save(latest.draftRevision);
  };
  const discardLocal = () => {
    stash.clear();
    setConflict(null);
    onReload?.();
  };

  /** 重新加载最新草稿：有未保存修改时先确认放弃。 */
  const [reloadAsked, setReloadAsked] = useState(false);
  const requestReload = () => (hasUnsavedChanges() ? setReloadAsked(true) : onReload?.());
  const confirmReload = () => {
    stash.clear();
    setReloadAsked(false);
    onReload?.();
  };

  /* ------------------------------ 整份 JSON ------------------------------ */
  const wholeJson = () => {
    return stringify(parseJson(candidateRequest().bodyText));
  };
  /** 整份配置 JSON：服务端严格解析后拆回各分区；已创建 API 的调用标识不可修改。 */
  const applyWholeJson = async (text: string, signal?: AbortSignal) => {
    const expectedContent = latestContent.current;
    const value = await api<unknown>("/apis/validate-json", { method: "POST", bodyText: text, signal });
    if (signal?.aborted) return false;
    const patch = splitWholeJson(value, metadata, !creation);
    // JSON语法通过不代表契约结构有效；最多校验请求、响应两个Schema。
    await Promise.all((["requestSchema", "responseSchema"] as const).map(key => {
      const schemaText = patch.sections[key];
      return schemaText ? api(`/apis/validate-json?kind=schema&request=${key === "requestSchema"}`, { method: "POST", bodyText: schemaText, signal }) : Promise.resolve();
    }));
    if (signal?.aborted) return false;
    if (latestContent.current !== expectedContent) throw new Error("校验期间配置已修改，请重新应用当前 JSON。");
    if (!creation && patch.binding && bindingSignature(patch.binding) !== bindingSignature(confirmedBinding.current)) {
      pendingWhole.current = patch;
      setBindingCandidate(patch.binding);
      return true;
    }
    applyPatch(patch);
    return true;
  };

  /* ------------------------------- 守卫与调试 ------------------------------- */
  useEffect(
    () =>
      navigation.registerDraft({
        page: creation && navigation.route.page === "imports" ? "imports" : "catalog",
        apiId: creation ? "new" : definition.id,
        dirty: hasUnsavedChanges,
        busy: () => saving.current || editorBusy,
        canSave: !unappliedEdits,
        leaveMessage: unappliedEdits ? "字段编辑或JSON生成尚未应用，请完成或明确放弃后离开。" : undefined,
        save: () => save(),
      }),
    [navigation.registerDraft, navigation.route.page, definition, contentKey, candidate, manualBindingPending, bindingCandidate, busy, editors, copying.recovery],
  );


  return {
    api, definition, creation: creation ?? null, formRef, content, metadata, sections, lifecycle, adapter, codes, employeeRequired,
    operationKind, setOperationKind, idempotencyField, setIdempotencyField, mcpTool,
    updateMcpTool: (patch: Partial<McpToolDraft>) => setMcpToolState((current) => ({ ...current, ...patch })),
    lastBinding: lastBinding.current, confirmedBinding: confirmedBinding.current, lastMappings: lastMappings.current,
    lastRequest: lastRequest.current, change, updateMetadata, updateLifecycle, setAdapter: setAdapterState,
    setCodes: setCodesState, setEmployeeRequired: setEmployeeRequiredState, defaultOwner, changeRootDescription,
    requestBindingChange, bindingCandidate, confirmBinding, cancelBinding, manualBindingPending,
    setManualBindingPending, editorState, unappliedEdits, unappliedSections, candidate, openExampleEditor: example.open, closeExample, changed,
    changedSections, dirty, hasUnsavedChanges, busy: busy || editorBusy, testing, error, setError, saveMessage, currentValidation,
    checking: checkingKey === contentKey, validate, save, locate, focusPath,
    bumpInput: () => setInputEpoch((value) => value + 1), conflict, loadConflict, overwrite, discardLocal,
    closeConflict: () => setConflict(null), stashOffer: stash.offer, restoreStash: stash.restore,
    discardStash: stash.discard, stashedAt: stash.stashedAt, wholeJson, applyWholeJson, requireAppliedEdits,
    pendingCount: () => pendingInputs().length, reloadAsked, requestReload, confirmReload,
    cancelReload: () => setReloadAsked(false), saveError: () => lastSaveError.current,
    savedDefinition: () => savedDefinition.current, setTesting, parsedRequest, responseSample, setResponseSample,
    issues: (currentValidation?.valid === false ? currentValidation.fieldIssues : []) as FieldIssue[],
    copyRecovery: copying.recovery, recoverCopy: copying.recover, locked: copying.recovery !== null,
  };
}
export type ApiDraft = ReturnType<typeof useApiDraft>;
