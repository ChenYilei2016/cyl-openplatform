import { useEffect, useMemo, useState } from "react";
import { Alert, Input, Modal, Radio, Select } from "antd";
import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import type { AdminApi } from "../../access/api";
import { inferSampleSchema, mergeSampleSchema, fieldTypes } from "../sampleSchema";
import { schemaTypeMeta } from "./SchemaTypeLabel";
import { MAX_LEVELS, MAX_NODES, countNodes, height, levelOf, nodeAt, pathLabel, updateAt, type SchemaPath } from "./schemaTree";

/** 去掉推断出的示例：节点内示例只来自用户明确设置。 */
const withoutExamples = ({ example: _inferred, ...node }: SchemaNode, keep?: SchemaNode): SchemaNode => ({
  ...node,
  ...(keep && Object.hasOwn(keep, "example") ? { example: keep.example } : {}),
  ...(node.properties
    ? { properties: Object.fromEntries(Object.entries(node.properties).map(([name, child]) => [name, withoutExamples(child, keep?.properties?.[name])])) }
    : {}),
  ...(node.items ? { items: withoutExamples(node.items, keep?.items ?? undefined) } : {}),
});

/** 收集 a 中有、b 中没有的字段路径（点号形式，与映射一致）。 */
export function removedPaths(before: SchemaNode, after: SchemaNode, prefix: string[] = []): string[][] {
  return Object.entries(before.properties ?? {}).flatMap(([name, child]) => {
    const path = [...prefix, name];
    const next = after.properties?.[name];
    return next ? removedPaths(child, next, path) : [path];
  });
}

/**
 * 对象节点“从 JSON 生成”：严格解析样例原文，合并（补齐缺少字段，已有设置不变）或替换该对象的字段。
 * 整份结构与映射联动的生成仍在区块右上的“JSON 生成字段”。
 */
export default function NodeJsonDialog({
  api,
  root,
  path,
  request,
  onCancel,
  onApply,
}: {
  api: AdminApi;
  root: SchemaNode;
  path: SchemaPath;
  request: boolean;
  onCancel: () => void;
  onApply: (schema: SchemaNode, removed: string[][]) => void;
}) {
  const label = pathLabel(path) || "顶层";
  const existing = nodeAt(root, path);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [sample, setSample] = useState<{ text: string; value: unknown } | null>(null);
  const [parseError, setParseError] = useState("");
  useEffect(() => {
    setSample(null);
    setParseError("");
    if (!text.trim()) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void api<unknown>("/apis/validate-json", { method: "POST", bodyText: text, signal: abort.signal })
        .then((value) => !abort.signal.aborted && setSample({ text, value }))
        .catch((failure) => !abort.signal.aborted && setParseError((failure as Error).message));
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [api, text]);
  const result = useMemo(() => {
    if (!sample || sample.text !== text) return null;
    try {
      const value = sample.value;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请粘贴一个 JSON 对象，例如 {\"orderNo\": \"A001\"}。");
      const inferred = inferSampleSchema(value, request, choices, mode === "merge" ? existing : undefined);
      const merged = mode === "merge" ? mergeSampleSchema(existing, inferred.schema) : { schema: inferred.schema, conflicts: [] };
      const node: SchemaNode = {
        ...withoutExamples(merged.schema, existing),
        description: existing.description,
        required: existing.required,
        nullable: existing.nullable,
      };
      const schema = updateAt(root, path, () => node);
      if (levelOf(path) - 1 + height(node) > MAX_LEVELS) throw new Error(`生成后超过 ${MAX_LEVELS} 层，请缩小样例。`);
      if (countNodes(schema) > MAX_NODES) throw new Error(`生成后超过 ${MAX_NODES} 个节点，请缩小样例。`);
      const added = Object.keys(node.properties ?? {}).filter((name) => !existing.properties?.[name]);
      return { schema, questions: inferred.questions, excluded: inferred.excluded, conflicts: merged.conflicts, added, removed: removedPaths(existing, node, path), error: "" };
    } catch (failure) {
      return { error: (failure as Error).message, schema: null, questions: [], excluded: [], conflicts: [], added: [], removed: [] };
    }
  }, [sample, text, mode, choices, existing, request, root, path]);
  const ready = Boolean(result?.schema) && !result?.questions.length;
  return (
    <Modal
      open
      title={`从 JSON 生成 ${label} 的字段`}
      okText={mode === "merge" ? "合并到字段表" : "替换字段"}
      cancelText="取消"
      okButtonProps={{ disabled: !ready, danger: mode === "replace" }}
      onCancel={onCancel}
      onOk={() => result?.schema && onApply(result.schema, result.removed)}
      destroyOnHidden
      width={640}
    >
      <div className="op-schema-json">
        <Radio.Group value={mode} onChange={(event) => setMode(event.target.value)} aria-label="生成方式">
          <Radio value="merge">合并：补齐缺少的字段，已有字段的类型、说明与必填不变</Radio>
          <Radio value="replace">替换：按样例重建 {label} 的全部子字段</Radio>
        </Radio.Group>
        <Input.TextArea
          aria-label="JSON 样例"
          className="op-json-editor"
          autoSize={{ minRows: 6, maxRows: 14 }}
          spellCheck={false}
          maxLength={262144}
          placeholder={'粘贴一个对象样例，例如 {"orderNo": "A001", "amount": 12.5}'}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        {parseError && <Alert type="error" showIcon title={`样例不是合法 JSON：${parseError}`} />}
        {result?.error && <Alert type="error" showIcon title={result.error} />}
        {result?.questions.map((question) => (
          <label key={question.path} className="op-schema-json__question">
            <span>
              <code>{question.path.replace(/^\$\.?/, "") || label}</code> {question.message}，请选择类型
            </span>
            <Select
              aria-label={`${question.path} 类型`}
              placeholder="选择类型"
              style={{ width: 140 }}
              value={choices[question.path]}
              onChange={(type: string) => setChoices((current) => ({ ...current, [question.path]: type }))}
              options={fieldTypes.map((type) => ({ value: type, label: schemaTypeMeta[type]?.name ?? type }))}
            />
          </label>
        ))}
        {result?.schema && (
          <div className="op-schema-json__summary" role="status">
            {mode === "merge"
              ? result.added.length
                ? `将新增 ${result.added.length} 个字段：${result.added.slice(0, 6).join("、")}${result.added.length > 6 ? " 等" : ""}`
                : "样例中的字段都已存在，不会新增字段"
              : `将以样例中的 ${Object.keys(nodeAt(result.schema, path).properties ?? {}).length} 个字段替换现有子字段`}
            {result.conflicts.length > 0 && `；${result.conflicts.length} 处类型与样例不同，已保留现有类型`}
            {result.removed.length > 0 && `；将移除 ${result.removed.map((item) => item.join(".")).join("、")}`}
            {result.excluded.length > 0 && `；已排除可信身份字段 ${result.excluded.join("、")}`}
          </div>
        )}
      </div>
    </Modal>
  );
}
