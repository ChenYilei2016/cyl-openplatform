import { CloseOutlined, FilterOutlined, SettingOutlined } from "@ant-design/icons";
import { Badge, Button, Checkbox, Input, Pagination, Popover, Segmented, Select, Table, Tooltip, type SelectProps, type TableColumnsType, type TableProps } from "antd";
import { useEffect, useMemo, useRef, useState, type Key, type ReactNode } from "react";
import { EmptyState } from "./components";

/* -------------------------------- 防抖值 --------------------------------- */

/** 文本筛选防抖：停止输入后再提交，避免每个按键都查询。 */
export function useDebouncedCallback<T>(callback: (value: T) => void, delay = 300) {
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return useMemo(
    () => ({
      run(value: T) {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => latest.current(value), delay);
      },
      flush(value: T) {
        window.clearTimeout(timer.current);
        latest.current(value);
      },
      cancel() {
        window.clearTimeout(timer.current);
      },
    }),
    [delay],
  );
}

/* ------------------------------ 快捷筛选 -------------------------------- */

export type QuickSelectProps = Omit<SelectProps, "prefix" | "placeholder"> & { label: string; placeholder?: string };

/** 一行内的快捷筛选：标签写在控件内，选中即生效。 */
export function QuickSelect({ label, placeholder = "全部", className, ...props }: QuickSelectProps) {
  return (
    <Select
      {...props}
      aria-label={label}
      prefix={<span className="op-quick-select__label">{label}</span>}
      placeholder={placeholder}
      className={`op-quick-select${className ? ` ${className}` : ""}`}
      popupMatchSelectWidth={false}
      maxTagCount={props.mode ? 1 : undefined}
      maxTagPlaceholder={(omitted) => `+${omitted.length}`}
    />
  );
}

/* ------------------------------ 时间范围 -------------------------------- */

export type TimeRangePreset = "1h" | "24h" | "7d" | "custom";
/** 时间范围条件：快捷项按“当前时刻往前”计算；自定义时 from/to 为 ISO 时间。 */
export interface TimeRangeValue {
  preset: TimeRangePreset;
  from?: string;
  to?: string;
}

const presetMillis: Record<Exclude<TimeRangePreset, "custom">, number> = { "1h": 3_600_000, "24h": 86_400_000, "7d": 604_800_000 };
export const timeRangeLabels: Record<TimeRangePreset, string> = { "1h": "近 1 小时", "24h": "近 24 小时", "7d": "近 7 天", custom: "自定义" };

/** 换算为查询用的绝对时间；自定义缺少端点时该端不限。 */
export function resolveTimeRange(value: TimeRangeValue, now = Date.now()): { from?: string; to?: string } {
  if (value.preset === "custom") return { from: value.from || undefined, to: value.to || undefined };
  return { from: new Date(now - presetMillis[value.preset]).toISOString(), to: new Date(now).toISOString() };
}

/** 筛选标签用的文字，如“近 24 小时”或“10-01 08:00 至 10-01 12:00”。 */
export function timeRangeText(value: TimeRangeValue) {
  if (value.preset !== "custom") return timeRangeLabels[value.preset];
  const format = (iso?: string) => (iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "不限");
  return `${format(value.from)} 至 ${format(value.to)}`;
}

const toLocalInput = (iso?: string) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (text: string) => (text ? new Date(text).toISOString() : undefined);

/** 时间快捷切换（近 1 小时 / 24 小时 / 7 天 / 自定义），选择即生效；自定义在弹层内确认。 */
export function TimeRangeFilter({ value, onChange, presets = ["1h", "24h", "7d", "custom"] }: { value: TimeRangeValue; onChange: (value: TimeRangeValue) => void; presets?: TimeRangePreset[] }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from: toLocalInput(value.from), to: toLocalInput(value.to) });
  useEffect(() => {
    if (open) setDraft({ from: toLocalInput(value.from), to: toLocalInput(value.to) });
  }, [open]);
  const invalid = !!draft.from && !!draft.to && draft.from > draft.to;
  return (
    <span className="op-time-range">
      <Segmented<TimeRangePreset>
        aria-label="时间范围"
        value={value.preset}
        options={presets.map((preset) => ({ value: preset, label: preset === "custom" && value.preset === "custom" ? timeRangeText(value) : timeRangeLabels[preset] }))}
        onChange={(preset) => (preset === "custom" ? setOpen(true) : onChange({ preset }))}
      />
      <Popover
        open={open}
        onOpenChange={setOpen}
        trigger="click"
        placement="bottomRight"
        content={
          <div className="op-time-range__custom">
            <label>
              <span>开始</span>
              <Input type="datetime-local" aria-label="开始时间" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
            </label>
            <label>
              <span>结束</span>
              <Input type="datetime-local" aria-label="结束时间" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
            </label>
            {invalid && <span className="op-time-range__error">开始时间不能晚于结束时间</span>}
            <div className="op-time-range__actions">
              <Button size="small" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button
                size="small"
                type="primary"
                disabled={invalid || (!draft.from && !draft.to)}
                onClick={() => {
                  onChange({ preset: "custom", from: fromLocalInput(draft.from), to: fromLocalInput(draft.to) });
                  setOpen(false);
                }}
              >
                应用
              </Button>
            </div>
          </div>
        }
      >
        <span className="op-time-range__anchor" aria-hidden />
      </Popover>
    </span>
  );
}

/* ------------------------------- 筛选栏 --------------------------------- */

export interface FilterChip {
  key: string;
  label: ReactNode;
  /** 用于可访问名称，如“协议：HTTP”。 */
  text: string;
  onRemove: () => void;
}

export interface FilterBarProps {
  search: ReactNode;
  quick?: ReactNode;
  /** “更多筛选”中已生效的条件数；为 undefined 时不显示按钮。 */
  moreCount?: number;
  onMore?: () => void;
  chips: FilterChip[];
  onClearAll: () => void;
}

/** 全站唯一筛选形态：一行搜索 + 快捷筛选 + 更多筛选；已生效条件以可删除标签汇总。 */
export function FilterBar({ search, quick, moreCount, onMore, chips, onClearAll }: FilterBarProps) {
  return (
    <div className="op-filter-bar" role="search">
      <div className="op-filter-bar__row">
        <div className="op-filter-bar__search">{search}</div>
        {quick}
        {onMore && (
          <Badge count={moreCount} size="small" offset={[-4, 4]}>
            <Button icon={<FilterOutlined aria-hidden />} onClick={onMore}>
              更多筛选
            </Button>
          </Badge>
        )}
      </div>
      {chips.length > 0 && (
        <div className="op-filter-bar__chips" role="group" aria-label="已生效的筛选条件">
          <span className="op-filter-bar__chips-label">已筛选</span>
          {chips.map((chip) => (
            <span key={chip.key} className="op-filter-chip">
              <span className="op-filter-chip__text">{chip.label}</span>
              <button type="button" className="op-filter-chip__remove" aria-label={`清除 ${chip.text}`} onClick={chip.onRemove}>
                <CloseOutlined aria-hidden />
              </button>
            </span>
          ))}
          <Button type="link" size="small" onClick={onClearAll}>
            清除全部
          </Button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- 数据表 --------------------------------- */

export type SortOrder = "ascend" | "descend";
export interface DataTableColumn<T> {
  key: string;
  title: ReactNode;
  /** 列设置里显示的名称。 */
  label?: string;
  render: (record: T, index: number) => ReactNode;
  width?: number | string;
  align?: "left" | "right" | "center";
  /** 可服务端排序时提供排序字段名。 */
  sortField?: string;
  /** 是否允许在列设置中隐藏；默认允许，首列与操作列应设为 false。 */
  hideable?: boolean;
  defaultHidden?: boolean;
  fixed?: "left" | "right";
  ellipsis?: boolean;
}

export interface DataTableProps<T> {
  rowKey: (record: T) => Key;
  columns: DataTableColumn<T>[];
  data: T[];
  loading?: boolean;
  /** 首次加载且无数据时显示骨架。 */
  sort?: { field: string; order: SortOrder } | null;
  onSortChange?: (sort: { field: string; order: SortOrder } | null) => void;
  pagination?: { page: number; pageSize: number; total: number; onChange: (page: number, pageSize: number) => void; pageSizeOptions?: number[] };
  /** 列显示设置的本地存储键；为空时不提供列设置。 */
  settingsKey?: string;
  /** 强制显示的列（例如对应的筛选正在生效）。 */
  forceVisible?: string[];
  empty?: ReactNode;
  rowClassName?: (record: T) => string;
  /** 点击行打开详情（日志类列表）；点击行内按钮、链接、输入框或可复制编号时不触发。键盘入口仍由首列按钮提供。 */
  onRowClick?: (record: T) => void;
  caption?: string;
  toolbar?: ReactNode;
  summary?: ReactNode;
}

const readHidden = (key: string | undefined, defaults: string[]) => {
  if (!key) return defaults;
  try {
    const value = JSON.parse(window.localStorage.getItem(`op-columns:${key}`) ?? "null");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : defaults;
  } catch {
    return defaults;
  }
};

/** antd Table 封装：紧凑行高、服务端排序、列设置（本地记住）、统一空态与分页。 */
export function DataTable<T extends object>({ rowKey, columns, data, loading, sort, onSortChange, pagination, settingsKey, forceVisible = [], empty, rowClassName, onRowClick, caption, toolbar, summary }: DataTableProps<T>) {
  const defaults = columns.filter((column) => column.defaultHidden).map((column) => column.key);
  const [hidden, setHidden] = useState(() => readHidden(settingsKey, defaults));
  const saveHidden = (next: string[]) => {
    setHidden(next);
    if (settingsKey)
      try {
        window.localStorage.setItem(`op-columns:${settingsKey}`, JSON.stringify(next));
      } catch {
        /* 本地存储不可用时只在本页生效。 */
      }
  };
  const visible = columns.filter((column) => !hidden.includes(column.key) || forceVisible.includes(column.key));
  const antColumns: TableColumnsType<T> = visible.map((column) => ({
    key: column.key,
    dataIndex: column.key,
    title: column.title,
    width: column.width,
    align: column.align,
    fixed: column.fixed,
    ellipsis: column.ellipsis,
    render: (_: unknown, record: T, index: number) => column.render(record, index),
    ...(column.sortField
      ? {
          sorter: true,
          sortOrder: sort?.field === column.sortField ? sort.order : null,
          sortDirections: ["descend", "ascend"] as SortOrder[],
        }
      : {}),
  }));
  const onChange: TableProps<T>["onChange"] = (_pagination, _filters, sorter, extra) => {
    if (extra.action !== "sort" || !onSortChange) return;
    const current = Array.isArray(sorter) ? sorter[0] : sorter;
    const column = columns.find((item) => item.key === current?.columnKey);
    onSortChange(current?.order && column?.sortField ? { field: column.sortField, order: current.order } : null);
  };
  const hideable = columns.filter((column) => column.hideable !== false);
  return (
    <div className="op-data-table">
      {(toolbar || summary || settingsKey) && (
        <div className="op-data-table__toolbar">
          <div className="op-data-table__summary" aria-live="polite">{summary}</div>
          <div className="op-data-table__tools">
            {toolbar}
            {settingsKey && hideable.length > 0 && (
              <Popover
                trigger="click"
                placement="bottomRight"
                content={
                  <div className="op-column-settings" role="group" aria-label="显示的列">
                    {hideable.map((column) => (
                      <Checkbox
                        key={column.key}
                        checked={!hidden.includes(column.key) || forceVisible.includes(column.key)}
                        disabled={forceVisible.includes(column.key)}
                        onChange={(event) => saveHidden(event.target.checked ? hidden.filter((key) => key !== column.key) : [...hidden, column.key])}
                      >
                        {column.label ?? (typeof column.title === "string" ? column.title : column.key)}
                      </Checkbox>
                    ))}
                  </div>
                }
              >
                <Tooltip title="列设置">
                  <Button type="text" icon={<SettingOutlined aria-hidden />} aria-label="列设置" />
                </Tooltip>
              </Popover>
            )}
          </div>
        </div>
      )}
      <Table<T>
        className="op-data-table__table"
        rowKey={rowKey}
        columns={antColumns}
        dataSource={data}
        loading={loading && data.length > 0}
        pagination={false}
        size="middle"
        tableLayout="fixed"
        onChange={onChange}
        rowClassName={onRowClick ? (record) => `op-data-table__row--clickable ${rowClassName?.(record) ?? ""}`.trim() : rowClassName}
        onRow={
          onRowClick
            ? (record) => ({
                onClick: (event) => {
                  if (event.target instanceof Element && event.target.closest("button, a, input, [role='button'], .op-id")) return;
                  onRowClick(record);
                },
              })
            : undefined
        }
        showSorterTooltip={false}
        aria-label={caption}
        locale={{
          emptyText: loading ? <EmptyState title="正在加载…" /> : (empty ?? <EmptyState />),
        }}
      />
      {pagination && pagination.total > 0 && (
        <div className="op-data-table__pagination">
          <span className="op-muted">共 {pagination.total} 条</span>
          <Pagination
            current={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            showSizeChanger
            pageSizeOptions={pagination.pageSizeOptions ?? [20, 50, 100]}
            onChange={pagination.onChange}
            disabled={loading}
            size="small"
          />
        </div>
      )}
    </div>
  );
}
