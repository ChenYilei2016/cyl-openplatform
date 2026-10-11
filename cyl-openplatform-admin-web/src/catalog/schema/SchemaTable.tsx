import { Fragment, useEffect, useRef, useState } from "react";
import { DownOutlined, MoreOutlined, PlusOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { Button, Checkbox, Dropdown, Input, Modal, Popover, Select } from "antd";
import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import { parseJson, stringifyJson } from "@cyl/open-platform-web-shared/json";
import type { AdminApi } from "../../access/api";
import type { Mapping } from "../SchemaEditor";
import NameCell from "./NameCell";
import NodeJsonDialog from "./NodeJsonDialog";
import NodeValues, { type ValueKey } from "./NodeValues";
import SchemaTypeLabel from "./SchemaTypeLabel";
import { useSchemaDrag } from "./useSchemaDrag";
import {
  addField,
  affectedMappings,
  canAddChild,
  canBeContainer,
  containerKeys,
  fieldPointer,
  indentField,
  moveField,
  nodeAt,
  outdentField,
  pathFromPointer,
  pathKey,
  pathLabel,
  removeField,
  renameField,
  retype,
  shiftField,
  updateAt,
  visibleRows,
  type SchemaPath,
  type SchemaRow,
} from "./schemaTree";
import "./schema.css";

const schemaTypes = ["OBJECT", "ARRAY", "STRING", "INTEGER", "NUMBER", "BOOLEAN"];

interface Props {
  api: AdminApi;
  title: string;
  text: string;
  onChange: (text: string) => void;
  request?: boolean;
  mappings?: Mapping[];
  onAdvancedChange?: (advanced: boolean) => void;
  focusPath?: string | null;
  /** 整份结构从 JSON 生成（含映射联动），放在区块右上。 */
  generation?: React.ReactNode;
  /** 111：配置页内不再逐块提供高级 JSON。 */
  allowAdvanced?: boolean;
  onStateChange?: (state: { pending: boolean; busy: boolean }) => void;
}

const summary = (node: SchemaNode) =>
  [
    node.defaultValue != null && `默认 ${stringifyJson(node.defaultValue)}`,
    node.enumValues?.length && `枚举 ${node.enumValues.length} 项`,
    node.example != null && `示例 ${stringifyJson(node.example)}`,
    node.nullable && "可为 null",
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * 111b 字段表：名称、类型、必填、说明行内编辑；默认值 / 枚举 / 示例 / null 在展开行。
 * 键盘：Enter 新增同级、⌘↑/⌘↓ 移动、⌘] 缩进为上方对象的子字段、⌘[ 提升一级；也可拖动。
 * 改变 REQUEST 映射所引用字段的路径（改名、移动层级、删除、改类型）前先列出影响并确认。
 */
export default function SchemaTable({
  api,
  title,
  text,
  onChange,
  request = false,
  mappings = [],
  onAdvancedChange,
  focusPath,
  generation,
  allowAdvanced = true,
  onStateChange,
}: Props) {
  const [advanced, setAdvanced] = useState(false);
  const latest = useRef(text);
  latest.current = text;
  const [advancedError, setAdvancedError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [nodeErrors, setNodeErrors] = useState<Record<string, string>>({});
  const epochs = useRef<Record<string, number>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<{ key: string; focus?: ValueKey | null } | null>(null);
  const [pending, setPending] = useState<{ message: string; apply: () => void } | null>(null);
  const [jsonPath, setJsonPath] = useState<SchemaPath | null>(null);
  const [focusKey, setFocusKey] = useState<{ key: string; select: boolean } | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const container = useRef<HTMLElement>(null);
  const [editors, setEditors] = useState<Record<string, { pending: boolean; busy: boolean }>>({});
  const editorState = (key: string, state: { pending: boolean; busy: boolean }) => setEditors(current => {
    if (current[key]?.pending === state.pending && current[key]?.busy === state.busy) return current;
    const next = { ...current };
    if (state.pending || state.busy) next[key] = state;
    else delete next[key];
    return next;
  });
  const unapplied = Object.values(editors).some(state => state.pending) || pending !== null || jsonPath !== null;
  const editingBusy = busy || Object.values(editors).some(state => state.busy);
  const report = useRef(onStateChange);
  report.current = onStateChange;
  useEffect(() => { report.current?.({ pending: unapplied, busy: editingBusy }); }, [unapplied, editingBusy]);
  useEffect(() => () => report.current?.({ pending: false, busy: false }), []);

  const schema = !advanced && text ? parseJson<SchemaNode>(text) : null;
  const current = () => parseJson<SchemaNode>(latest.current);
  const commit = (next: SchemaNode) => {
    const nextText = stringifyJson(next, 2);
    latest.current = nextText;
    onChange(nextText);
    setNotice("");
  };
  const requireAppliedFields = () => {
    if (!Object.values(editors).some(state => state.pending)) return true;
    setNotice("请先应用或取消字段修改，再切换或折叠结构。");
    return false;
  };
  const attempt = (operation: () => void) => {
    try {
      operation();
    } catch (failure) {
      setNotice((failure as Error).message);
    }
  };
  /** 影响映射或删除子字段时先确认；返回 true 表示已立即执行。 */
  const protect = (path: SchemaPath, message: string, apply: () => void, always = false) => {
    if (Object.entries(editors).some(([key, state]) => state.pending && key !== `name:${pathKey(path)}`)) {
      setNotice("请先应用或取消其他字段的未应用修改，再调整结构。");
      return false;
    }
    const affected = affectedMappings(mappings, path);
    if (!always && !affected.length) {
      attempt(apply);
      return true;
    }
    setPending({
      message: `${message}${affected.length ? ` 受影响映射：${affected.map((mapping) => `${mapping.target} ← ${mapping.path}`).join("、")}。映射保持原样，请随后明确调整。` : ""}`,
      apply: () => attempt(apply),
    });
    return false;
  };

  // 定位到字段时展开其所有上级。
  useEffect(() => {
    if (!focusPath) return;
    const path = pathFromPointer(focusPath, request);
    if (!path?.length) return;
    setCollapsed((current) => {
      const next = new Set([...current].filter((key) => !path.slice(0, -1).some((_, index) => pathKey(path.slice(0, index + 1)) === key)));
      return next.size === current.size ? current : next;
    });
  }, [focusPath, request]);
  // 结构操作后把焦点交给对应字段名。
  useEffect(() => {
    if (!focusKey) return;
    const input = Array.from(container.current?.querySelectorAll<HTMLInputElement>("input[data-name-key]") ?? []).find((element) => element.dataset.nameKey === focusKey.key);
    input?.focus();
    if (focusKey.select) input?.select();
    setFocusKey(null);
  }, [focusKey, text]);

  const focusField = (path: SchemaPath, select = false) => setFocusKey({ key: pathKey(path), select });
  const expand = (path: SchemaPath) =>
    setCollapsed((current) => {
      const next = new Set(current);
      next.delete(pathKey(path));
      return next;
    });
  /** 字段所在对象：父路径；数组元素对象的父路径以 "[]" 结尾。 */
  const parentOf = (path: SchemaPath) => path.slice(0, -1);
  const add = (objectPath: SchemaPath, after?: string) =>
    attempt(() => {
      const result = addField(current(), objectPath, { after });
      commit(result.schema);
      expand(objectPath);
      focusField(result.path, true);
    });
  const rename = (path: SchemaPath, name: string) =>
    protect(path, `将字段 ${pathLabel(path)} 重命名为 ${name}。`, () => commit(renameField(current(), path, name)));
  const shift = (path: SchemaPath, delta: -1 | 1) =>
    attempt(() => {
      const next = shiftField(current(), path, delta);
      if (!next) return;
      commit(next);
      focusField(path);
    });
  const relocate = (path: SchemaPath, kind: "indent" | "outdent") => {
    const target = kind === "indent" ? indentField : outdentField;
    try {
      target(current(), path); // 先检查是否可行，避免为不可行操作弹出确认。
    } catch (failure) {
      setNotice((failure as Error).message);
      return;
    }
    protect(path, `${pathLabel(path)} 将${kind === "indent" ? "成为上方对象的子字段" : "提升到上一层"}，字段路径会变化。`, () => {
      const result = target(current(), path);
      commit(result.schema);
      expand(parentOf(result.path));
      focusField(result.path);
    });
  };
  const remove = (path: SchemaPath) => {
    const node = nodeAt(current(), path);
    const children = Boolean(node.items || Object.keys(node.properties ?? {}).length);
    protect(path, `移除 ${pathLabel(path)}${children ? " 及其子字段" : ""}。`, () => commit(removeField(current(), path)), children);
  };
  const changeType = (path: SchemaPath, node: SchemaNode, type: string) => {
    const key = pathKey(path);
    const hasChildren = Boolean(node.items || Object.keys(node.properties ?? {}).length);
    const apply = () => {
      const changed = retype(node, type);
      commit(updateAt(current(), path, () => changed));
      const epoch = (epochs.current[key] ?? 0) + 1;
      epochs.current[key] = epoch;
      if (node.defaultValue == null && !node.enumValues?.length && node.example == null) return setNodeErrors((errors) => ({ ...errors, [key]: "" }));
      setNodeErrors((errors) => ({ ...errors, [key]: "正在检查类型与默认值、枚举、示例…" }));
      void api("/apis/validate-json?kind=schema&request=false", { method: "POST", bodyText: stringifyJson(changed) })
        .then(() => epoch === epochs.current[key] && setNodeErrors((errors) => ({ ...errors, [key]: "" })))
        .catch((failure) => epoch === epochs.current[key] && setNodeErrors((errors) => ({ ...errors, [key]: `请调整值设置：${failure.message}` })));
    };
    protect(path, `类型将改为 ${type}，不兼容的子字段或数组元素会移除；默认值、枚举和示例保留，请检查是否仍符合新类型。`, apply, hasChildren && !(type === "OBJECT" && node.type === "OBJECT"));
  };
  const drag = useSchemaDrag((path, target, after) =>
    attempt(() => {
      const next = current();
      const keys = Object.keys(nodeAt(next, parentOf(path)).properties ?? {});
      if (!keys.includes(target)) return;
      commit(moveField(next, path, target, after));
    }),
  );

  const rows = schema ? visibleRows(schema, collapsed) : [];
  const rootAddPath: SchemaPath | null = !schema
    ? null
    : schema.type === "OBJECT"
      ? []
      : schema.type === "ARRAY" && schema.items?.type === "OBJECT"
        ? ["[]"]
        : null;
  const containers = schema ? containerKeys(schema) : [];

  const actionsFor = (row: SchemaRow) => {
    const { path, node } = row;
    const field = path.at(-1) !== "[]";
    const object = node.type === "OBJECT";
    const keys = field ? Object.keys(nodeAt(schema!, parentOf(path)).properties ?? {}) : [];
    const previous = keys[keys.indexOf(path.at(-1)!) - 1];
    return [
      object && { key: "child", label: "添加子字段", disabled: !canAddChild(schema!, path), onClick: () => add(path) },
      object && { key: "json", label: "从 JSON 生成子字段…", onClick: () => { if (requireAppliedFields()) setJsonPath(path); } },
      field && { key: "below", label: "在下方添加字段", onClick: () => add(parentOf(path), path.at(-1)) },
      field && { type: "divider" as const },
      field && { key: "up", label: "上移", extra: "⌘↑", disabled: row.first, onClick: () => shift(path, -1) },
      field && { key: "down", label: "下移", extra: "⌘↓", disabled: row.last, onClick: () => shift(path, 1) },
      field && {
        key: "indent",
        label: "成为上方对象的子字段",
        extra: "⌘]",
        disabled: !previous || nodeAt(schema!, [...parentOf(path), previous]).type !== "OBJECT",
        onClick: () => relocate(path, "indent"),
      },
      field && { key: "outdent", label: "提升一级", extra: "⌘[", disabled: path.filter((part) => part !== "[]").length < 2, onClick: () => relocate(path, "outdent") },
      field && { type: "divider" as const },
      field && { key: "remove", label: "删除", danger: true, onClick: () => remove(path) },
    ].filter(Boolean) as NonNullable<React.ComponentProps<typeof Dropdown>["menu"]>["items"];
  };

  const toggleAdvanced = async () => {
    if (!advanced) {
      if (!requireAppliedFields()) return;
      setAdvanced(true);
      onAdvancedChange?.(true);
      return;
    }
    setBusy(true);
    setAdvancedError("");
    try {
      const value = await api<SchemaNode>(`/apis/validate-json?kind=schema&request=${request}`, { method: "POST", bodyText: text });
      if (latest.current !== text) throw new Error("输入已变化，请重新校验当前内容。");
      onChange(stringifyJson(value, 2));
      setAdvanced(false);
      onAdvancedChange?.(false);
    } catch (failure) {
      setAdvancedError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const typeOptions = (path: SchemaPath, node?: SchemaNode) =>
    schemaTypes.map((type) => ({ value: type, label: <SchemaTypeLabel type={type} />, disabled: schema ? !canBeContainer(schema, path, type, node) : false }));

  return (
    <section className="op-schema" ref={container}>
      <div className="op-schema__head">
        <h3 aria-label={title}>
          {title} <span className="op-schema__required">*</span>
          <Popover
            trigger={["hover", "click"]}
            title="字段怎么填"
            content={
              <div className="op-schema__help">
                <p>对象包含子字段，数组在“每一项”下描述元素。默认值用于未传字段；示例只用于文档。最多 8 层、200 个节点、每个对象 50 个字段。请求不包含可信租户和人员身份。</p>
                <p>在字段名中：Enter 新增同级字段，⌘↑ / ⌘↓ 调整顺序，⌘] 成为上方对象的子字段，⌘[ 提升一级（Windows 用 Ctrl）。也可拖动左侧手柄调整同级顺序。</p>
              </div>
            }
          >
            <Button type="text" size="small" icon={<QuestionCircleOutlined />} aria-label={`${title}字段帮助`} />
          </Popover>
        </h3>
        <div className="op-schema__tools">
          {!advanced && !pending && !jsonPath && generation && (
            <span className="op-schema__tools" onClickCapture={event => {
              if (!requireAppliedFields()) { event.preventDefault(); event.stopPropagation(); }
            }}>
              {generation}
            </span>
          )}
          {!advanced && containers.length > 0 && (
            <>
              <Button type="text" size="small" onClick={() => setCollapsed(new Set())}>
                展开全部
              </Button>
              <Button type="text" size="small" onClick={() => { if (requireAppliedFields()) setCollapsed(new Set(containers)); }}>
                折叠全部
              </Button>
            </>
          )}
          {allowAdvanced && (
            <Button type="text" size="small" disabled={busy} onClick={() => void toggleAdvanced()}>
              {busy ? "校验中…" : advanced ? "校验并切回字段表" : "高级 JSON"}
            </Button>
          )}
        </div>
      </div>
      {advancedError && (
        <p className="op-config-issue" role="alert">
          {advancedError}
        </p>
      )}
      {!text && (
        <label className="op-schema__root">
          选择响应顶层类型
          <Select
            aria-label="响应根类型"
            style={{ width: 200 }}
            placeholder="请选择真实响应类型"
            onChange={(type: string) => {
              onChange(stringifyJson({ type, ...(type === "OBJECT" ? { properties: {} } : type === "ARRAY" ? { items: { type: "STRING" } } : {}) }, 2));
              setAdvanced(false);
              onAdvancedChange?.(false);
            }}
            options={typeOptions([])}
          />
          <small>选择业务 data 的实际类型后，在字段表中添加字段。</small>
        </label>
      )}
      {advanced ? (
        <label className="op-schema__advanced">
          {title} JSON
          <Input.TextArea
            aria-label={`${title} JSON`}
            className="op-json-editor"
            autoSize={{ minRows: 10, maxRows: 24 }}
            maxLength={262144}
            spellCheck={false}
            value={text}
            onChange={(event) => {
              onChange(event.target.value);
              setAdvancedError("");
            }}
          />
          <small>校验失败会保留全部原文；不会舍入超大整数或高精度小数。</small>
        </label>
      ) : (
        schema && (
          <>
            {!request && (
              <div className="op-schema__root">
                <span>顶层类型</span>
                <Select
                  aria-label={`${title}顶层类型`}
                  size="small"
                  style={{ width: 132 }}
                  value={schema.type}
                  onChange={(type: string) => changeType([], schema, type)}
                  options={typeOptions([], schema)}
                />
                {schema.type === "ARRAY" && <small>客户收到一个数组，“每一项”描述数组元素。</small>}
                {!["OBJECT", "ARRAY"].includes(schema.type) && <small>客户收到单个值，没有子字段。</small>}
              </div>
            )}
            {nodeErrors[pathKey([])] && (
              <p role="alert" className="op-config-issue">
                {nodeErrors[pathKey([])]}
              </p>
            )}
            <div className="op-schema-table__wrap">
              <table className="op-schema-table" aria-label={`${title}字段`}>
                <colgroup>
                  <col className="op-schema-table__col-name" />
                  <col className="op-schema-table__col-type" />
                  <col className="op-schema-table__col-required" />
                  <col />
                  <col className="op-schema-table__col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">字段名</th>
                    <th scope="col">类型</th>
                    <th scope="col">必填</th>
                    <th scope="col">说明</th>
                    <th scope="col">
                      <span className="op-visually-hidden">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const { path, node, key } = row;
                    const label = pathLabel(path);
                    const pointer = fieldPointer(path, request);
                    const open = values?.key === key;
                    const valueSummary = summary(node);
                    const field = path.at(-1) !== "[]";
                    return (
                      <Fragment key={key}>
                        <tr data-field-path={pointer} className={drag.rowClass(row)} {...drag.rowProps(row)}>
                          <td>
                            <NameCell
                              key={`${key}:${resetToken}`}
                              row={row}
                              title={title}
                              request={request}
                              siblings={field ? Object.keys(nodeAt(schema, parentOf(path)).properties ?? {}) : []}
                              onStateChange={state => editorState(`name:${key}`, state)}
                              expanded={!collapsed.has(key)}
                              onToggle={() => {
                                if (!requireAppliedFields()) return;
                                setCollapsed((current) => {
                                  const next = new Set(current);
                                  if (!next.delete(key)) next.add(key);
                                  return next;
                                });
                              }}
                              onRename={(name) => rename(path, name)}
                              keys={{
                                onEnter: (name) => add(parentOf(path), name),
                                onMove: (delta, name) => shift([...parentOf(path), name], delta),
                                onIndent: (name) => relocate([...parentOf(path), name], "indent"),
                                onOutdent: (name) => relocate([...parentOf(path), name], "outdent"),
                              }}
                              dragProps={drag.handleProps(row)}
                            />
                          </td>
                          <td>
                            <Select
                              size="small"
                              className="op-schema-table__type"
                              data-field-path={`${pointer}/type`}
                              aria-label={`${title}${label}类型`}
                              aria-invalid={Boolean(nodeErrors[key])}
                              value={node.type}
                              onChange={(type: string) => changeType(path, node, type)}
                              options={typeOptions(path, node)}
                              popupMatchSelectWidth={false}
                            />
                            {nodeErrors[key] && (
                              <small role="alert" className="op-config-issue">
                                {nodeErrors[key]}
                              </small>
                            )}
                          </td>
                          <td className="op-schema-table__center">
                            <Checkbox
                              aria-label={`${title}${label}必填`}
                              disabled={!field}
                              checked={Boolean(node.required)}
                              onChange={(event) => commit(updateAt(current(), path, (item) => ({ ...item, required: event.target.checked })))}
                            />
                          </td>
                          <td>
                            <Input
                              size="small"
                              data-field-path={`${pointer}/description`}
                              aria-label={`${title}${label}说明`}
                              maxLength={500}
                              placeholder="对调用方说明含义、格式"
                              value={node.description ?? ""}
                              onChange={(event) => commit(updateAt(current(), path, (item) => ({ ...item, description: event.target.value })))}
                            />
                            {valueSummary && <small className="op-schema-table__summary">{valueSummary}</small>}
                          </td>
                          <td className="op-schema-table__actions">
                            <Button
                              type="text"
                              size="small"
                              data-schema-values
                              aria-label={`${label} 值设置`}
                              aria-expanded={open}
                              className={valueSummary ? "has-values" : undefined}
                              icon={<DownOutlined rotate={open ? 180 : 0} />}
                              onClick={() => {
                                if (Object.values(editors).some(state => state.pending)) return setNotice("请先应用字段修改，或使用取消放弃，再切换值设置。");
                                setValues(open ? null : { key });
                              }}
                            />
                            <Dropdown trigger={["click"]} menu={{ items: actionsFor(row) }}>
                              <Button type="text" size="small" aria-label={`${label} 更多操作`} icon={<MoreOutlined />} />
                            </Dropdown>
                          </td>
                        </tr>
                        {open && (
                          <tr className="op-schema-table__detail">
                            <td colSpan={5}>
                              <NodeValues
                                api={api}
                                label={label}
                                node={node}
                                onStateChange={state => editorState("values", state)}
                                focusKind={values?.focus}
                                onNullable={(nullable) => commit(updateAt(current(), path, (item) => ({ ...item, nullable })))}
                                onCancel={() => setValues(null)}
                                onApply={(validated) => {
                                  commit(updateAt(current(), path, latestNode => {
                                    if (latestNode.type !== validated.type) throw new Error("字段类型已变化，请重新校验当前值。");
                                    return { ...latestNode, defaultValue: validated.defaultValue, enumValues: validated.enumValues, example: validated.example };
                                  }));
                                  setValues(null);
                                }}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {!rows.length && (
                    <tr>
                      <td colSpan={5} className="op-schema-table__empty">
                        {["OBJECT", "ARRAY"].includes(schema.type) ? "还没有字段。添加字段，或用右上“JSON 生成字段”从样例生成。" : "顶层是单个值，没有子字段。"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {notice && (
              <p role="alert" className="op-config-issue">
                {notice}
              </p>
            )}
            {rootAddPath && (
              <Button type="dashed" size="small" className="op-schema__add" icon={<PlusOutlined />} disabled={!canAddChild(schema, rootAddPath)} onClick={() => add(rootAddPath)}>
                添加字段
              </Button>
            )}
          </>
        )
      )}
      <Modal
        open={Boolean(pending)}
        title="确认字段变化"
        okText="确认变化"
        cancelText="取消"
        onOk={() => {
          pending?.apply();
          setPending(null);
        }}
        onCancel={() => {
          setPending(null);
          setResetToken((token) => token + 1);
        }}
        destroyOnHidden
      >
        <p>{pending?.message}</p>
      </Modal>
      {jsonPath && schema && (
        <NodeJsonDialog
          api={api}
          root={current()}
          path={jsonPath}
          request={request}
          onCancel={() => setJsonPath(null)}
          onApply={(next, removed) => {
            const path = jsonPath;
            setJsonPath(null);
            const affected = removed.flatMap((item) => affectedMappings(mappings, item));
            const apply = () => {
              commit(next);
              expand(path);
            };
            if (!affected.length) return apply();
            setPending({
              message: `替换会移除 ${removed.map((item) => pathLabel(item)).join("、")}。受影响映射：${affected.map((mapping) => `${mapping.target} ← ${mapping.path}`).join("、")}。映射保持原样，请随后明确调整。`,
              apply,
            });
          }}
        />
      )}
    </section>
  );
}
