import { StrictMode } from "react";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import GovernanceWorkspace from "./GovernanceWorkspace";
import { AdminNavigationProvider } from "../navigation/AdminNavigation";
import { createAdminApi } from "../access/api";
const config = {
  target: {
    type: "TENANT",
    tenantId: "tenant-1",
    applicationId: null,
    apiId: null,
  },
  enabled: true,
  mode: "OBSERVE",
  rate: { algorithm: "TOKEN_BUCKET", perSecond: 10, burst: 20 },
  dailyQuota: 100,
  ipMode: "UNRESTRICTED",
  ipAddresses: [],
};
const draft = {
  id: "rule-1",
  name: "租户保护",
  config,
  draftRevision: 2,
  stateVersion: 0,
  liveReleaseId: null,
  liveRule: null,
};
const preview = {
  id: "rule-1",
  name: "租户保护",
  beforeName: null,
  draftRevision: 2,
  stateVersion: 0,
  sourceReleaseId: null,
  digest: "a".repeat(64),
  before: null,
  after: { ...config, id: "rule-1", version: 1 },
  change: true,
  warnings: ["新桶拥有完整突发额度"],
};
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});
function setup(
  failFirst = false,
  response?: (url: string, options?: RequestInit) => Response | undefined,
) {
  let published = false;
  let first = failFirst;
  const calls = vi.fn(async (url: string, options?: RequestInit) => {
    const overridden = response?.(url, options);
    if (overridden) return overridden;
    let data: unknown;
    if (url.endsWith("/publish")) {
      if (first) {
        first = false;
        throw new Error("lost response");
      }
      published = true;
      data = {
        id: "release-1",
        rule: preview.after,
        previewDigest: preview.digest,
      };
    } else if (url.includes("/results?"))
      return Response.json(
        { code: 40400001, message: "暂无成功结果" },
        { status: 404 },
      );
    else if (url.endsWith("/preview")) data = preview;
    else if (url.endsWith("/rule-1"))
      data = {
        ...draft,
        stateVersion: published ? 1 : 0,
        liveReleaseId: published ? "release-1" : null,
        liveRule: published ? preview.after : null,
      };
    else data = { items: [draft], total: 1, page: 1, pageSize: 20 };
    return Response.json({ code: 200, data });
  });
  vi.stubGlobal("fetch", calls);
  render(
    <AdminNavigationProvider>
      <GovernanceWorkspace
        api={createAdminApi("proof", vi.fn())}
        permissions={["MANAGE_APPLICATIONS", "MANAGE_APIS"]}
      />
    </AdminNavigationProvider>,
  );
  return calls;
}
test("草稿与生效清晰分开，核对固定预览后才发布", async () => {
  const calls = setup();
  fireEvent.click(await screen.findByRole("button", { name: "租户保护" }));
  expect(screen.queryByRole("button", { name: "旧分钟策略" })).toBeNull();
  expect(
    await screen.findByRole("button", { name: "保存规则草稿" }),
  ).toHaveProperty("disabled", true);
  fireEvent.click(await screen.findByRole("button", { name: "核对发布差异" }));
  await screen.findByRole("region", { name: "规则发布预览" });
  expect(calls.mock.calls.some(([url]) => url.endsWith("/publish"))).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "确认发布规则" }));
  await screen.findByText("规则版本 v1 已发布。");
  const submitted = calls.mock.calls.find(([url]) => url.endsWith("/publish"))!;
  expect(JSON.parse(submitted[1]!.body as string)).toEqual({
    expectedDraftRevision: 2,
    expectedStateVersion: 0,
    sourceReleaseId: null,
    previewDigest: preview.digest,
  });
});
test("发布结果未知只能查询原摘要，404后重试原固定基线", async () => {
  const calls = setup(true);
  fireEvent.click(await screen.findByRole("button", { name: "租户保护" }));
  fireEvent.click(await screen.findByRole("button", { name: "核对发布差异" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "确认发布规则" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "查询原规则发布结果" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "使用原预览重试发布" }),
  );
  await screen.findByText("规则版本 v1 已发布。");
  const attempts = calls.mock.calls.filter(([url]) => url.endsWith("/publish"));
  expect(attempts).toHaveLength(2);
  expect(attempts[0][1]?.body).toBe(attempts[1][1]?.body);
  expect(
    calls.mock.calls.some(([url]) =>
      url.endsWith(`/results?previewDigest=${preview.digest}`),
    ),
  ).toBe(true);
});
test("六个筛选条件独立传递：名称即时防抖、目标与模式即时生效、精确编号在更多筛选中应用", async () => {
  const calls = setup();
  await screen.findByRole("button", { name: "租户保护" });
  fireEvent.change(screen.getByLabelText("搜索规则名称"), {
    target: { value: "同步" },
  });
  await waitFor(() => expect(window.location.hash).toContain("filter.governanceRules.nameContains="));
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "目标" }));
  fireEvent.click(
    screen.getByText("凭据 + API", {
      selector: ".ant-select-item-option-content",
    }),
  );
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "模式" }));
  fireEvent.click(
    screen.getByText("执行：超限会拒绝", {
      selector: ".ant-select-item-option-content",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /更多筛选/ }));
  fireEvent.change(await screen.findByLabelText("租户 ID（精确）"), {
    target: { value: "tenant-1" },
  });
  fireEvent.change(screen.getByLabelText("AK（精确）"), {
    target: { value: "a".repeat(32) },
  });
  fireEvent.change(screen.getByLabelText("API ID（精确）"), {
    target: { value: "api-1" },
  });
  // 组合条件应用前不发查询。
  expect(calls.mock.calls.some(([url]) => url.includes("tenantId=tenant-1"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: /^应\s?用$/ }));
  await waitFor(() =>
    expect(
      calls.mock.calls.some(
        ([url]) =>
          url.includes("nameContains=%E5%90%8C%E6%AD%A5") &&
          url.includes("tenantId=tenant-1") &&
          url.includes(`appKey=${"a".repeat(32)}`) &&
          url.includes("type=APPLICATION_API") &&
          url.includes("mode=ENFORCE") &&
          url.includes("apiId=api-1"),
      ),
    ).toBe(true),
  );
  expect(screen.getByRole("button", { name: "清除 模式：执行" })).toBeTruthy();
  // 地址只写设置过的条件，分享可还原。
  expect(window.location.hash).toContain("filter.governanceRules.mode=ENFORCE");
  expect(window.location.hash).not.toContain("filter.governanceRules.page");
});

test.each([401, 403])(
  "未知发布查不到后重试遇到%s，仍保留原预览并查询原结果",
  async (status) => {
    let attempts = 0;
    let queries = 0;
    const calls = setup(true, (url) => {
      if (url.endsWith("/publish") && ++attempts === 2)
        return Response.json(
          { code: status * 100000 + 1, resultMsg: "身份暂不可用" },
          { status },
        );
      if (url.includes("/results?") && ++queries === 2)
        return Response.json({
          code: 200,
          data: {
            id: "release-1",
            rule: preview.after,
            previewDigest: preview.digest,
          },
        });
      return undefined;
    });
    fireEvent.click(await screen.findByRole("button", { name: "租户保护" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "核对发布差异" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "确认发布规则" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "查询原规则发布结果" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "使用原预览重试发布" }),
    );
    await screen.findByText(
      status === 401 ? "登录已失效，请重新登录。" : "身份暂不可用",
    );
    expect(screen.getByRole("region", { name: "规则发布预览" })).toBeTruthy();
    expect(screen.getByText(/发布结果未知/)).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /^关\s?闭$/ })[0],
    ).toHaveProperty("disabled", true);
    expect(
      screen.queryByRole("button", { name: "使用原预览重试发布" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查询原规则发布结果" }));
    await screen.findByText("规则版本 v1 已发布。");
    const published = calls.mock.calls.filter(([url]) =>
      url.endsWith("/publish"),
    );
    expect(published).toHaveLength(2);
    expect(published[0][1]?.body).toBe(published[1][1]?.body);
    expect(
      calls.mock.calls
        .filter(([url]) => url.includes("/results?"))
        .map(([url]) => url),
    ).toEqual(
      Array(2).fill(
        `/admin-api/governance-rules/rule-1/results?previewDigest=${preview.digest}`,
      ),
    );
  },
);

test("原结果先404再503时撤销旧重试许可，继续查询而不发送发布", async () => {
  let queries = 0;
  const calls = setup(true, (url) =>
    url.includes("/results?") && ++queries === 2
      ? Response.json(
          { code: 50300001, resultMsg: "结果查询暂不可用" },
          { status: 503 },
        )
      : undefined,
  );
  fireEvent.click(await screen.findByRole("button", { name: "租户保护" }));
  fireEvent.click(await screen.findByRole("button", { name: "核对发布差异" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "确认发布规则" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "查询原规则发布结果" }),
  );
  await screen.findByRole("button", { name: "使用原预览重试发布" });
  fireEvent.click(screen.getByRole("button", { name: "查询原规则发布结果" }));
  await screen.findByText("结果查询暂不可用");
  expect(
    screen.queryByRole("button", { name: "使用原预览重试发布" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "查询原规则发布结果" }),
  ).toHaveProperty("disabled", false);
  expect(
    screen.getAllByRole("button", { name: /^关\s?闭$/ })[0],
  ).toHaveProperty("disabled", true);
  expect(
    calls.mock.calls.filter(([url]) => url.endsWith("/publish")),
  ).toHaveLength(1);
});

test("发布已成功但刷新草稿503时保留成功事实且允许关闭，不锁定未知结果", async () => {
  let reads = 0;
  const calls = setup(false, (url) =>
    url.endsWith("/rule-1") && ++reads > 1
      ? Response.json(
          { code: 50300001, resultMsg: "读取服务暂不可用" },
          { status: 503 },
        )
      : undefined,
  );
  fireEvent.click(await screen.findByRole("button", { name: "租户保护" }));
  fireEvent.click(await screen.findByRole("button", { name: "核对发布差异" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "确认发布规则" }),
  );
  await screen.findByText(/发布已确认成功，刷新草稿失败/);
  expect(screen.getByText("规则版本 v1 已发布。")).toBeTruthy();
  expect(screen.queryByText(/发布结果未知/)).toBeNull();
  expect(
    screen.queryByRole("button", { name: "查询原规则发布结果" }),
  ).toBeNull();
  const close = screen.getAllByRole("button", { name: /^关\s?闭$/ })[0];
  expect(close).toHaveProperty("disabled", false);
  fireEvent.click(close);
  await screen.findByRole("button", { name: "租户保护" });
  expect(screen.getByRole("button", { name: "租户保护" })).toHaveProperty(
    "disabled",
    false,
  );
  expect(
    calls.mock.calls.filter(([url]) => url.endsWith("/publish")),
  ).toHaveLength(1);
});

test("历史A预览成功后历史B预览失败，不能确认发布已过时的A预览", async () => {
  const releases = ["release-a", "release-b"].map((id, index) => ({
    id,
    ruleId: "rule-1",
    name: `历史规则${index + 1}`,
    rule: { ...preview.after, version: index + 1 },
    publishedAt: "2026-09-23T01:00:00Z",
    sourceReleaseId: null,
    previewDigest: String(index + 1).repeat(64),
  }));
  const calls = setup(false, (url, options) => {
    if (url.includes("/releases?"))
      return Response.json({
        code: 200,
        data: { items: releases, total: 2, page: 1, pageSize: 20 },
      });
    if (!url.endsWith("/preview")) return undefined;
    const sourceReleaseId = JSON.parse(options!.body as string).sourceReleaseId;
    return sourceReleaseId === "release-b"
      ? Response.json(
          { code: 50300001, resultMsg: "历史B预览失败" },
          { status: 503 },
        )
      : Response.json({
          code: 200,
          data: { ...preview, sourceReleaseId, name: "历史A候选" },
        });
  });
  fireEvent.click(await screen.findByRole("button", { name: "租户保护" }));
  fireEvent.click(
    await screen.findByRole("tab", { name: "版本记录 / 回滚" }),
  );
  fireEvent.click(
    (await screen.findAllByRole("button", { name: "核对回滚到此内容" }))[0],
  );
  await screen.findByRole("region", { name: "规则发布预览" });
  expect(screen.getByRole("button", { name: "确认发布规则" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "取消发布" }));
  fireEvent.click(
    screen.getAllByRole("button", { name: "核对回滚到此内容" })[1],
  );
  await screen.findByText(/历史B预览失败/);
  expect(screen.queryByRole("region", { name: "规则发布预览" })).toBeNull();
  expect(screen.queryByRole("button", { name: "确认发布规则" })).toBeNull();
  expect(
    calls.mock.calls
      .filter(([url]) => url.endsWith("/preview"))
      .map(
        ([, options]) => JSON.parse(options!.body as string).sourceReleaseId,
      ),
  ).toEqual(["release-a", "release-b"]);
  expect(calls.mock.calls.some(([url]) => url.endsWith("/publish"))).toBe(
    false,
  );
});

test("保存并核对绑定刚保存修订，历史查看不丢未保存输入", async () => {
  let current = structuredClone(draft);
  const calls = setup(false, (url, options) => {
    if (url.endsWith("/rule-1")) {
      if (options?.method === "PUT")
        current = {
          ...current,
          ...JSON.parse(options.body as string),
          draftRevision: 3,
        };
      return Response.json({ code: 200, data: current });
    }
    if (url.endsWith("/preview"))
      return Response.json({
        code: 200,
        data: {
          ...preview,
          name: current.name,
          draftRevision: current.draftRevision,
          after: { ...current.config, id: "rule-1", version: 1 },
        },
      });
    if (url.includes("/releases?"))
      return Response.json({
        code: 200,
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      });
  });
  fireEvent.click(await screen.findByRole("button", { name: "租户保护" }));
  fireEvent.change(await screen.findByLabelText("规则名称"), {
    target: { value: "本次编辑" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "版本记录 / 回滚" }));
  await screen.findByRole("region", { name: "规则版本记录" });
  await waitFor(() =>
    expect(
      screen.getByRole("tab", { name: "规则配置" }).getAttribute("aria-disabled"),
    ).not.toBe("true"),
  );
  fireEvent.click(screen.getByRole("tab", { name: "规则配置" }));
  expect(screen.getByLabelText("规则名称")).toHaveProperty("value", "本次编辑");
  fireEvent.click(screen.getByRole("button", { name: "保存并核对发布" }));
  await screen.findByRole("region", { name: "规则发布预览" });
  fireEvent.click(screen.getByRole("button", { name: "确认发布规则" }));
  await screen.findByText("规则版本 v1 已发布。");
  const call = calls.mock.calls.find(([url]) => url.endsWith("/publish"))!;
  expect(JSON.parse(call[1]!.body as string).expectedDraftRevision).toBe(3);
});

test("冲突保留输入，明确核对最新草稿后才使用新修订保存", async () => {
  let current = structuredClone(draft),
    writes = 0;
  const calls = setup(false, (url, options) => {
    if (!url.endsWith("/rule-1")) return;
    if (options?.method === "PUT") {
      writes++;
      if (writes === 1) {
        current = { ...current, name: "他人修改", draftRevision: 3 };
        return Response.json(
          { code: 40900001, resultMsg: "草稿修订已变化" },
          { status: 409 },
        );
      }
      current = {
        ...current,
        ...JSON.parse(options.body as string),
        draftRevision: 4,
      };
    }
    return Response.json({ code: 200, data: current });
  });
  fireEvent.click(await screen.findByRole("button", { name: "租户保护" }));
  fireEvent.change(await screen.findByLabelText("规则名称"), {
    target: { value: "我的输入" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存规则草稿" }));
  await screen.findByRole("region", { name: "草稿冲突核对" });
  expect(screen.getByLabelText("规则名称")).toHaveProperty("value", "我的输入");
  expect(screen.getByRole("button", { name: "保存规则草稿" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "关闭错误提示" }));
  expect(screen.getByRole("region", { name: "草稿冲突核对" })).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "保留输入，以最新修订继续编辑" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "保存规则草稿" }));
  await screen.findByText("草稿已保存，核对发布后才生效。");
  const puts = calls.mock.calls.filter(
    ([, options]) => options?.method === "PUT",
  );
  expect(
    puts.map(
      ([, options]) =>
        JSON.parse(options!.body as string).expectedDraftRevision,
    ),
  ).toEqual([2, 3]);
});

test("StrictMode直达已有规则时取消旧读取后能重新加载", async () => {
  window.history.replaceState({}, "", "/#/governance?rule=rule-1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ code: 200, data: draft })),
  );
  render(
    <StrictMode>
      <AdminNavigationProvider>
        <GovernanceWorkspace
          api={createAdminApi("proof", vi.fn())}
          permissions={["MANAGE_APPLICATIONS", "MANAGE_APIS"]}
        />
      </AdminNavigationProvider>
    </StrictMode>,
  );
  expect(await screen.findByLabelText("规则名称")).toHaveProperty(
    "value",
    "租户保护",
  );
  expect(screen.queryByText("正在读取规则…")).toBeNull();
});

test("读取重试晚到不能覆盖已切换的规则", async () => {
  window.history.replaceState({}, "", "/#/governance?rule=rule-1");
  let resolveOld!: (response: Response) => void,
    reads = 0;
  const second = { ...draft, id: "rule-2", name: "另一条规则" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/rule-1")) {
        if (++reads === 1)
          return Response.json(
            { code: 50300001, resultMsg: "读取失败" },
            { status: 503 },
          );
        return new Promise<Response>((resolve) => {
          resolveOld = resolve;
        });
      }
      return Response.json({
        code: 200,
        data: url.endsWith("/rule-2")
          ? second
          : { items: [second], total: 1, page: 1, pageSize: 20 },
      });
    }),
  );
  render(
    <AdminNavigationProvider>
      <GovernanceWorkspace
        api={createAdminApi("proof", vi.fn())}
        permissions={["MANAGE_APPLICATIONS", "MANAGE_APIS"]}
      />
    </AdminNavigationProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "重新读取规则" }));
  await waitFor(() => expect(reads).toBe(2));
  fireEvent.click(screen.getByRole("button", { name: /^关\s?闭$/ }));
  fireEvent.click(await screen.findByRole("button", { name: "另一条规则" }));
  expect(await screen.findByLabelText("规则名称")).toHaveProperty(
    "value",
    "另一条规则",
  );
  await act(async () => resolveOld(Response.json({ code: 200, data: draft })));
  expect(screen.getByLabelText("规则名称")).toHaveProperty(
    "value",
    "另一条规则",
  );
});

test("保存回包丢失先核对已保存内容，不自动重复写入", async () => {
  let current = structuredClone(draft);
  const calls = setup(false, (url, options) => {
    if (!url.endsWith("/rule-1")) return;
    if (options?.method === "PUT") {
      current = {
        ...current,
        ...JSON.parse(options.body as string),
        draftRevision: 3,
      };
      return Response.json(
        { code: 50300001, resultMsg: "回包丢失" },
        { status: 503 },
      );
    }
    return Response.json({ code: 200, data: current });
  });
  fireEvent.click(await screen.findByRole("button", { name: "租户保护" }));
  fireEvent.change(await screen.findByLabelText("规则名称"), {
    target: { value: "保存已提交" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存规则草稿" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "核对草稿保存结果" }),
  );
  await screen.findByText("已核对：草稿保存成功，尚未发布。");
  expect(calls.mock.calls.filter(([, o]) => o?.method === "PUT")).toHaveLength(
    1,
  );
  expect(screen.getByLabelText("规则名称")).toHaveProperty(
    "value",
    "保存已提交",
  );
});

test("重复目标加载已有草稿时同步详情路由", async () => {
  window.history.replaceState({}, "", "/#/governance?rule=new");
  const existing = {
    ...draft,
    id: "APPLICATION:app-1",
    config: {
      ...config,
      target: {
        type: "APPLICATION",
        applicationId: "app-1",
        tenantId: null,
        apiId: null,
      },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith("/governance-rules") && options?.method === "POST")
        return Response.json(
          { code: 40900001, resultMsg: "目标已存在" },
          { status: 409 },
        );
      return Response.json({
        code: 200,
        data: url.includes("/applications?")
          ? {
              items: [
                { id: "app-1", name: "已存在的凭据", appKey: "a".repeat(32) },
              ],
              total: 1,
              page: 1,
              pageSize: 20,
            }
          : existing,
      });
    }),
  );
  render(
    <AdminNavigationProvider>
      <GovernanceWorkspace
        api={createAdminApi("proof", vi.fn())}
        permissions={["MANAGE_APPLICATIONS"]}
      />
    </AdminNavigationProvider>,
  );
  fireEvent.change(await screen.findByLabelText("规则名称"), {
    target: { value: "误新建" },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: /^选择$/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "下一步：配置策略" }));
  fireEvent.click(screen.getByRole("button", { name: "保存规则草稿" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "放弃输入，加载最新草稿" }),
  );
  await waitFor(() =>
    expect(window.location.hash).toContain("rule=APPLICATION%3Aapp-1"),
  );
  expect(screen.getByLabelText("规则名称")).toHaveProperty("value", "租户保护");
});

test('批量规则概况刷新更新最近小时窗口，不改治理配置', async () => {
  let now = Date.parse('2026-09-30T10:00:00Z');
  vi.spyOn(Date,'now').mockImplementation(()=>now);
  const calls=vi.fn(async(url:string)=>Response.json({code:200,data:url.includes('/rule-overview?') ? [] : {items:[{...draft,liveRule:preview.after}],total:1,page:1,pageSize:20}}));
  vi.stubGlobal('fetch',calls);
  render(<AdminNavigationProvider><GovernanceWorkspace api={createAdminApi('proof',vi.fn())} permissions={['VIEW_AUDIT','MANAGE_APPLICATIONS']}/></AdminNavigationProvider>);
  await screen.findByText('此版本暂无评估记录');
  const first=new URL(calls.mock.calls.find(([url])=>url.includes('/rule-overview?'))![0],'http://test');
  expect(first.searchParams.getAll('ruleId')).toEqual(['rule-1']);
  now += 5 * 60000;
  fireEvent.click(screen.getByRole('button',{name:'刷新命中'}));
  await waitFor(()=>expect(calls.mock.calls.some(([url])=>url.includes('to=2026-09-30T10%3A05%3A00.000Z'))).toBe(true));
  expect(calls.mock.calls.every(([url])=>!url.includes('/publish'))).toBe(true);
  vi.restoreAllMocks();
});

test("抽屉内用分段选择切换执行，保存后发布前看到差异", async () => {
  let current = structuredClone(draft);
  const calls = setup(false, (url, options) => {
    if (url.endsWith("/rule-1")) {
      if (options?.method === "PUT")
        current = { ...current, ...JSON.parse(options.body as string), draftRevision: 3 };
      return Response.json({ code: 200, data: current });
    }
    if (url.endsWith("/preview"))
      return Response.json({
        code: 200,
        data: { ...preview, draftRevision: current.draftRevision, after: { ...current.config, id: "rule-1", version: 1 } },
      });
  });
  expect(await screen.findByRole("heading", { name: /限流与访问控制/ })).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "租户保护" }));
  const drawer = await screen.findByRole("dialog");
  await within(drawer).findByLabelText("规则名称");
  fireEvent.click(within(drawer).getByText("执行"));
  expect(within(drawer).getByText("超限或 IP 不匹配会拒绝调用")).toBeTruthy();
  fireEvent.click(within(drawer).getByRole("button", { name: "保存并核对发布" }));
  const diff = await screen.findByRole("region", { name: "规则发布预览" });
  const modeRow = within(diff).getByText("运行模式").closest("tr")!;
  expect(modeRow.textContent).toContain("执行：超限会拒绝");
  expect(within(modeRow).getByText("变更")).toBeTruthy();
  expect(calls.mock.calls.some(([url]) => url.endsWith("/publish"))).toBe(false);
  const put = calls.mock.calls.find(([, options]) => options?.method === "PUT")!;
  expect(JSON.parse(put[1]!.body as string).config.mode).toBe("ENFORCE");
});

test("未发布规则的“查看调用分析”禁用并说明原因；已生效规则跳到调用分析并带规则条件", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json({
        code: 200,
        data: url.includes("/rule-overview?")
          ? [{ ruleId: "rule-1", ruleVersion: 1, totals: { requests: 9, governanceRejected: 2, observedRequests: 3 } }]
          : { items: [draft, { ...draft, id: "rule-2", name: "已生效规则", liveRule: preview.after, liveName: "已生效规则" }], total: 2, page: 1, pageSize: 20 },
      }),
    ),
  );
  render(
    <AdminNavigationProvider>
      <GovernanceWorkspace api={createAdminApi("proof", vi.fn())} permissions={["VIEW_AUDIT", "MANAGE_APPLICATIONS"]} />
    </AdminNavigationProvider>,
  );
  const [disabled, enabled] = await screen.findAllByRole("button", { name: "查看调用分析" });
  expect(disabled).toHaveProperty("disabled", true);
  fireEvent.mouseEnter(disabled.parentElement!);
  expect(await screen.findByText("规则尚未发布，没有调用数据")).toBeTruthy();
  expect(await screen.findByText("拒绝 2")).toBeTruthy();
  fireEvent.click(enabled);
  await waitFor(() => expect(window.location.hash).toMatch(/^#\/analytics\?/));
  const params = new URLSearchParams(window.location.hash.split("?")[1]);
  expect(params.get("filter.analytics.ruleId")).toBe("rule-1");
  expect(params.get("filter.analytics.ruleVersion")).toBe("1");
  expect(params.get("filter.analytics.ruleName")).toBeTruthy();
});

test("旧治理页地址重定向到 /traffic-rules 并打开对应规则抽屉", async () => {
  window.history.replaceState({}, "", "/#/governance?rule=rule-1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => Response.json({ code: 200, data: url.endsWith("/rule-1") ? draft : { items: [draft], total: 1, page: 1, pageSize: 20 } })),
  );
  render(
    <AdminNavigationProvider>
      <GovernanceWorkspace api={createAdminApi("proof", vi.fn())} permissions={["MANAGE_APPLICATIONS", "MANAGE_APIS"]} />
    </AdminNavigationProvider>,
  );
  expect(await screen.findByLabelText("规则名称")).toHaveProperty("value", "租户保护");
  await waitFor(() => expect(window.location.hash).toBe("#/traffic-rules?rule=rule-1"));
  fireEvent.click(screen.getByRole("button", { name: /^关\s?闭$/ }));
  await waitFor(() => expect(window.location.hash).toBe("#/traffic-rules"));
});
