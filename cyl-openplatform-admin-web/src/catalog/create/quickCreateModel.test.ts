import { expect, test } from "vitest";
import {
  buildDefinition,
  deriveDubboIdentity,
  deriveHttpIdentity,
  emptyForm,
  exampleForm,
  fieldForPath,
  httpPathVariables,
  QuickFieldError,
  toIdentifier,
  type QuickForm,
} from "./quickCreateModel";

const http = (patch: Partial<QuickForm>): QuickForm => ({
  ...emptyForm("HTTP"),
  name: "订单详情",
  category: "订单",
  owner: "EMP_00000000000000000000000000000001",
  service: "order",
  method: "detail",
  ...patch,
});
const dubbo = (patch: Partial<QuickForm>): QuickForm => ({
  ...http({}),
  protocol: "DUBBO",
  connectionId: "conn1",
  connectionRevision: 3,
  ...patch,
});

test("对外标识统一转为蛇形小写标识", () => {
  expect(toIdentifier("queryOrder")).toBe("query_order");
  expect(toIdentifier("getOrderByNo")).toBe("get_order_by_no");
  expect(toIdentifier("HTTPServer")).toBe("http_server");
  expect(toIdentifier("order-items")).toBe("order_items");
  expect(toIdentifier("123abc")).toBe("abc");
  expect(toIdentifier("___")).toBe("");
  expect(toIdentifier("a".repeat(80))).toHaveLength(64);
});

test("HTTP 由主机业务段与路径末段推导 service/method", () => {
  expect(deriveHttpIdentity({ httpTargetMode: "URL", url: "http://order-svc/internal/orders/{orderNo}", serviceName: "", path: "" })).toEqual({ service: "order", method: "orders" });
  expect(deriveHttpIdentity({ httpTargetMode: "URL", url: "https://order-center-service.prod.example.com/api/v1/orders/queryDetail", serviceName: "", path: "" })).toEqual({ service: "order", method: "query_detail" });
  expect(deriveHttpIdentity({ httpTargetMode: "URL", url: "http://10.1.2.3:8080/inventory/stock/lookup", serviceName: "", path: "" })).toEqual({ service: "inventory", method: "lookup" });
  expect(deriveHttpIdentity({ httpTargetMode: "SERVICE_NAME", url: "", serviceName: "member-service", path: "/members/{id}/points" })).toEqual({ service: "member", method: "points" });
  expect(deriveHttpIdentity({ httpTargetMode: "URL", url: "", serviceName: "", path: "" })).toEqual({ service: "", method: "" });
});

test("Dubbo 由接口简名去后缀与方法名推导", () => {
  expect(deriveDubboIdentity("com.example.order.OrderQueryFacade", "queryOrder")).toEqual({ service: "order_query", method: "query_order" });
  expect(deriveDubboIdentity("com.example.IUserService", "getById")).toEqual({ service: "user", method: "get_by_id" });
  expect(deriveDubboIdentity("com.example.Service", "ping")).toEqual({ service: "service", method: "ping" });
});

test("识别路径参数；地址不完整时为空", () => {
  expect(httpPathVariables({ httpTargetMode: "URL", url: "http://a.b/orders/{orderNo}/items/{itemId}", path: "" })).toEqual(["orderNo", "itemId"]);
  expect(httpPathVariables({ httpTargetMode: "SERVICE_NAME", url: "", path: "/x/{id}" })).toEqual(["id"]);
  expect(httpPathVariables({ httpTargetMode: "URL", url: "order", path: "" })).toEqual([]);
});

test("HTTP 无样例：路径变量生成必填请求字段与 PATH 映射，响应为空对象，直接返回", () => {
  const { definition, notes } = buildDefinition(http({ url: "http://order-svc/orders/{orderNo}", httpMethod: "GET" }));
  expect(definition.binding).toEqual({ protocol: "HTTP", timeoutMillis: 3000, http: { targetMode: "URL", url: "http://order-svc/orders/{orderNo}", method: "GET" } });
  expect(definition.requestSchema).toEqual({ type: "OBJECT", properties: { orderNo: { type: "STRING", required: true } } });
  expect(definition.mappings).toEqual([{ target: "orderNo", source: "REQUEST", path: "orderNo", location: "PATH" }]);
  expect(definition.responseSchema).toEqual({ type: "OBJECT", properties: {} });
  expect(definition.responseAdapter).toEqual({ mode: "DIRECT" });
  expect(definition.version).toBe("v1");
  expect(notes.join()).toContain("响应样例");
});

test("HTTP 请求样例字段按方法映射到 BODY 或 QUERY，身份字段被移除，固定查询参数同名不映射", () => {
  const post = buildDefinition(http({ url: "http://a.example/orders/{orderNo}", requestSample: '{"orderNo":"A1","includeItems":true,"tenantId":"t"}', responseSample: '{"ok":true}' }));
  expect(post.definition.mappings).toEqual([
    { target: "orderNo", source: "REQUEST", path: "orderNo", location: "PATH" },
    { target: "includeItems", source: "REQUEST", path: "includeItems", location: "BODY" },
  ]);
  expect(Object.keys(post.definition.requestSchema.properties!)).toEqual(["orderNo", "includeItems"]);
  expect(post.notes.join()).toContain("tenantId");
  expect(post.definition.responseSchema.properties?.ok?.type).toBe("BOOLEAN");
  const get = buildDefinition(http({ httpMethod: "GET", url: "http://a.example/search?type=1", requestSample: '{"type":1,"keyword":"x"}' }));
  expect(get.definition.mappings).toEqual([{ target: "keyword", source: "REQUEST", path: "keyword", location: "QUERY" }]);
  expect(get.notes.join()).toContain("固定查询参数");
});

test("服务名发现模式写入服务名与路径", () => {
  const { definition } = buildDefinition(http({ httpTargetMode: "SERVICE_NAME", serviceName: "order-service", path: "/orders/{id}" }));
  expect(definition.binding.http).toEqual({ targetMode: "SERVICE_NAME", serviceName: "order-service", path: "/orders/{id}", url: null, method: "POST" });
  expect(definition.mappings[0]).toMatchObject({ target: "id", location: "PATH" });
});

test("错误定位到具体字段", () => {
  const field = (form: QuickForm) => {
    try {
      buildDefinition(form);
    } catch (failure) {
      return failure instanceof QuickFieldError ? [failure.field, failure.message] : ["?", String(failure)];
    }
    return null;
  };
  expect(field(http({ url: "order" }))?.[0]).toBe("url");
  expect(field(http({ httpTargetMode: "SERVICE_NAME", serviceName: "x", path: "/a/{b c}" }))?.[0]).toBe("path");
  expect(field(http({ url: "http://a.b/x", requestSample: "{bad" }))).toEqual(["requestSample", expect.stringContaining("JSON")]);
  expect(field(http({ url: "http://a.b/x", responseSample: '{"a":null}' }))).toEqual(["responseSample", expect.stringContaining("a")]);
  expect(field(http({ url: "http://a.b/{id}", requestSample: '{"id":{"x":1}}' }))?.[0]).toBe("requestSample");
  expect(field(dubbo({ signature: "OrderService.query()" }))?.[0]).toBe("signature");
  expect(field(dubbo({ signature: "com.a.OrderService#query()", connectionId: null, connectionRevision: null }))?.[0]).toBe("connection");
});

test("Dubbo 无样例：标量参数按顺序生成 argN 字段与映射，对象参数提示待完善", () => {
  const { definition, notes } = buildDefinition(dubbo({ signature: "com.a.OrderFacade#query(java.lang.String, int, com.a.Query)", dubboVersion: " 1.0.0 " }));
  expect(definition.binding).toEqual({
    protocol: "DUBBO",
    timeoutMillis: 3000,
    dubbo: {
      interfaceName: "com.a.OrderFacade",
      method: "query",
      parameterTypes: ["java.lang.String", "int", "com.a.Query"],
      version: "1.0.0",
      group: "",
      connectionId: "conn1",
      connectionRevision: 3,
      providerApplication: null,
    },
  });
  expect(definition.requestSchema.properties).toEqual({ arg0: { type: "STRING", required: true }, arg1: { type: "INTEGER", required: true } });
  expect(definition.mappings).toEqual([
    { target: "arg0", source: "REQUEST", path: "arg0" },
    { target: "arg1", source: "REQUEST", path: "arg1" },
  ]);
  expect(notes.join()).toContain("arg2（Query）是对象参数");
});

test("Dubbo 单个对象参数 + 请求样例：顶层字段映射到 arg0.字段", () => {
  const { definition } = buildDefinition(dubbo({ signature: "com.a.OrderFacade#query(com.a.Query)", requestSample: '{"orderNo":"A1","page":1}' }));
  expect(definition.mappings).toEqual([
    { target: "arg0.orderNo", source: "REQUEST", path: "orderNo" },
    { target: "arg0.page", source: "REQUEST", path: "page" },
  ]);
});

test("示例表单可直接生成合法定义（HTTP），Dubbo 示例只缺连接", () => {
  expect(() => buildDefinition({ ...exampleForm("HTTP"), category: "订单", owner: "o" })).not.toThrow();
  expect(() => buildDefinition({ ...exampleForm("DUBBO"), category: "订单", owner: "o" })).toThrow(/注册中心连接/);
});

test("服务端字段路径映射到表单字段", () => {
  expect(fieldForPath("/service")).toBe("service");
  expect(fieldForPath("/binding/http/url")).toBe("url");
  expect(fieldForPath("/binding/dubbo/connectionRevision")).toBe("connection");
  expect(fieldForPath("/binding/dubbo")).toBe("signature");
  expect(fieldForPath("/requestSchema/properties/a")).toBe("requestSample");
  expect(fieldForPath("/mappings/0/target")).toBeNull();
});
