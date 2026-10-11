import { SearchOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Drawer, Input, type ThemeConfig } from "antd";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { TimeRangeValue } from "@cyl/open-platform-web-shared/ui/list";
import { queryWindow } from "./model";

/** 日志类列表单行约 36px（106 第 5.2 节）：只调表格主题令牌，不覆盖 antd 内部类名。 */
const compactTable: ThemeConfig = { components: { Table: { cellPaddingBlockMD: 7 } } };
export function CompactRows({ children }: { children: ReactNode }) {
  return <ConfigProvider theme={compactTable}>{children}</ConfigProvider>;
}

/** 列表时间：同年省略年份，精确到秒，便于与报错时间对照。 */
export function rowTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "无效时间";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString("zh-CN", {
    ...(sameYear ? {} : { year: "numeric" }),
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * 查询时间窗口：快捷项按“当前时刻往前”计算，只在时间条件变化或手动刷新时重取当前时刻，
 * 翻页与其他条件沿用同一窗口，避免每次渲染改变查询。
 */
export function useQueryWindow(range: TimeRangeValue, revision: number) {
  const key = JSON.stringify(range);
  const now = useMemo(() => Date.now(), [key, revision]);
  return useMemo(() => queryWindow(range, now), [key, now]);
}

/** 请求号精确定位：粘贴或回车立即生效，清空即取消；未提交的输入不进入地址。 */
export function RequestIdSearch({ value, onSubmit }: { value: string; onSubmit: (requestId: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Input
      allowClear
      aria-label="请求号（精确）"
      prefix={<SearchOutlined aria-hidden />}
      placeholder="粘贴 requestId 精确定位"
      maxLength={64}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        if (!event.target.value && value) onSubmit("");
      }}
      onPaste={(event) => {
        const pasted = event.clipboardData.getData("text").trim().slice(0, 64);
        if (!pasted) return;
        event.preventDefault();
        setText(pasted);
        onSubmit(pasted);
      }}
      onPressEnter={(event) => {
        if (!(event.nativeEvent as KeyboardEvent).isComposing) onSubmit(text.trim());
      }}
    />
  );
}

/** “更多筛选”面板：组合条件先编辑，点“应用”后一次生效。 */
export function MoreFiltersDrawer({
  open,
  onClose,
  onApply,
  onClear,
  applyDisabled,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onApply: () => void;
  onClear: () => void;
  applyDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="更多筛选"
      size={400}
      destroyOnHidden
      footer={
        <div className="op-drawer-footer">
          <Button onClick={onClear}>清除这些条件</Button>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" disabled={applyDisabled} onClick={onApply}>
            应用
          </Button>
        </div>
      }
    >
      <div className="op-more-filters">{children}</div>
    </Drawer>
  );
}
