import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  ClassRef,
  ConfirmAction,
  DisabledReason,
  EmptyState,
  EntityDrawer,
  IdText,
  PageHeader,
  PersonTag,
  ReadonlyField,
  defineStatusMap,
  middleEllipsis,
} from "./components";
import { PlatformTheme } from "./PlatformTheme";
import { cssVariables, themeConfig } from "./tokens";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("技术编号过长时中间省略，复制的是完整值", async () => {
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  const value = "c24b24015416432f935722dc0c16eaa4";
  render(<IdText value={value} label="AK" maxChars={13} />);
  expect(screen.getByText(middleEllipsis(value, 13))).toBeTruthy();
  expect(screen.queryByText(value)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "复制AK" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(value));
  expect(await screen.findByRole("button", { name: "已复制AK" })).toBeTruthy();
});

test("短编号原样显示；内部类显示简名，复制全限定名", async () => {
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  render(<>
    <IdText value="r12" copyable={false} />
    <ClassRef className="io.github.chenyilei2016.example.order.OrderQueryFacade" method="lookup" />
  </>);
  expect(screen.getByText("r12")).toBeTruthy();
  expect(screen.getByText("OrderQueryFacade#lookup")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "复制全限定名" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("io.github.chenyilei2016.example.order.OrderQueryFacade#lookup"));
});

test("人员优先显示姓名与工号；无档案时显示轻量未登记", () => {
  render(<>
    <PersonTag name="示例人员" employeeNo="E1001" tenantName="示例租户" />
    <PersonTag name={null} />
  </>);
  expect(screen.getByText("示例人员")).toBeTruthy();
  expect(screen.getByText("工号 E1001 · 示例租户")).toBeTruthy();
  expect(screen.getByText("未登记")).toBeTruthy();
});

test("状态映射集中登记，未登记值以中性样式原样显示", () => {
  const publication = defineStatusMap({
    PUBLISHED: { tone: "success", label: "已发布" },
    UNPUBLISHED: { tone: "neutral", label: "未发布" },
  });
  render(<>
    <publication.Badge value="PUBLISHED" detail="r3" />
    <publication.Badge value="SOMETHING_NEW" />
  </>);
  expect(screen.getByText("已发布")).toBeTruthy();
  expect(screen.getByText("r3")).toBeTruthy();
  expect(screen.getByText("SOMETHING_NEW")).toBeTruthy();
  expect(publication.get(undefined)).toEqual({ tone: "neutral", label: "未知" });
});

test("页头只显示有的部分，低频动作收进更多", async () => {
  const onMore = vi.fn();
  render(<PageHeader title="API 列表" count={67} primaryAction={<button>新建 API</button>} moreActions={[{ key: "categories", label: "分类管理" }]} onMoreAction={onMore} />);
  expect(screen.getByRole("heading", { level: 1, name: /API 列表/ })).toBeTruthy();
  expect(screen.getByLabelText("共 67 项")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.click(await screen.findByText("分类管理"));
  expect(onMore).toHaveBeenCalledWith("categories");
});

test("只读字段显示为文字而不是禁用输入框", () => {
  render(<ReadonlyField label="服务标识" value="order" code reason="已发布后不可修改" />);
  const group = screen.getByRole("group", { name: "服务标识" });
  expect(group.textContent).toContain("order");
  expect(group.querySelector("input")).toBeNull();
  expect(screen.getByLabelText("不可修改：已发布后不可修改")).toBeTruthy();
});

test("抽屉可用 Esc 关闭并显示标题与页签", async () => {
  const onClose = vi.fn();
  render(<EntityDrawer open title="联调 · 订单凭据" onClose={onClose} tabs={[{ key: "overview", label: "概览", children: "概览内容" }, { key: "tokens", label: "Token", children: "Token 内容" }]} activeTab="overview" />);
  expect(await screen.findByRole("heading", { name: "联调 · 订单凭据" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Token" })).toBeTruthy();
  expect(screen.getByText("概览内容")).toBeTruthy();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test("需要原因的确认：取消不执行，填写原因后才能确认", async () => {
  const onConfirm = vi.fn(async () => undefined);
  render(<PlatformTheme><ConfirmAction title="停用凭据" danger reason={{ label: "停用原因" }} onConfirm={onConfirm}><button>停用</button></ConfirmAction></PlatformTheme>);
  fireEvent.click(screen.getByRole("button", { name: "停用" }));
  const ok = await screen.findByRole("button", { name: "确认" });
  expect((ok as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "停用" }));
  fireEvent.change(await screen.findByLabelText("停用原因"), { target: { value: "接入方下线" } });
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("接入方下线"));
});

test("空态区分无数据、无结果与错误，并提供动作", () => {
  const clear = vi.fn();
  render(<>
    <EmptyState kind="noResult" action={<button onClick={clear}>清除筛选</button>} />
    <EmptyState kind="error" description="网络超时" />
  </>);
  expect(screen.getByText("没有符合条件的结果")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
  expect(clear).toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("网络超时");
});

test("令牌同时生成 antd 主题与 CSS 变量，主色与控件尺寸一致", () => {
  const admin = themeConfig("admin", "light");
  expect(admin.token?.colorPrimary).toBe("#335cff");
  expect(admin.token?.controlHeight).toBe(32);
  expect(admin.token?.borderRadius).toBe(6);
  expect(cssVariables("light")["--op-color-primary"]).toBe("#335cff");
  expect(cssVariables("light")["--op-control-md"]).toBe("32px");
  expect(cssVariables("dark")["--op-color-bg-layout"]).not.toBe(cssVariables("light")["--op-color-bg-layout"]);
  render(<PlatformTheme variant="portal" mode="dark"><span>门户</span></PlatformTheme>);
  expect(document.querySelector('style[data-op-tokens="portal-dark"]')?.textContent).toContain("--op-color-primary");
});

test("不可用按钮悬停或聚焦外层时说明原因；恢复可用时按钮不重新挂载", async () => {
  const { rerender } = render(
    <DisabledReason reason="需要连接管理权限">
      <button type="button" disabled>
        新增连接
      </button>
    </DisabledReason>,
  );
  const button = screen.getByRole("button", { name: "新增连接" });
  const wrapper = button.parentElement!;
  expect(wrapper.getAttribute("tabindex")).toBe("0");
  fireEvent.mouseEnter(wrapper);
  expect(await screen.findByText("需要连接管理权限")).toBeTruthy();
  rerender(
    <DisabledReason>
      <button type="button">新增连接</button>
    </DisabledReason>,
  );
  expect(screen.getByRole("button", { name: "新增连接" })).toBe(button);
  expect(wrapper.hasAttribute("tabindex")).toBe(false);
});

test('抽屉被条件卸载时也把焦点还给仍存在的触发按钮', async () => {
  const trigger = document.createElement('button');
  trigger.textContent = '查看凭据'; document.body.append(trigger); trigger.focus();
  const view = render(<EntityDrawer open title="详情" onClose={() => {}}><button>抽屉内操作</button></EntityDrawer>);
  const action = await screen.findByRole('button', { name: '抽屉内操作' });
  action.focus(); expect(document.activeElement).toBe(action);
  view.unmount(); expect(document.activeElement).toBe(trigger);
  trigger.remove();
});

test('常驻抽屉再次从另一按钮打开时，恢复到本次触发位置', async () => {
  const first = document.createElement('button'), second = document.createElement('button');
  document.body.append(first, second);
  const drawer = (open: boolean) => <EntityDrawer open={open} title="再次打开" onClose={() => {}}><button>内容操作</button></EntityDrawer>;
  first.focus(); const view = render(drawer(true));
  (await screen.findByRole('button', { name: '内容操作' })).focus();
  view.rerender(drawer(false));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(first);
  second.focus(); view.rerender(drawer(true));
  (await screen.findByRole('button', { name: '内容操作' })).focus();
  view.rerender(drawer(false));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(second);
  view.unmount(); first.remove(); second.remove();
});
