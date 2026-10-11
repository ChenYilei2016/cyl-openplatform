import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CaretDownOutlined, CaretRightOutlined, HolderOutlined } from "@ant-design/icons";
import { Input } from "antd";
import type { InputRef } from "antd";
import { nameError, pathLabel, type SchemaRow } from "./schemaTree";

/** 快捷键动作收到提交后的字段名（改名后路径已变化）。 */
export interface NameKeys {
  /** Enter：提交名称并在下方新增同级字段。 */
  onEnter: (name: string) => void;
  onMove: (delta: -1 | 1, name: string) => void;
  onIndent: (name: string) => void;
  onOutdent: (name: string) => void;
}

/**
 * 字段名单元格：固定展开槽 + 每级 16px 缩进（沿用 98 对齐规范），名称行内编辑。
 * 名称在失焦或 Enter 时提交；不合法时保留输入并就地提示，Esc 还原。
 */
export default function NameCell({
  row,
  title,
  request,
  siblings,
  expanded,
  onToggle,
  onRename,
  keys,
  dragProps,
  onStateChange,
}: {
  row: SchemaRow;
  title: string;
  request: boolean;
  siblings: string[];
  expanded: boolean;
  onToggle: () => void;
  /** 返回 true 表示已立即生效；false 表示等待确认（受影响映射）。 */
  onRename: (name: string) => boolean;
  keys: NameKeys;
  dragProps: React.HTMLAttributes<HTMLSpanElement> & { draggable?: boolean };
  onStateChange?: (state: { pending: boolean; busy: boolean }) => void;
}) {
  const name = row.path.at(-1)!;
  const item = name === "[]";
  const [value, setValue] = useState(name);
  const [error, setError] = useState("");
  const input = useRef<InputRef>(null);
  const report = useRef(onStateChange);
  report.current = onStateChange;
  const pending = value !== name;
  useEffect(() => {
    input.current?.input?.setCustomValidity(pending ? error || "字段名尚未应用，请按 Enter 或失焦确认，Esc 撤销。" : "");
    report.current?.({ pending, busy: false });
  }, [pending, error]);
  useEffect(() => () => report.current?.({ pending: false, busy: false }), []);
  useEffect(() => {
    setValue(name);
    setError("");
  }, [name]);
  const label = pathLabel(row.path);
  /** 返回生效后的字段名；不合法或等待确认时返回 null。 */
  const commit = (): string | null => {
    if (value === name) return name;
    const problem = nameError(value, siblings, request, name);
    setError(problem);
    if (problem) return null;
    return onRename(value) ? value : null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === "Escape") {
      setValue(name);
      setError("");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const committed = commit();
      if (committed) keys.onEnter(committed);
      return;
    }
    if (!mod) return;
    const action =
      event.key === "ArrowUp"
        ? (current: string) => keys.onMove(-1, current)
        : event.key === "ArrowDown"
          ? (current: string) => keys.onMove(1, current)
          : event.key === "]"
            ? keys.onIndent
            : event.key === "["
              ? keys.onOutdent
              : null;
    if (!action) return;
    event.preventDefault();
    const committed = commit();
    if (committed) action(committed);
  };
  return (
    <div className="op-schema-name" style={{ paddingLeft: row.depth * 16 }}>
      {item ? (
        <span className="op-schema-name__handle" aria-hidden />
      ) : (
        <span className="op-schema-name__handle" title="拖动调整顺序" aria-hidden {...dragProps}>
          <HolderOutlined />
        </span>
      )}
      {row.hasChildren ? (
        <button
          type="button"
          className="op-schema-name__toggle"
          aria-label={`${expanded ? "折叠" : "展开"} ${label}`}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
        </button>
      ) : (
        <span className="op-schema-name__toggle" aria-hidden />
      )}
      {item ? (
        <span className="op-schema-name__item">每一项</span>
      ) : (
        <div className="op-schema-name__field">
          <Input
            ref={input}
            size="small"
            variant="borderless"
            className="op-schema-name__input"
            data-name-key={row.key}
            aria-label={`${title}字段 ${label} 名称`}
            aria-invalid={Boolean(error)}
            status={error ? "error" : undefined}
            maxLength={64}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError("");
            }}
            onBlur={commit}
            onKeyDown={onKeyDown}
          />
        </div>
      )}
      {error && (
        <span role="alert" className="op-schema-name__error">
          {error}
        </span>
      )}
    </div>
  );
}
