import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DataTable, FilterBar, resolveTimeRange, timeRangeText, useDebouncedCallback } from "./list";
import { PlatformTheme } from "./PlatformTheme";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

test("已生效条件可逐个清除，也可一键清除；无条件时不显示条件条", () => {
  const removeA = vi.fn(), clear = vi.fn();
  const view = render(<FilterBar search={<input aria-label="搜索" />} chips={[{ key: "a", text: "协议：HTTP", label: "协议：HTTP", onRemove: removeA }]} onClearAll={clear} onMore={vi.fn()} moreCount={2} />);
  fireEvent.click(screen.getByRole("button", { name: "清除 协议：HTTP" }));
  expect(removeA).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /清除全部/ }));
  expect(clear).toHaveBeenCalled();
  view.rerender(<FilterBar search={<input aria-label="搜索" />} chips={[]} onClearAll={clear} />);
  expect(screen.queryByRole("group", { name: "已生效的筛选条件" })).toBeNull();
  expect(screen.queryByRole("button", { name: /更多筛选/ })).toBeNull();
});

test("防抖只提交最后一次输入；flush 立即提交并取消等待", async () => {
  vi.useFakeTimers();
  const seen: string[] = [];
  let api: ReturnType<typeof useDebouncedCallback<string>> | undefined;
  function Probe() {
    api = useDebouncedCallback((value: string) => seen.push(value), 300);
    return null;
  }
  render(<Probe />);
  api!.run("a");
  api!.run("ab");
  await act(async () => { vi.advanceTimersByTime(299); });
  expect(seen).toEqual([]);
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(seen).toEqual(["ab"]);
  api!.run("abc");
  api!.flush("abcd");
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(seen).toEqual(["ab", "abcd"]);
});

const rows = [{ id: "1", name: "订单查询", category: "订单" }];
const columns = [
  { key: "name", title: "名称", hideable: false, render: (row: (typeof rows)[number]) => row.name },
  { key: "category", title: "分类", render: (row: (typeof rows)[number]) => row.category },
  { key: "updated", title: "更新时间", sortField: "updated", render: () => "—" },
  { key: "internal", title: "内部定位", defaultHidden: true, render: () => "OrderFacade" },
];

test("服务端排序：点击列头回调排序字段；列设置隐藏的列被记住，强制显示的列不可隐藏", async () => {
  const onSort = vi.fn();
  const view = render(<PlatformTheme><DataTable rowKey={(row) => row.id} columns={columns} data={rows} settingsKey="t" onSortChange={onSort} sort={null} /></PlatformTheme>);
  expect(screen.queryByRole("columnheader", { name: "内部定位" })).toBeNull();
  fireEvent.click(screen.getByRole("columnheader", { name: /更新时间/ }));
  expect(onSort).toHaveBeenCalledWith({ field: "updated", order: "descend" });
  fireEvent.click(screen.getByRole("button", { name: "列设置" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "分类" }));
  await waitFor(() => expect(screen.queryByRole("columnheader", { name: "分类" })).toBeNull());
  view.unmount();
  render(<PlatformTheme><DataTable rowKey={(row) => row.id} columns={columns} data={rows} settingsKey="t" forceVisible={["internal"]} /></PlatformTheme>);
  expect(screen.queryByRole("columnheader", { name: "分类" })).toBeNull();
  expect(screen.getByRole("columnheader", { name: "内部定位" })).toBeTruthy();
});

test("无数据时显示调用方提供的空态，分页总数为 0 时不显示分页", () => {
  render(<DataTable rowKey={(row: (typeof rows)[number]) => row.id} columns={columns} data={[]} empty={<p>没有符合条件的结果</p>} pagination={{ page: 1, pageSize: 20, total: 0, onChange: vi.fn() }} />);
  expect(screen.getByText("没有符合条件的结果")).toBeTruthy();
  expect(screen.queryByText(/共 0 条/)).toBeNull();
});

test('时间范围快捷项按当前时刻换算，自定义保留端点并生成标签文字', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  expect(resolveTimeRange({ preset: '1h' }, now)).toEqual({ from: '2026-10-02T11:00:00.000Z', to: '2026-10-02T12:00:00.000Z' });
  expect(resolveTimeRange({ preset: '7d' }, now).from).toBe('2026-09-25T12:00:00.000Z');
  expect(resolveTimeRange({ preset: 'custom', from: '2026-10-01T00:00:00.000Z' }, now)).toEqual({ from: '2026-10-01T00:00:00.000Z', to: undefined });
  expect(timeRangeText({ preset: '24h' })).toBe('近 24 小时');
  expect(timeRangeText({ preset: 'custom' })).toBe('不限 至 不限');
});
