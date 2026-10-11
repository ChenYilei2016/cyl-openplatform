import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import UserGrantsPanel from "./UserGrantsPanel";
import { AdminApiError, type AdminApi, type TenantGrant } from "./api";
import { AdminNavigationProvider } from "../navigation/AdminNavigation";

const grant: TenantGrant = {
  id: "g1",
  applicationId: "a1",
  tenantId: "t1",
  status: "ACTIVE",
  authorizationVersion: 0,
};
const person = {
  tenantId: "t1",
  userId: "u1",
  employeeId: "e1",
  employeeNo: "E001",
  displayName: "张三",
  enabled: true,
};
const row = {
  ...person,
  id: "ug1",
  tenantGrantId: "g1",
  status: "ACTIVE",
  authorizationVersion: 5,
};
const page = (items: unknown[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 20,
});
function setup(
  override?: (path: string, options?: Parameters<AdminApi>[1]) => unknown,
  enabled = true,
) {
  const api = vi.fn(async (path: string, options?: Parameters<AdminApi>[1]) => {
    const result = override?.(path, options);
    if (result !== undefined) return result;
    if (path.endsWith("/employee-lookup")) return person;
    if (path.startsWith("/employee-profiles"))
      return page([{ ...person, lastSeenAt: "2026-09-27T01:00:00Z" }]);
    return page([]);
  });
  render(
    <AdminNavigationProvider>
      <UserGrantsPanel
        api={api as AdminApi}
        grant={grant}
        applicationEnabled={enabled}
        onClose={vi.fn()}
        onEditState={vi.fn()}
      />
    </AdminNavigationProvider>,
  );
  return api;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  history.replaceState({}, "", "/");
});
async function verify() {
  fireEvent.change(screen.getByLabelText("委托员工号"), {
    target: { value: "E001" },
  });
  fireEvent.click(screen.getByRole("button", { name: "核验员工" }));
  await screen.findByRole("button", { name: "确认建立委托" });
}

test("姓名选择内嵌且取消保留输入，旧档案不匹配当前人员时不能授权", async () => {
  const api = setup((path) =>
    path.endsWith("/employee-lookup")
      ? { ...person, employeeId: "reassigned" }
      : undefined,
  );
  fireEvent.change(screen.getByLabelText("委托员工号"), {
    target: { value: "unfinished" },
  });
  fireEvent.click(screen.getByRole("button", { name: "按姓名选择" }));
  await screen.findByRole("button", { name: "选择 张三 · E001" });
  fireEvent.click(screen.getByRole("button", { name: "收起姓名选择" }));
  expect(screen.getByLabelText("委托员工号")).toHaveProperty(
    "value",
    "unfinished",
  );
  fireEvent.click(screen.getByRole("button", { name: "按姓名选择" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "选择 张三 · E001" }),
  );
  await screen.findByText("该工号对应的人员已变化或不可委托，请重新核验。");
  expect(screen.queryByRole("button", { name: "确认建立委托" })).toBeNull();
  expect(
    api.mock.calls.some(
      ([p]) => p.includes("tenantId=t1") && p.includes("pageSize=20"),
    ),
  ).toBe(true);
  expect(
    api.mock.calls.some(
      ([p, o]) => p.endsWith("/users") && o?.method === "POST",
    ),
  ).toBe(false);
});

test("可信预览确认后提交稳定标识，冲突关闭错误不会恢复旧确认", async () => {
  const api = setup((path, options) =>
    path.endsWith("/users") && options?.method === "POST"
      ? Promise.reject(new AdminApiError("人员身份已变化，请重新核验", 409))
      : undefined,
  );
  await verify();
  fireEvent.click(screen.getByRole("button", { name: "确认建立委托" }));
  await screen.findByText("人员身份已变化，请重新核验");
  const write = api.mock.calls.find(
    ([p, o]) => p.endsWith("/users") && o?.method === "POST",
  );
  expect(write?.[1]?.body).toEqual({
    employeeNo: "E001",
    expectedUserId: "u1",
    expectedEmployeeId: "e1",
  });
  fireEvent.click(screen.getByRole("button", { name: "关闭错误提示" }));
  expect(screen.queryByRole("button", { name: "确认建立委托" })).toBeNull();
  expect(screen.getByLabelText("委托员工号")).toHaveProperty("value", "E001");
});

test("已有有效委托提前说明且不出现重复提交动作，撤销带版本并保留其他输入", async () => {
  const api = setup((path) =>
    path.includes("/users?") ? page([row]) : undefined,
  );
  fireEvent.change(screen.getByLabelText("委托员工号"), {
    target: { value: "E001" },
  });
  fireEvent.click(screen.getByRole("button", { name: "核验员工" }));
  await screen.findByText("已有有效委托，无需重复建立。");
  expect(screen.queryByRole("button", { name: "确认建立委托" })).toBeNull();
  fireEvent.change(screen.getByLabelText("委托员工号"), {
    target: { value: "other-person" },
  });
  fireEvent.click(screen.getByRole("button", { name: "撤销 E001" }));
  const confirm = await screen.findByRole("tooltip");
  expect(within(confirm).getByText(/旧 Token 后续调用会被拒绝/)).toBeTruthy();
  fireEvent.click(within(confirm).getByRole("button", { name: "确认撤销" }));
  await screen.findByText("张三（E001）的委托已撤销。");
  expect(
    api.mock.calls.some(
      ([p, o]) =>
        p === "/user-grants/ug1?expectedVersion=5" && o?.method === "DELETE",
    ),
  ).toBe(true);
  expect(screen.getByLabelText("委托员工号")).toHaveProperty(
    "value",
    "other-person",
  );
});

test("结果未知时锁定写入，读取失败仍锁定，成功核对后再继续", async () => {
  let unknown = false,
    recovered = false;
  const api = setup((path, options) => {
    if (path.endsWith("/users") && options?.method === "POST") {
      unknown = true;
      return Promise.reject(new Error("未收到操作结果"));
    }
    if (unknown && path.includes("/users?"))
      return recovered ? page([row]) : Promise.reject(new Error("读取失败"));
  });
  await verify();
  fireEvent.click(screen.getByRole("button", { name: "确认建立委托" }));
  fireEvent.click(await screen.findByRole("button", { name: "核对最新委托" }));
  await screen.findByText("读取失败");
  expect(screen.getByRole("button", { name: "返回租户关联" })).toHaveProperty(
    "disabled",
    true,
  );
  recovered = true;
  fireEvent.click(screen.getByRole("button", { name: "核对最新委托" }));
  await screen.findByText("已核对工号 E001：当前委托有效。");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "返回租户关联" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  expect(
    api.mock.calls.filter(
      ([p, o]) => p.endsWith("/users") && o?.method === "POST",
    ),
  ).toHaveLength(1);
});

test("停用凭据不能发起新增，但已有有效委托仍能撤销", async () => {
  setup((path) => (path.includes("/users?") ? page([row]) : undefined), false);
  await screen.findByText(
    "凭据已停用：可以查看和撤销已有委托，恢复后才能新增。",
  );
  expect(screen.queryByLabelText("委托员工号")).toBeNull();
  expect(
    await screen.findByRole("button", { name: "撤销 E001" }),
  ).toHaveProperty("disabled", false);
});

test("HTTP 5xx 即使有结构化业务错误也必须核对写入结果", async () => {
  setup((path, options) =>
    path.endsWith("/users") && options?.method === "POST"
      ? Promise.reject(
          new AdminApiError(
            "网关响应异常",
            40900001,
            "request-id",
            undefined,
            502,
          ),
        )
      : undefined,
  );
  await verify();
  fireEvent.click(screen.getByRole("button", { name: "确认建立委托" }));
  await screen.findByRole("button", { name: "核对最新委托" });
  expect(screen.getByRole("button", { name: "返回租户关联" })).toHaveProperty(
    "disabled",
    true,
  );
});
