import { responseSchemaSuggestion } from "./responseSchemaGuidance";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Input,
  Popover,
  Modal,
  Radio,
  Select,
  Table,
} from "antd";
import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import SchemaView from "@cyl/open-platform-web-shared/documentation/SchemaView";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import {
  parseJson,
  stringifyJson,
  sameJsonValue,
} from "@cyl/open-platform-web-shared/json";
import type { AdminApi } from "../access/api";
import "./editors.css";
import {
  adapterForm,
  responseAdapter,
  type AdapterForm,
} from "./ResponseAdapterEditor";
import type { Binding } from "./BindingEditor";
import { requestPaths, schemaTypeNames, type Mapping } from "./SchemaEditor";
import {
  inferSampleSchema,
  mergeSampleSchema,
  reconcileSchemaValues,
  sampleAt,
  sampleObjectPaths,
} from "./sampleSchema";
import { appendMappings, proposeMappings } from "./defaultMappings";

export interface GeneratedFields {
  schemaText: string;
  adapter?: AdapterForm;
  mappingsText?: string;
}
interface Props {
  api: AdminApi;
  schemaText: string;
  request?: boolean;
  adapter?: AdapterForm;
  mappingBlocked?: string;
  onStateChange?: (state: { pending: boolean; busy: boolean }) => void;
  mappingSource?: {
    binding: Binding;
    bindingText: string;
    mappingsText: string;
  };
  onApply: (value: GeneratedFields) => void;
}
export default function JsonSchemaButton({
  api,
  schemaText,
  request = false,
  adapter,
  mappingSource,
  mappingBlocked,
  onStateChange,
  onApply,
}: Props) {
  const [returnForm, setReturnForm] = useState<AdapterForm>(
    adapter ?? adapterForm(),
  );
  const [open, setOpen] = useState(false),
    [text, setText] = useState(""),
    [scope, setScope] = useState(""),
    [mode, setMode] = useState<"merge" | "replace">("merge");
  const [choices, setChoices] = useState<Record<string, string>>({}),
    [conflicts, setConflicts] = useState<Record<string, string>>({});
  const [newFieldsRequired, setNewFieldsRequired] = useState(false);
  const [removalConsent, setRemovalConsent] = useState<string | null>(null);
  const [updateExample, setUpdateExample] = useState(false);
  const [fillMappings, setFillMappings] = useState(false),
    [sample, setSample] = useState<{ text: string; value: unknown } | null>(
      null,
    ),
    [error, setError] = useState(""),
    [schemaError, setSchemaError] = useState("");
  const [loading, setLoading] = useState(false),
    [validating, setValidating] = useState(false),
    [applying, setApplying] = useState(false),
    [validKey, setValidKey] = useState("");
  const [undo, setUndo] = useState<{
    before: GeneratedFields;
    after: GeneratedFields;
    bindingText?: string;
  } | null>(null);
  const reportState = useRef(onStateChange);
  reportState.current = onStateChange;
  const pending = open && (!!text.trim() || applying);
  useEffect(() => {
    reportState.current?.({ pending, busy: applying });
  }, [pending, applying]);
  useEffect(
    () => () => reportState.current?.({ pending: false, busy: false }),
    [],
  );
  const sourceKey = stringifyJson([
    schemaText,
    adapter,
    mappingSource,
    mappingBlocked,
  ]);
  const current = useRef(sourceKey);
  current.current = sourceKey;
  const [openedSource, setOpenedSource] = useState(sourceKey);
  const lifetime = useRef(0);
  useEffect(
    () => () => {
      lifetime.current++;
    },
    [],
  );
  // 严格读取原文而不是先JSON.parse再回传，重复键及精度与现有高级编辑器一致。
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setSample(null);
    setError("");
    setLoading(Boolean(text.trim()));
    if (!text.trim()) return () => abort.abort();
    const timer = setTimeout(() => {
      if (new TextEncoder().encode(text).length > 262144) {
        setError("样例不能超过256KiB。");
        setLoading(false);
        return;
      }
      void api<unknown>("/apis/validate-json", {
        method: "POST",
        bodyText: text,
        signal: abort.signal,
      })
        .then((value) => {
          if (!abort.signal.aborted) setSample({ text, value });
        })
        .catch((reason) => {
          if (!abort.signal.aborted) setError((reason as Error).message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [api, open, text]);
  const result = useMemo(() => {
    if (!sample || sample.text !== text) return null;
    try {
      const effectiveAdapter = adapter
        ? {
            ...(adapter.mode === "ENVELOPE" ? adapter : returnForm),
            mode: "ENVELOPE" as const,
            dataPath: scope === "@business" ? adapter.dataPath : scope,
          }
        : undefined;
      const unwrapped =
        !request && effectiveAdapter && mode === "merge"
          ? responseSchemaSuggestion(effectiveAdapter, schemaText)
          : null;
      const previous =
        unwrapped?.schema ??
        (schemaText ? parseJson<SchemaNode>(schemaText) : undefined);
      const inferred = inferSampleSchema(
        sampleAt(sample.value, scope === "@business" ? "" : scope),
        request,
        choices,
        mode === "merge" ? previous : undefined,
        newFieldsRequired,
      );
      const merged =
        mode === "merge"
          ? mergeSampleSchema(previous, inferred.schema, conflicts)
          : { schema: inferred.schema, conflicts: [] };
      if (mode === "merge" && updateExample)
        merged.schema = { ...merged.schema, example: inferred.schema.example };
      const reconciled =
        mode === "merge" && Object.values(conflicts).includes("sample")
          ? reconcileSchemaValues(merged.schema)
          : { schema: merged.schema, adjustments: [] };
      return {
        ...inferred,
        ...merged,
        ...reconciled,
        error: "",
        unwrapped: unwrapped?.path,
      };
    } catch (reason) {
      return {
        error: (reason as Error).message,
        schema: null,
        questions: [],
        conflicts: [],
        excluded: [],
      };
    }
  }, [
    sample,
    text,
    scope,
    request,
    schemaText,
    mode,
    choices,
    conflicts,
    adapter,
    returnForm,
    newFieldsRequired,
    updateExample,
  ]);
  const generatedText = result?.schema ? stringifyJson(result.schema, 2) : "";
  const unresolved = !!result?.questions.length || !!result?.conflicts.length;
  const previewKey = stringifyJson([
    generatedText,
    text,
    scope,
    mode,
    choices,
    conflicts,
    sourceKey,
  ]);
  useEffect(() => {
    setValidKey("");
    setSchemaError("");
    if (!open || !generatedText || unresolved) {
      setValidating(false);
      return;
    }
    const abort = new AbortController();
    setValidating(true);
    const timer = setTimeout(
      () =>
        void api(`/apis/validate-json?kind=schema&request=${request}`, {
          method: "POST",
          bodyText: generatedText,
          signal: abort.signal,
        })
          .then(() => {
            if (!abort.signal.aborted) setValidKey(previewKey);
          })
          .catch((reason) => {
            if (!abort.signal.aborted)
              setSchemaError((reason as Error).message);
          })
          .finally(() => {
            if (!abort.signal.aborted) setValidating(false);
          }),
      250,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [api, open, generatedText, unresolved, request, previewKey]);
  const mappingPlan =
    result?.schema && mappingSource
      ? proposeMappings(result.schema, mappingSource.binding)
      : null;
  let invalidMappings: Mapping[] = [],
    mappingTextError = "";
  if (mappingSource && result?.schema) {
    try {
      const values = parseJson<Mapping[]>(mappingSource.mappingsText);
      if (!Array.isArray(values)) throw new Error("现有映射不是数组");
      const paths = new Set(requestPaths(result.schema));
      invalidMappings = values.filter(
        (item) => item.source === "REQUEST" && !paths.has(item.path ?? ""),
      );
    } catch {
      mappingTextError = "现有映射JSON尚未完成，先修正后再联动补齐。";
    }
  }
  const invalidMappingKey = stringifyJson(invalidMappings);
  const removeInvalidMappings =
    invalidMappings.length > 0 && removalConsent === invalidMappingKey;
  const mappingRemovalNeeded =
    invalidMappings.length > 0 && !removeInvalidMappings;
  const canMap =
    !mappingTextError &&
    !mappingBlocked &&
    !!mappingPlan &&
    !mappingPlan.pending.length;
  const changedSinceOpen = openedSource !== sourceKey;
  const changesAdapter =
    !request &&
    adapter &&
    scope !== "@business" &&
    scope !== (adapter.mode === "ENVELOPE" ? adapter.dataPath : "");
  const proposedAdapter = changesAdapter
    ? {
        ...(adapter?.mode === "ENVELOPE" ? adapter : returnForm),
        mode: "ENVELOPE" as const,
        dataPath: scope,
      }
    : undefined;
  let adapterError = "";
  if (proposedAdapter) {
    try {
      const rule = responseAdapter(proposedAdapter);
      if (
        sample?.text === text &&
        !rule.successValues?.some((value) =>
          sameJsonValue(value, sampleAt(sample.value, rule.successPath!)),
        )
      )
        adapterError =
          "样例中的成功字段与成功值不一致，请核对成功条件或换用成功返回样例。";
    } catch (reason) {
      adapterError = (reason as Error).message;
    }
  }
  function selectScope(value: string) {
    setScope(value);
    setChoices({});
    setConflicts({});
    if (
      adapter?.mode === "DIRECT" &&
      value &&
      sample?.value &&
      typeof sample.value === "object"
    ) {
      const raw = sample.value as Record<string, unknown>;
      if (Object.hasOwn(raw, "errCode"))
        setReturnForm({
          ...adapterForm(),
          successPath: "errCode",
          successValues: typeof raw.errCode === "string" ? '["0"]' : "[0]",
          messagePath: "errMessage",
        });
      else if (Object.hasOwn(raw, "code"))
        setReturnForm({
          ...adapterForm(),
          successValues: stringifyJson([
            sameJsonValue(raw.code, 0)
              ? 0
              : raw.code === "0"
                ? "0"
                : raw.code === "200"
                  ? "200"
                  : 200,
          ]),
          messagePath: "message",
        });
      else if (Object.hasOwn(raw, "success"))
        setReturnForm({
          ...adapterForm(),
          successPath: "success",
          successValues: "[true]",
          messagePath: "message",
        });
    }
  }
  const close = () => {
    if (!applying) {
      lifetime.current++;
      setOpen(false);
    }
  };
  const apply = async () => {
    if (
      !result?.schema ||
      validKey !== previewKey ||
      changedSinceOpen ||
      mappingRemovalNeeded ||
      adapterError
    )
      return;
    const attempt = ++lifetime.current,
      key = sourceKey;
    setApplying(true);
    setError("");
    try {
      const value: GeneratedFields = { schemaText: generatedText };
      if (proposedAdapter) value.adapter = proposedAdapter;
      if (
        mappingSource &&
        ((fillMappings && canMap && mappingPlan) ||
          (removeInvalidMappings && invalidMappings.length))
      ) {
        await api("/apis/validate-json", {
          method: "POST",
          bodyText: mappingSource.bindingText,
        });
        const existing = await api<Mapping[]>("/apis/validate-json", {
          method: "POST",
          bodyText: mappingSource.mappingsText,
        });
        if (!Array.isArray(existing))
          throw new Error("现有映射不是数组，请先修正。");
        const availablePaths = new Set(requestPaths(result.schema));
        const retainedMappings = removeInvalidMappings
          ? existing.filter(
              (item) =>
                item.source !== "REQUEST" ||
                availablePaths.has(item.path ?? ""),
            )
          : existing;
        value.mappingsText = stringifyJson(
          appendMappings(
            retainedMappings,
            fillMappings && canMap && mappingPlan ? mappingPlan.mappings : [],
            mappingSource.binding,
          ).mappings,
          2,
        );
      }
      if (attempt !== lifetime.current || current.current !== key) return;
      setUndo({
        before: {
          schemaText,
          adapter: value.adapter ? adapter : undefined,
          mappingsText:
            value.mappingsText === undefined
              ? undefined
              : mappingSource?.mappingsText,
        },
        after: value,
        bindingText: mappingSource?.bindingText,
      });
      onApply(value);
      setOpen(false);
    } catch (reason) {
      if (attempt === lifetime.current) setError((reason as Error).message);
    } finally {
      if (attempt === lifetime.current) setApplying(false);
    }
  };
  const canUndo =
    undo &&
    schemaText === undo.after.schemaText &&
    (!undo.after.adapter ||
      stringifyJson(adapter) === stringifyJson(undo.after.adapter)) &&
    (undo.after.mappingsText === undefined ||
      (mappingSource?.mappingsText === undo.after.mappingsText &&
        mappingSource?.bindingText === undo.bindingText));
  return (
    <>
      <Button
        size="small"
        onClick={() => {
          setReturnForm(adapter ?? adapterForm());
          setOpenedSource(sourceKey);
          setScope(
            !request && adapter?.mode === "ENVELOPE" ? adapter.dataPath : "",
          );
          setMode("merge");
          setText("");
          setChoices({});
          setConflicts({});
          setSample(null);
          setError("");
          setFillMappings(false);
          setNewFieldsRequired(false);
          setUpdateExample(false);
          setRemovalConsent(null);
          setOpen(true);
        }}
      >
        JSON 生成字段
      </Button>
      {canUndo && (
        <Button
          type="link"
          size="small"
          onClick={() => {
            onApply(undo.before);
            setUndo(null);
          }}
        >
          撤销字段生成
        </Button>
      )}
      <Modal
        title={request ? "从请求 JSON 生成字段" : "从返回 JSON 生成公开字段"}
        open={open}
        width={1120}
        onCancel={close}
        mask={{ closable: false }}
        closable={!applying}
        destroyOnHidden
        footer={
          <>
            <Button disabled={applying} onClick={close}>
              取消
            </Button>
            <Button
              type="primary"
              loading={applying}
              disabled={
                !generatedText ||
                unresolved ||
                validKey !== previewKey ||
                changedSinceOpen ||
                mappingRemovalNeeded ||
                loading ||
                !!adapterError
              }
              onClick={() => void apply()}
            >
              应用到草稿
            </Button>
          </>
        }
      >
        <div className="json-generation-options">
          <Radio.Group
            disabled={applying}
            value={mode}
            onChange={(event) => {
              setMode(event.target.value);
              setConflicts({});
            }}
            options={[
              { value: "merge", label: "补齐缺少字段" },
              { value: "replace", label: "重新生成结构" },
            ]}
          />
          <Checkbox
            disabled={applying}
            checked={newFieldsRequired}
            onChange={(event) => setNewFieldsRequired(event.target.checked)}
          >
            新字段设为必填
          </Checkbox>
          <span>
            {mode === "merge"
              ? "保留已有说明、必填、枚举和默认值"
              : "替换当前结构及约束，可撤销；不自动保存"}
          </span>
        </div>
        <div
          className="json-generation-grid"
          aria-busy={loading || validating || applying}
        >
          <div className="json-generation-source">
            <label>
              {request ? "粘贴一份请求 JSON" : "粘贴一份返回 JSON"}
              <Input.TextArea
                aria-label="生成字段的 JSON 样例"
                maxLength={262144}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setChoices({});
                  setConflicts({});
                }}
                rows={12}
                placeholder={
                  request
                    ? '{"orderId":"A001","items":[{"sku":"S1","count":2}]}'
                    : '{"errCode":"0","data":{"orderId":"A001"}}'
                }
                disabled={applying}
              />
            </label>
            <small>粘贴真实格式的脱敏内容即可，点击应用前只预览字段。</small>
            {mode === "merge" && schemaText && (
              <div className="json-example-option">
                <Checkbox
                  checked={updateExample}
                  disabled={applying}
                  onChange={(event) => setUpdateExample(event.target.checked)}
                >
                  {request
                    ? "同时更新文档中的请求示例"
                    : "同时更新文档中的返回示例"}
                </Checkbox>
                <Popover
                  trigger="click"
                  title="文档示例的用途"
                  content={
                    <div style={{ maxWidth: 340 }}>
                      示例让接入者知道请求怎么写、返回长什么样。勾选后用本次内容更新；未勾选时补齐字段会保留已有示例。返回示例只包含下方选定的业务内容，不会发送请求。
                    </div>
                  }
                >
                  <Button type="text" size="small" aria-label="文档示例说明">
                    ?
                  </Button>
                </Popover>
              </div>
            )}
            {!request && adapter?.mode === "ENVELOPE" && (
              <div className="json-sample-kind">
                <span>你粘贴的是哪种内容？</span>
                <Radio.Group
                  aria-label="返回样例内容"
                  value={scope === "@business" ? "business" : "complete"}
                  disabled={applying}
                  onChange={(event) =>
                    selectScope(
                      event.target.value === "business"
                        ? "@business"
                        : adapter.dataPath,
                    )
                  }
                  options={[
                    { value: "complete", label: "提供方的完整返回" },
                    { value: "business", label: "只贴了业务内容" },
                  ]}
                />
                <small>
                  {scope === "@business"
                    ? '例如 {"orderNo":"A001"}；沿用接口当前的返回设置。'
                    : '例如 {"code":200,"data":{"orderNo":"A001"}}。'}
                </small>
              </div>
            )}
            {!request && scope !== "@business" && (
              <label>
                要公开给客户的内容
                <Select
                  aria-label="用于生成字段的返回内容"
                  value={scope}
                  disabled={applying}
                  onChange={selectScope}
                  options={[
                    { value: "", label: "保留全部返回字段" },
                    ...[
                      ...new Set([
                        scope,
                        ...(sample ? sampleObjectPaths(sample.value) : []),
                      ]),
                    ]
                      .filter((path) => !!path && path !== "@business")
                      .map((path) => ({
                        value: path,
                        label: `只使用 ${path} 里的内容`,
                      })),
                  ]}
                />
              </label>
            )}
            {!request &&
              adapter &&
              scope !== "@business" &&
              scope !==
                (adapter.mode === "ENVELOPE" ? adapter.dataPath : "") && (
                <p className="help-text">
                  采用后，接口将
                  {scope ? `从 ${scope} 读取业务数据` : "使用整份提供方返回"}
                  。{adapter.mode === "DIRECT" ? "请同时核对下面的成功条件。" : "保留接口当前的成功条件。"}
                </p>
              )}
            {changesAdapter && adapter?.mode === "DIRECT" && (
              <div className="generation-success-fields">
                <label>
                  成功字段路径
                  <Input
                    aria-label="生成时成功字段"
                    maxLength={520}
                    disabled={applying}
                    value={returnForm.successPath}
                    onChange={(event) =>
                      setReturnForm((current) => ({
                        ...current,
                        successPath: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  成功值（JSON数组）
                  <Input
                    aria-label="生成时成功值"
                    maxLength={6000}
                    disabled={applying}
                    value={returnForm.successValues}
                    onChange={(event) =>
                      setReturnForm((current) => ({
                        ...current,
                        successValues: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            )}
            {mappingSource && (
              <Checkbox
                checked={fillMappings && canMap}
                disabled={!canMap || applying}
                onChange={(event) => setFillMappings(event.target.checked)}
              >
                同时补齐默认映射
                {mappingBlocked
                  ? `（${mappingBlocked}）`
                  : mappingPlan?.pending.length
                    ? "（Dubbo 参数需在对内配置选择来源）"
                    : ""}
              </Checkbox>
            )}
            {!!invalidMappings.length && (
              <div className="inline-note">
                <p>
                  生成后这些请求映射的来源字段将不存在：
                  {invalidMappings
                    .map((item) => `${item.target} ← ${item.path}`)
                    .join("、")}
                  。可改为补齐字段，或明确移除失效映射。
                </p>
                <Checkbox
                  disabled={applying}
                  checked={removeInvalidMappings}
                  onChange={(event) =>
                    setRemovalConsent(
                      event.target.checked ? invalidMappingKey : null,
                    )
                  }
                >
                  同时移除这 {invalidMappings.length} 条失效请求映射
                </Checkbox>
              </div>
            )}
            {mappingTextError && <small>{mappingTextError}</small>}
            <ErrorFeedback
              error={error || result?.error || adapterError || schemaError}
            />
            {changedSinceOpen && (
              <p role="alert">
                原配置已变化，请关闭后重新生成，避免覆盖新输入。
              </p>
            )}
            {!!result?.excluded.length && (
              <p className="help-text">
                平台身份字段未加入公开请求：{result.excluded.join("、")}
                。请在对内映射使用平台上下文。
              </p>
            )}
          </div>
          <div className="json-generation-preview">
            <strong>
              {loading
                ? "正在读取样例…"
                : !result
                  ? "粘贴 JSON 后预览字段"
                  : validating && !unresolved
                    ? "正在校验生成结构…"
                    : request
                      ? "将填入的请求字段"
                      : "将填入的返回字段"}
            </strong>
            {result && "unwrapped" in result && result.unwrapped && (
              <p className="help-text">
                已有结构包含外壳。本次基于 {result.unwrapped}{" "}
                内的业务结构补齐并保留其约束，外层成功码不加入公开结构。
              </p>
            )}
            {!!result?.questions.length && (
              <Table
                size="small"
                pagination={false}
                rowKey="path"
                dataSource={result.questions}
                columns={[
                  { title: "需确定类型", dataIndex: "path" },
                  {
                    title: "类型",
                    render: (_, item) => (
                      <Select
                        disabled={applying}
                        aria-label={`${item.path} 的生成类型`}
                        placeholder="请选择"
                        options={item.choices.map((value) => ({
                          value,
                          label: `${schemaTypeNames[value] ?? value} · ${value}`,
                        }))}
                        onChange={(value) =>
                          setChoices((current) => ({
                            ...current,
                            [item.path]: value,
                          }))
                        }
                      />
                    ),
                  },
                ]}
              />
            )}
            {!!result?.conflicts.length && (
              <Table
                size="small"
                pagination={false}
                rowKey="path"
                dataSource={result.conflicts}
                columns={[
                  {
                    title: "类型冲突",
                    render: (_, item) => (
                      <>
                        {item.path}
                        <small>{item.message}</small>
                      </>
                    ),
                  },
                  {
                    title: "处理",
                    render: (_, item) => (
                      <Select
                        disabled={applying}
                        aria-label={`${item.path} 类型冲突处理`}
                        placeholder="请选择"
                        options={[
                          { value: "existing", label: "保留原定义" },
                          {
                            value: "sample",
                            label: "采用新类型，清理不兼容取值",
                          },
                        ]}
                        onChange={(value) =>
                          setConflicts((current) => ({
                            ...current,
                            [item.path]: value,
                          }))
                        }
                      />
                    ),
                  },
                ]}
              />
            )}
            {result &&
              "adjustments" in result &&
              !!result.adjustments.length && (
                <p className="help-text">
                  类型已改变，采用时清除：{result.adjustments.join("、")}
                  。原说明、必填和允许null保留。
                </p>
              )}
            {result?.schema && (
              <SchemaView
                title={request ? "生成的请求结构" : "生成的公开业务结构"}
                schema={{ ...result.schema, example: undefined }}
                showRawSchema={false}
              />
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
