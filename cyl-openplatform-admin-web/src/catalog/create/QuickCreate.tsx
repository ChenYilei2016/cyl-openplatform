import { CheckCircleFilled, InfoCircleOutlined, SwapOutlined } from "@ant-design/icons";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { CopyButton, FormSection, PageHeader, StickyActionBar } from "@cyl/open-platform-web-shared/ui/components";
import { Alert, App, Button, Form, Input, Radio, Segmented, Select, Space, Tag } from "antd";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AdminApiError, type AdminApi } from "../../access/api";
import ConnectionPicker from "../../connections/ConnectionPicker";
import { parseHttpRequestSource } from "../../importing/httpRequestSource";
import type { Binding } from "../BindingEditor";
import type { ApiDefinition } from "../CatalogPanel";
import { CategoryPicker, OwnerPicker } from "../CatalogReferenceFields";
import { parseDubboSignature } from "../dubboSignature";
import { failureIssues, type CandidateValidation, type FieldIssue } from "../WorkspaceValidation";
import {
  buildDefinition,
  clearQuickDraft,
  deriveIdentity,
  emptyForm,
  exampleForm,
  fieldForPath,
  httpMethods,
  httpPathVariables,
  isBlankForm,
  QuickFieldError,
  readQuickDraft,
  writeQuickDraft,
  type QuickField,
  type QuickForm,
  type QuickSource,
} from "./quickCreateModel";
import "./quick-create.css";

const sourceLabels: Record<QuickSource, string> = {
  curl: "cURL / HTTP 请求",
  http: "从零新建",
  dubbo: "Dubbo 方法签名",
  "dubbo-blank": "从零新建",
  "example-http": "HTTP 示例",
  "example-dubbo": "Dubbo 示例",
};
const identifierRule = /^[a-z][a-z0-9_]{0,63}$/;
const versionRule = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/;

const initialForm = (source: QuickSource): QuickForm =>
  source === "example-http"
    ? exampleForm("HTTP")
    : source === "example-dubbo"
      ? exampleForm("DUBBO")
      : emptyForm(source === "dubbo" || source === "dubbo-blank" ? "DUBBO" : "HTTP");

/** 只在离开字段或点击创建后显示的客户端必填与格式检查。 */
function clientError(field: QuickField, form: QuickForm): string | null {
  switch (field) {
    case "name":
      return !form.name.trim() ? "请填写名称" : form.name.trim().length > 100 ? "名称不超过 100 个字符" : null;
    case "category":
      return form.category.trim() ? null : "请选择分类";
    case "owner":
      return form.owner.trim() ? null : "请选择负责人";
    case "service":
    case "method":
      return !form[field].trim()
        ? `请填写 ${field}`
        : identifierRule.test(form[field].trim())
          ? null
          : "以小写字母开头，只用小写字母、数字和下划线，最多 64 位";
    case "version":
      return versionRule.test(form.version.trim()) ? null : "以字母或数字开头，最多 32 位，可含 . _ -";
    case "url":
      return form.protocol === "HTTP" && form.httpTargetMode === "URL" && !form.url.trim() ? "请填写目标地址" : null;
    case "serviceName":
      return form.protocol === "HTTP" && form.httpTargetMode === "SERVICE_NAME" && !form.serviceName.trim() ? "请填写服务名" : null;
    case "path":
      return form.protocol === "HTTP" && form.httpTargetMode === "SERVICE_NAME" && !form.path.trim().startsWith("/") ? "路径以 / 开头" : null;
    case "signature":
      return form.protocol === "DUBBO" && !form.signature.trim() ? "请粘贴或填写方法签名" : null;
    case "connection":
      return form.protocol === "DUBBO" && !form.connectionId ? "请选择注册中心连接" : null;
    default:
      return null;
  }
}
const checkedFields: QuickField[] = ["url", "serviceName", "path", "signature", "connection", "name", "category", "owner", "service", "method", "version"];

export default function QuickCreate({
  api,
  source,
  canManageConnections = false,
  onCancel,
  onChangeSource,
  onCreated,
}: {
  api: AdminApi;
  source: QuickSource;
  canManageConnections?: boolean;
  onCancel: () => void;
  onChangeSource: () => void;
  onCreated: (definition: ApiDefinition, notes: string[]) => void;
}) {
  const { message } = App.useApp();
  const stored = useMemo(() => readQuickDraft(source), [source]);
  const [form, setForm] = useState<QuickForm>(() => stored?.form ?? initialForm(source));
  const [restoredAt, setRestoredAt] = useState<number | null>(stored ? stored.savedAt : null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [touched, setTouched] = useState<Set<QuickField>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<QuickField, string>>>({});
  const [generalIssues, setGeneralIssues] = useState<FieldIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [curlText, setCurlText] = useState("");
  const [curlOpen, setCurlOpen] = useState(source === "curl");
  const [curlResult, setCurlResult] = useState<{ error?: string; warnings?: string[] } | null>(null);
  const [advancedDubbo, setAdvancedDubbo] = useState(Boolean(stored?.form.providerApplication || stored?.form.dubboVersion || stored?.form.dubboGroup));
  const formRef = useRef<HTMLDivElement>(null);
  const latest = useRef(form);
  latest.current = form;

  // 每 3 秒把输入暂存到本标签页；创建成功或主动取消时清除。不暂存原始 cURL 文本。
  useEffect(() => {
    if (isBlankForm(form) && !restoredAt) return;
    const timer = window.setTimeout(() => {
      writeQuickDraft(source, latest.current);
      setSavedAt(Date.now());
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [form, source, restoredAt]);

  const update = (patch: Partial<QuickForm>, edited?: QuickField[]) => {
    setForm((current) => {
      const next = { ...current, ...patch };
      if (!next.identityEdited) {
        const derived = deriveIdentity(next);
        if (derived.service || !current.service) next.service = derived.service;
        if (derived.method || !current.method) next.method = derived.method;
      }
      return next;
    });
    if (edited?.length)
      setServerErrors((current) => {
        const next = { ...current };
        for (const field of edited) delete next[field];
        return next;
      });
  };
  const touch = (field: QuickField) => setTouched((current) => (current.has(field) ? current : new Set(current).add(field)));
  const errorOf = (field: QuickField) => serverErrors[field] ?? (submitted || touched.has(field) ? clientError(field, form) : null);
  const item = (field: QuickField, label: ReactNode, children: ReactNode, options: { required?: boolean; extra?: ReactNode; span?: boolean; help?: ReactNode } = {}) => {
    const error = errorOf(field);
    return (
      <Form.Item
        className={options.span ? "op-span-all" : undefined}
        label={label}
        tooltip={options.help ? { title: options.help, trigger: ["hover", "focus"] } : undefined}
        htmlFor={`quick-${field}`}
        required={options.required}
        validateStatus={error ? "error" : undefined}
        help={error ?? undefined}
        extra={options.extra}
        data-field={field}
      >
        {children}
      </Form.Item>
    );
  };

  /* ------------------------------- 实时预览 ------------------------------- */
  const pathVariables = form.protocol === "HTTP" ? httpPathVariables(form) : [];
  const signature = useMemo(() => {
    if (form.protocol !== "DUBBO" || !form.signature.trim()) return null;
    try {
      return { value: parseDubboSignature(form.signature) };
    } catch (failure) {
      return { error: (failure as Error).message };
    }
  }, [form.protocol, form.signature]);
  const preview = useMemo(() => {
    try {
      return { result: buildDefinition(form) };
    } catch (failure) {
      return { error: failure instanceof QuickFieldError ? failure : null };
    }
  }, [form]);
  const fieldCount = (schema?: { properties?: Record<string, unknown> }) => Object.keys(schema?.properties ?? {}).length;
  const callAddress = `POST /api/oauth/${form.service.trim() || "{service}"}/${form.version.trim() || "{version}"}/${form.method.trim() || "{method}"}`;

  /* --------------------------------- 动作 --------------------------------- */
  const parseCurl = () => {
    try {
      const parsed = parseHttpRequestSource(curlText);
      const http = (parsed.definition.binding as Binding).http!;
      const example = (parsed.definition.requestSchema as { example?: unknown } | undefined)?.example;
      const body = example && typeof example === "object" && Object.keys(example as object).length ? stringifyJson(example, 2) : "";
      update({ protocol: "HTTP", httpTargetMode: "URL", url: http.url ?? "", httpMethod: http.method as QuickForm["httpMethod"], requestSample: body }, ["url", "httpMethod", "requestSample"]);
      setCurlResult({ warnings: parsed.warnings });
      setCurlText("");
      setCurlOpen(false);
    } catch (failure) {
      setCurlResult({ error: (failure as Error).message });
    }
  };
  const locate = (field: QuickField) => {
    if (["providerApplication", "dubboVersion", "dubboGroup"].includes(field)) setAdvancedDubbo(true);
    window.requestAnimationFrame(() => {
      const element = formRef.current?.querySelector<HTMLElement>(`#quick-${field}`) ?? formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"] input, [data-field="${field}"] textarea`);
      element?.focus?.();
      element?.scrollIntoView?.({ block: "center" });
    });
  };
  const applyIssues = (issues: FieldIssue[]) => {
    const mapped: Partial<Record<QuickField, string>> = {};
    const general: FieldIssue[] = [];
    for (const issue of issues) {
      const field = fieldForPath(issue.path);
      if (field && !mapped[field]) mapped[field] = issue.message;
      else if (!field) general.push(issue);
    }
    setServerErrors(mapped);
    setGeneralIssues(general);
    const first = checkedFields.find((field) => mapped[field]) ?? (Object.keys(mapped)[0] as QuickField | undefined);
    if (first) locate(first);
  };
  const identityCheck = useRef<AbortController | null>(null);
  /** 创建前预检对外标识冲突：只用候选定义做只读校验，只采纳标识相关的问题。 */
  const checkIdentity = async () => {
    const current = latest.current;
    if (!(["service", "method", "version"] as const).every((field) => !clientError(field, current)) || !preview.result) return;
    identityCheck.current?.abort();
    const controller = new AbortController();
    identityCheck.current = controller;
    try {
      const result = await api<CandidateValidation>("/apis/validate?newOperation=true", { method: "POST", body: buildDefinition(current).definition, signal: controller.signal });
      if (controller.signal.aborted || latest.current !== current) return;
      const issue = result.fieldIssues.find((item) => ["/service", "/method", "/version"].includes(item.path));
      setServerErrors((errors) => {
        const next = { ...errors };
        delete next.service;
        delete next.method;
        delete next.version;
        if (issue) next[fieldForPath(issue.path)!] = issue.message;
        return next;
      });
    } catch {
      /* 预检失败不阻断输入；创建时会再次校验。 */
    }
  };
  const submit = async () => {
    setSubmitted(true);
    setGeneralIssues([]);
    const firstClient = checkedFields.find((field) => clientError(field, form));
    if (firstClient) {
      locate(firstClient);
      return;
    }
    let built: ReturnType<typeof buildDefinition>;
    try {
      built = buildDefinition(form);
    } catch (failure) {
      if (failure instanceof QuickFieldError) {
        setServerErrors((current) => ({ ...current, [failure.field]: failure.message }));
        locate(failure.field);
      } else setGeneralIssues([{ path: "", reason: "INVALID_VALUE", message: (failure as Error).message }]);
      return;
    }
    setBusy(true);
    try {
      const check = await api<CandidateValidation>("/apis/validate?newOperation=true", { method: "POST", body: built.definition });
      if (!check.valid) {
        applyIssues(check.fieldIssues);
        return;
      }
      const saved = await api<ApiDefinition>("/apis", { method: "POST", body: built.definition });
      clearQuickDraft(source);
      message.success(`已创建草稿 r${stringifyJson(saved.draftRevision)}，继续完善配置`);
      onCreated(saved, built.notes);
    } catch (failure) {
      const issues = failureIssues(failure);
      if (issues.length) applyIssues(issues);
      else if (failure instanceof AdminApiError && (failure.httpStatus === 409 || Math.floor(failure.code / 100000) === 409)) {
        setServerErrors((current) => ({ ...current, method: "该服务标识、外部版本与操作标识已被其他 API 使用，请更换。" }));
        locate("method");
      } else setGeneralIssues([{ path: "", reason: "INVALID_VALUE", message: (failure as Error).message }]);
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    clearQuickDraft(source);
    onCancel();
  };

  /* --------------------------------- 渲染 --------------------------------- */
  const httpTarget = (
    <>
      {item(
        "url",
        "调用目标",
        form.httpTargetMode === "URL" ? (
          <Space.Compact block>
            <Select
              aria-label="HTTP 方法"
              style={{ width: 112, flex: "none" }}
              value={form.httpMethod}
              options={httpMethods.map((value) => ({ value, label: value }))}
              onChange={(value) => update({ httpMethod: value }, ["httpMethod"])}
            />
            <Input
              id="quick-url"
              aria-label="目标地址"
              placeholder="http://order-service/internal/orders/{orderNo}"
              value={form.url}
              status={errorOf("url") ? "error" : undefined}
              onChange={(event) => update({ url: event.target.value }, ["url"])}
              onBlur={() => touch("url")}
            />
          </Space.Compact>
        ) : (
          <Space.Compact block>
            <Select
              aria-label="HTTP 方法"
              style={{ width: 112, flex: "none" }}
              value={form.httpMethod}
              options={httpMethods.map((value) => ({ value, label: value }))}
              onChange={(value) => update({ httpMethod: value }, ["httpMethod"])}
            />
            <Input
              id="quick-serviceName"
              aria-label="服务名"
              style={{ width: "34%", flex: "none" }}
              placeholder="order-service"
              value={form.serviceName}
              status={errorOf("serviceName") ? "error" : undefined}
              onChange={(event) => update({ serviceName: event.target.value }, ["serviceName"])}
              onBlur={() => touch("serviceName")}
            />
            <Input
              id="quick-path"
              aria-label="请求路径"
              placeholder="/internal/orders/{orderNo}"
              value={form.path}
              status={errorOf("path") ? "error" : undefined}
              onChange={(event) => update({ path: event.target.value }, ["path"])}
              onBlur={() => touch("path")}
            />
          </Space.Compact>
        ),
        {
          required: true,
          span: true,
          extra: pathVariables.length ? (
            <span className="op-quick-create__detected">
              <CheckCircleFilled aria-hidden /> 已识别路径参数 {pathVariables.map((name) => <Tag key={name}>{name}</Tag>)}
            </span>
          ) : form.httpTargetMode === "URL" ? (
            "路径中用 {name} 表示路径参数，会自动生成对应的请求字段"
          ) : (
            "按当前环境的注册发现解析服务名；路径中用 {name} 表示路径参数"
          ),
        },
      )}
      {(errorOf("serviceName") || errorOf("path")) && form.httpTargetMode === "SERVICE_NAME" && (
        <p className="op-quick-create__inline-error op-span-all" role="alert">
          {errorOf("serviceName") ?? errorOf("path")}
        </p>
      )}
    </>
  );
  const dubboTarget = (
    <>
      {item(
        "connection",
        "注册中心连接",
        <ConnectionPicker
          api={api}
          hideLabel
          id="quick-connection"
          status={errorOf("connection") ? "error" : undefined}
          canManage={canManageConnections}
          binding={{
            protocol: "DUBBO",
            timeoutMillis: 3000,
            dubbo: { interfaceName: "", method: "", version: "", group: "", parameterTypes: [], connectionId: form.connectionId, connectionRevision: form.connectionRevision },
          }}
          onSelect={(binding) => {
            update({ connectionId: binding.dubbo?.connectionId ?? null, connectionRevision: binding.dubbo?.connectionRevision ?? null }, ["connection"]);
            touch("connection");
          }}
        />,
        { required: true, span: true },
      )}
      {item(
        "signature",
        "方法签名",
        <Input.TextArea
          id="quick-signature"
          autoSize={{ minRows: 2, maxRows: 4 }}
          spellCheck={false}
          placeholder="com.example.order.api.OrderQueryFacade#queryOrder(java.lang.String, int)"
          value={form.signature}
          onChange={(event) => update({ signature: event.target.value }, ["signature"])}
          onBlur={() => touch("signature")}
        />,
        {
          required: true,
          span: true,
          help: "全限定接口名#方法(参数类型, …)，参数类型写完整 Java 类型，不写泛型；无参数写 ()。",
          extra: signature?.value ? (
            <span className="op-quick-create__detected">
              <CheckCircleFilled aria-hidden /> 接口 <code>{signature.value.interfaceName.split(".").pop()}</code> · 方法 <code>{signature.value.method}</code> ·{" "}
              {signature.value.parameterTypes.length
                ? signature.value.parameterTypes.map((type, index) => (
                    <Tag key={index} title={type}>
                      arg{index}: {type.split(".").pop()}
                    </Tag>
                  ))
                : "无参数"}
            </span>
          ) : signature?.error && !errorOf("signature") ? (
            <span className="op-quick-create__warning">{signature.error}</span>
          ) : undefined,
        },
      )}
      <div className="op-span-all">
        <Button type="link" size="small" className="op-quick-create__toggle" onClick={() => setAdvancedDubbo((value) => !value)} aria-expanded={advancedDubbo}>
          {advancedDubbo ? "收起提供方选项" : "提供方应用、版本与分组（可选）"}
        </Button>
      </div>
      {advancedDubbo && (
        <>
          {item(
            "providerApplication",
            "提供方应用",
            <Input id="quick-providerApplication" placeholder="应用级发现时填写" value={form.providerApplication} onChange={(event) => update({ providerApplication: event.target.value }, ["providerApplication"])} />,
            { help: "应用级发现需要与注册中心应用名一致；接口级发现可留空。" },
          )}
          {item(
            "dubboVersion",
            "内部版本",
            <Input id="quick-dubboVersion" placeholder="未设置则留空" value={form.dubboVersion} onChange={(event) => update({ dubboVersion: event.target.value }, ["dubboVersion"])} />,
          )}
          {item(
            "dubboGroup",
            "服务组",
            <Input id="quick-dubboGroup" placeholder="未设置则留空" value={form.dubboGroup} onChange={(event) => update({ dubboGroup: event.target.value }, ["dubboGroup"])} />,
          )}
        </>
      )}
    </>
  );

  const notes = preview.result?.notes ?? [];
  return (
    <section className="op-quick-create" aria-label="快速创建 API">
      <PageHeader
        breadcrumb={
          <>
            <a href="#/apis" onClick={(event) => { event.preventDefault(); onCancel(); }}>API 列表</a> / 新建
          </>
        }
        title={form.protocol === "HTTP" ? "新建 HTTP API" : "新建 Dubbo API"}
        meta={<span className="op-muted">来源：{sourceLabels[source]} · 只需最少信息，创建后继续完善</span>}
        secondaryActions={
          <Button icon={<SwapOutlined aria-hidden />} onClick={onChangeSource}>
            更换来源
          </Button>
        }
      />
      {restoredAt && (
        <Alert
          className="op-quick-create__restored"
          type="info"
          showIcon
          title={`已恢复 ${new Date(restoredAt).toLocaleTimeString("zh-CN", { hour12: false })} 暂存的输入`}
          action={
            <Button
              size="small"
              onClick={() => {
                clearQuickDraft(source);
                setForm(initialForm(source));
                setRestoredAt(null);
                setTouched(new Set());
                setSubmitted(false);
                setServerErrors({});
              }}
            >
              丢弃，重新开始
            </Button>
          }
        />
      )}
      {generalIssues.length > 0 && (
        <Alert
          className="op-quick-create__restored"
          type="error"
          showIcon
          title="创建未完成"
          description={
            <ul className="op-quick-create__issues">
              {generalIssues.map((issue, index) => (
                <li key={index}>{issue.message}</li>
              ))}
            </ul>
          }
        />
      )}
      <div ref={formRef}>
      <Form layout="vertical" requiredMark className="op-quick-create__form" onFinish={() => void submit()}>
        <FormSection title="① 调用目标" description="平台收到调用后，转发到哪里。">
          <Form.Item className="op-span-all" label="协议">
            <Segmented
              aria-label="协议"
              value={form.protocol}
              options={[
                { value: "HTTP", label: "HTTP" },
                { value: "DUBBO", label: "Dubbo" },
              ]}
              onChange={(value) => update({ protocol: value as QuickForm["protocol"] })}
            />
          </Form.Item>
          {form.protocol === "HTTP" ? (
            <>
              <div className="op-span-all op-quick-create__curl">
                {curlOpen ? (
                  <div className="op-quick-create__curl-box">
                    <Input.TextArea
                      aria-label="粘贴 cURL 或原始 HTTP 请求"
                      autoSize={{ minRows: 3, maxRows: 8 }}
                      spellCheck={false}
                      placeholder={"curl -X POST 'http://order-service/internal/orders/{orderNo}' -H 'Content-Type: application/json' -d '{\"includeItems\":true}'"}
                      value={curlText}
                      onChange={(event) => setCurlText(event.target.value)}
                    />
                    <Space>
                      <Button type="primary" ghost disabled={!curlText.trim()} onClick={parseCurl}>
                        识别并填入
                      </Button>
                      <Button onClick={() => setCurlOpen(false)}>收起</Button>
                      <span className="op-muted">只在本地解析，不执行命令、不访问地址；认证与 Cookie 请求头会被忽略。</span>
                    </Space>
                  </div>
                ) : (
                  <Button type="link" size="small" className="op-quick-create__toggle" onClick={() => setCurlOpen(true)}>
                    从 cURL 填入
                  </Button>
                )}
                {curlResult?.error && <Alert type="error" showIcon title={curlResult.error} />}
                {curlResult?.warnings && (
                  <div className="op-quick-create__parsed" role="status">
                    <CheckCircleFilled aria-hidden />
                    <span>已填入地址、方法与请求样例，请核对。</span>
                    <details>
                      <summary>解析说明（{curlResult.warnings.length}）</summary>
                      <ul className="op-quick-create__issues">
                        {curlResult.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </details>
                  </div>
                )}
              </div>
              <Form.Item className="op-span-all" label="目标方式">
                <Radio.Group
                  aria-label="目标方式"
                  value={form.httpTargetMode}
                  onChange={(event) => update({ httpTargetMode: event.target.value }, ["url", "serviceName", "path"])}
                  options={[
                    { value: "URL", label: "固定 URL" },
                    { value: "SERVICE_NAME", label: "服务名发现" },
                  ]}
                />
              </Form.Item>
              {httpTarget}
            </>
          ) : (
            dubboTarget
          )}
        </FormSection>

        <FormSection title="② 对外标识" description="客户看到的名称与调用地址。service / method 按调用目标自动推导，可修改。">
          {item(
            "name",
            "名称",
            <Input id="quick-name" maxLength={100} placeholder="如：查询订单详情" value={form.name} onChange={(event) => update({ name: event.target.value }, ["name"])} onBlur={() => touch("name")} />,
            { required: true },
          )}
          {item(
            "category",
            "分类",
            <CategoryPicker
              api={api}
              hideLabel
              id="quick-category"
              label="分类"
              status={errorOf("category") ? "error" : undefined}
              value={form.category}
              onChange={(value) => {
                update({ category: value }, ["category"]);
                touch("category");
              }}
            />,
            { required: true },
          )}
          {item(
            "owner",
            "负责人",
            <OwnerPicker
              api={api}
              hideLabel
              id="quick-owner"
              status={errorOf("owner") ? "error" : undefined}
              value={form.owner}
              onDefault={(value) => setForm((current) => (current.owner ? current : { ...current, owner: value }))}
              onChange={(value) => {
                update({ owner: value }, ["owner"]);
                touch("owner");
              }}
            />,
            { required: true, extra: "默认是你自己" },
          )}
          {item(
            "version",
            "外部版本",
            <Input id="quick-version" maxLength={32} value={form.version} onChange={(event) => update({ version: event.target.value }, ["version"])} onBlur={() => { touch("version"); void checkIdentity(); }} />,
            { required: true, help: "出现在调用地址中，创建后不可修改；新版本请新建 API。" },
          )}
          {item(
            "service",
            "service",
            <Input
              id="quick-service"
              maxLength={64}
              placeholder="order"
              value={form.service}
              onChange={(event) => update({ service: event.target.value, identityEdited: true }, ["service"])}
              onBlur={() => { touch("service"); void checkIdentity(); }}
            />,
            { required: true, help: "同类业务的英文标识，如 order；出现在调用地址中，创建后不可修改。" },
          )}
          {item(
            "method",
            "method",
            <Input
              id="quick-method"
              maxLength={64}
              placeholder="detail"
              value={form.method}
              onChange={(event) => update({ method: event.target.value, identityEdited: true }, ["method"])}
              onBlur={() => { touch("method"); void checkIdentity(); }}
            />,
            {
              required: true,
              help: "具体操作的英文标识，如 detail；出现在调用地址中，创建后不可修改。",
              extra: form.identityEdited ? (
                <Button type="link" size="small" className="op-quick-create__toggle" onClick={() => update({ identityEdited: false }, ["service", "method"])}>
                  恢复自动推导
                </Button>
              ) : undefined,
            },
          )}
          <div className="op-span-all op-quick-create__address" aria-label="调用地址">
            <span className="op-quick-create__address-label">调用地址</span>
            <code>{callAddress}</code>
            <CopyButton value={callAddress} label="调用地址" />
          </div>
        </FormSection>

        <FormSection title="③ 请求与响应" description="可选。粘贴样例 JSON 自动生成字段；不粘贴也能创建，之后在配置页完善。">
          {item(
            "requestSample",
            "请求样例 JSON",
            <Input.TextArea
              id="quick-requestSample"
              autoSize={{ minRows: 5, maxRows: 14 }}
              spellCheck={false}
              placeholder={'{\n  "orderNo": "A001"\n}'}
              value={form.requestSample}
              onChange={(event) => update({ requestSample: event.target.value }, ["requestSample"])}
              onBlur={() => touch("requestSample")}
            />,
            {
              extra: preview.result ? `将生成 ${fieldCount(preview.result.definition.requestSchema)} 个请求字段、${preview.result.definition.mappings.length} 条参数映射` : undefined,
            },
          )}
          {item(
            "responseSample",
            "响应样例 JSON",
            <Input.TextArea
              id="quick-responseSample"
              autoSize={{ minRows: 5, maxRows: 14 }}
              spellCheck={false}
              placeholder={'{\n  "orderNo": "A001",\n  "status": "PAID"\n}'}
              value={form.responseSample}
              onChange={(event) => update({ responseSample: event.target.value }, ["responseSample"])}
              onBlur={() => touch("responseSample")}
            />,
            {
              extra: preview.result?.definition.responseSchema && fieldCount(preview.result.definition.responseSchema)
                ? `将生成 ${fieldCount(preview.result.definition.responseSchema)} 个响应字段，按“直接使用业务对象”返回`
                : "返回处理默认为“直接使用业务对象”，有统一外壳时可在配置页调整",
            },
          )}
          {preview.error && ["requestSample", "responseSample"].includes(preview.error.field) && !errorOf(preview.error.field) && (
            <p className="op-quick-create__warning op-span-all">{preview.error.message}</p>
          )}
          {notes.length > 0 && (
            <div className="op-span-all op-quick-create__notes" aria-label="创建后建议完善">
              <InfoCircleOutlined aria-hidden />
              <div>
                <strong>创建后建议在配置页完善</strong>
                <ul className="op-quick-create__issues">
                  {notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </FormSection>
        <StickyActionBar status={savedAt ? `已在本页暂存 ${new Date(savedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "输入会自动暂存在本页"}>
          <Button onClick={cancel} disabled={busy}>
            取消
          </Button>
          <Button type="primary" htmlType="submit" loading={busy}>
            创建草稿并继续完善
          </Button>
        </StickyActionBar>
      </Form>
      </div>
    </section>
  );
}
