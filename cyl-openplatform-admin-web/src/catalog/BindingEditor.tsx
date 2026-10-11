import DefaultMappingButton from "./DefaultMappingButton";
import { schemaPaths } from "./defaultMappings";
import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import ConnectionPicker from "../connections/ConnectionPicker";
import { FieldHelp } from "@cyl/open-platform-web-shared/ui/components";
import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import {
  Alert,
  Button,
  ConfigProvider,
  Input,
  Radio,
  Select,
  Space,
  Table,
  type InputRef,
  type TableColumnsType,
} from "antd";
import "./editors.css";
import type { AdminApi } from "../access/api";
import { stringifyJson, parseJson } from "@cyl/open-platform-web-shared/json";
import { parseDubboSignature } from './dubboSignature';
import type { Mapping } from "./SchemaEditor";
import { httpTemplate, httpBindingTemplate, mappingLocation, hasJsonBody, previewHttpRequest, schemaPreviewSample, type HttpLocation } from "./httpMapping";

export interface Binding {
  protocol: "HTTP" | "DUBBO";
  timeoutMillis: number;
  http?: { url?: string | null; method: string; targetMode?: 'URL' | 'SERVICE_NAME' | null;
    serviceName?: string | null; path?: string | null; sourceClass?: string | null; sourceMethod?: string | null } | null;
  dubbo?: {
    interfaceName: string;
    method: string;
    version: string | null;
    group: string | null;
    parameterTypes: string[];
    connectionId?: string | null;
    connectionRevision?: number | null;
    providerApplication?: string | null;
  } | null;
}
export const newBinding = (protocol: Binding["protocol"]): Binding =>
  protocol === "HTTP"
    ? { protocol, timeoutMillis: 3000, http: { url: "", method: "POST" } }
    : {
        protocol,
        timeoutMillis: 3000,
        dubbo: {
          interfaceName: "",
          method: "",
          version: "",
          group: "",
          parameterTypes: [],
        },
      };

/** 调用目标身份：超时与 HTTP 地址不属于 Dubbo 签名确认范围。 */
export function bindingSignature(binding: Binding): string {
  const dubbo = binding.dubbo;
  return stringifyJson([
    binding.protocol,
    dubbo?.connectionId ?? null,
    dubbo?.connectionRevision ?? null,
    dubbo?.interfaceName ?? null,
    dubbo?.version ?? null,
    dubbo?.group ?? null,
    dubbo?.providerApplication ?? null,
    dubbo?.method ?? null,
    dubbo?.parameterTypes ?? [],
  ]);
}

export function BindingEditor({
  api,
  value,
  onChange,
  mappingCount,
  protectSignature = Boolean(value.dubbo?.interfaceName && value.dubbo?.method),
  onManualPendingChange,
  onRequestChange,
  canManageConnections = false,
}: {
  api: AdminApi;
  value: Binding;
  onChange: (value: Binding) => void;
  mappingCount: number;
  canManageConnections?: boolean;
  protectSignature?: boolean;
  onManualPendingChange?: (pending: boolean) => void;
  onRequestChange: (candidate: Binding) => void;
}) {
  const [manualSignature, setManualSignature] = useState(value.dubbo);
  const appliedSignature = stringifyJson(value.dubbo ?? null);
  useEffect(() => setManualSignature(value.dubbo), [appliedSignature]);
  const requiresConfirmation =
    protectSignature &&
    Boolean(value.dubbo?.interfaceName && value.dubbo?.method);
  const signature = requiresConfirmation ? manualSignature : value.dubbo;
  const manualPending =
    value.protocol === "DUBBO" &&
    requiresConfirmation &&
    stringifyJson(signature ?? null) !== appliedSignature;
  useEffect(() => {
    onManualPendingChange?.(manualPending);
    return () => onManualPendingChange?.(false);
  }, [manualPending, onManualPendingChange]);
  const [signatureText, setSignatureText] = useState('');
  const [parsedSignature, setParsedSignature] = useState<ReturnType<typeof parseDubboSignature> | null>(null);
  const [parseError, setParseError] = useState('');
  const instanceRequest = useRef<AbortController | null>(null);
  const [instances, setInstances] = useState<{ serviceName: string; instanceCount: number; checkedAt: string } | null>(null);
  const [instanceError, setInstanceError] = useState('');
  const [checkingInstances, setCheckingInstances] = useState(false);
  useEffect(() => { setInstanceError(''); setCheckingInstances(false); return () => instanceRequest.current?.abort(); }, [value.http?.serviceName]);
  const serviceTarget = value.http?.targetMode === 'SERVICE_NAME';
  const replace = onRequestChange;
  const patchDubbo = (patch: Partial<NonNullable<Binding["dubbo"]>>) => {
    const candidate = { ...signature!, ...patch };
    if (requiresConfirmation) setManualSignature(candidate);
    else onChange({ ...value, dubbo: candidate });
  };
  return (
    <div className="contract-body">
      <div className="contract-fields binding-basics">
        <label>
          <span className="field-label">
            内部协议 <span className="required-mark">*</span>
          </span>
          <Select data-field-path="/binding/protocol" aria-label="服务协议" value={value.protocol} style={{ width: '100%' }}
            onChange={protocol => replace(newBinding(protocol))} options={[{ value: 'HTTP', label: 'HTTP' }, { value: 'DUBBO', label: 'DUBBO' }]} />
        </label>
        <label>
          <span className="field-label">
            最长等待时间 <span className="required-mark">*</span>
          </span>
          <Input
            required
            data-field-path="/binding/timeoutMillis"
            aria-label="最长等待时间（毫秒）"
            type="number"
            min={100}
            max={30000}
            value={value.timeoutMillis}
            onChange={(event) =>
              onChange({
                ...value,
                timeoutMillis:
                  event.target.value === "" ? NaN : Number(event.target.value),
              })
            }
          />
          <small>100–30000 毫秒；3000 毫秒 = 3 秒</small>
        </label>
        {value.protocol === "HTTP" && (
          <>
            <label className="http-target-location"><span className="field-label">目标定位<FieldHelp label="目标定位">服务名使用当前环境注册发现与负载均衡；固定 URL 直接请求指定地址。仅启用所选方式，切换保留另一方式的输入。</FieldHelp></span>
              <Radio.Group aria-label="目标定位" value={serviceTarget ? 'SERVICE_NAME' : 'URL'} optionType="button" buttonStyle="solid"
                onChange={event => onChange({...value,http:{...value.http!,targetMode:event.target.value}})}
                options={[{value:'SERVICE_NAME',label:'服务名发现'},{value:'URL',label:'固定 URL'}]} />
            </label>
            {serviceTarget ? <label><span className="field-label">服务名 <span className="required-mark">*</span></span>
              <Input required aria-label="内部服务名" data-field-path="/binding/http/serviceName" maxLength={200} value={value.http?.serviceName ?? ''} placeholder="如 order-provider"
                onChange={event=>onChange({...value,http:{...value.http!,serviceName:event.target.value}})} />
              <div className="http-instance-state"><Button size="small" loading={checkingInstances} disabled={!value.http?.serviceName} onClick={async()=>{
                instanceRequest.current?.abort(); const controller=new AbortController(); instanceRequest.current=controller;
                setCheckingInstances(true); setInstanceError(''); setInstances(null);
                try { const result=await api<{serviceName:string;instanceCount:number;checkedAt:string}>(`/apis/http-target/instances?serviceName=${encodeURIComponent(value.http!.serviceName!)}`,{signal:controller.signal});
                  if(!controller.signal.aborted)setInstances(result);
                } catch(failure) { if(!controller.signal.aborted)setInstanceError((failure as Error).message); }
                finally { if(!controller.signal.aborted)setCheckingInstances(false); }
              }}>检查实例</Button><small className={instances && instances.serviceName === value.http?.serviceName ? instances.instanceCount > 0 ? 'http-instances-available' : 'http-instances-empty' : ''}>{instances && instances.serviceName === value.http?.serviceName
                ? instances.instanceCount > 0 ? `当前环境可用 ${instances.instanceCount} 个实例 · ${new Date(instances.checkedAt).toLocaleTimeString()}`
                  : `未发现可用实例 · ${new Date(instances.checkedAt).toLocaleTimeString()} · 当前无法调用，请核对服务名与当前环境`
                : '尚未查询当前环境实例'}</small></div>
              {instanceError && <small role="alert" className="error-note">{instanceError}</small>}
            </label> :
            <label>
              <span className="field-label">
                提供方 URL <span className="required-mark">*</span>
              </span>
              <Input
                data-field-path="/binding/http/url"
                aria-label="内部请求地址"
                required
                type="url"
                maxLength={2000}
                placeholder="如 https://provider.example.invalid/orders/query"
                value={value.http?.url ?? ""}
                onChange={(event) =>
                  onChange({
                    ...value,
                    http: { ...value.http!, url: event.target.value },
                  })
                }
              />
              <small>
                向内部服务维护者确认完整地址；不是客户调用开放平台的地址。不允许
                URL 内含账号密码或 fragment；.invalid 仅为示例。
              </small>
            </label>}
            {serviceTarget && <label><span className="field-label">请求路径 <span className="required-mark">*</span></span>
              <Input required aria-label="内部请求路径" data-field-path="/binding/http/path" maxLength={1976} value={value.http?.path ?? ''} placeholder="/orders/{id}"
                onChange={event=>onChange({...value,http:{...value.http!,path:event.target.value}})} />
              <small>以/开头；普通路径变量由下方PATH映射取值。</small></label>}
            <label>
              <span className="field-label">
                内部 HTTP 方法 <span className="required-mark">*</span>
              </span>
              <Select data-field-path="/binding/http/method" aria-label="HTTP 方法" value={value.http?.method ?? 'POST'} style={{ width: '100%' }}
                onChange={method => onChange({ ...value, http: { ...value.http!, method } })}
                options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(method => ({ value: method, label: method }))} />
            </label>
          </>
        )}
      </div>
      {value.protocol === 'HTTP' && <details className="http-contract-source"><summary>契约来源（可选）· Feign 接口类与方法，仅用于内部搜索</summary>
        <div className="contract-fields binding-basics"><label>内部接口类<Input aria-label="内部接口类" data-field-path="/binding/http/sourceClass" maxLength={1024} value={value.http?.sourceClass ?? ''}
          placeholder="com.company.order.OrderFeignClient" onChange={event=>onChange({...value,http:{...value.http!,sourceClass:event.target.value}})} /></label>
          <label>内部 Java 方法<Input aria-label="内部Java方法" data-field-path="/binding/http/sourceMethod" maxLength={128} value={value.http?.sourceMethod ?? ''}
            placeholder="queryItems" onChange={event=>onChange({...value,http:{...value.http!,sourceMethod:event.target.value}})} /></label></div>
      </details>}
      {value.protocol === "DUBBO" && (
        <>
          <ConnectionPicker
            api={api}
            binding={value}
            canManage={canManageConnections}
            onSelect={replace}
          />
          <p className="target-verification-state">
            手填或导入签名；注册中心检查不核验业务接口/方法，保存后可显式测试。
          </p>
          <details className="dubbo-signature-paste">
            <summary>可选：粘贴完整 Java 方法签名</summary>
            <Input.TextArea aria-label="完整Java方法签名" rows={2} maxLength={5000}
              placeholder="com.example.OrderService#lookup(java.lang.String, int)" value={signatureText}
              onChange={event => { setSignatureText(event.target.value); setParsedSignature(null); setParseError(''); }} />
            <div className="form-actions"><Button onClick={() => {
              try { setParsedSignature(parseDubboSignature(signatureText)); setParseError(''); }
              catch (reason) { setParsedSignature(null); setParseError((reason as Error).message); }
            }}>解析预览</Button><Button onClick={() => { setParsedSignature(null); setParseError(''); }}>取消预览</Button></div>
            {parseError && <p role="alert" className="error-note">{parseError}</p>}
            {parsedSignature && <section aria-label="签名解析预览">
              <p><code>{parsedSignature.interfaceName}#{parsedSignature.method}</code></p>
              <Table size="small" pagination={false} rowKey="index" dataSource={parsedSignature.parameterTypes.map((type, index) => ({ index, type }))}
                columns={[{ title: '有序参数', dataIndex: 'index', render: index => `arg${index}` }, { title: 'Java类型', dataIndex: 'type' }]} />
              {!parsedSignature.parameterTypes.length && <p className="help-text">无参数方法</p>}
              <Button type="primary" onClick={() => { replace({ ...value, dubbo: { ...signature!, ...parsedSignature } }); setParsedSignature(null); }}>填入下方字段</Button>
              <p className="help-text">仅替换接口、方法和有序类型；保留版本、服务组及固定连接，未自动保存或执行。</p>
            </section>}
          </details>
          <div className="contract-fields dubbo-fields">
            {(
              [
                {
                  key: "interfaceName",
                  label: "接口全限定名",
                  placeholder: "com.example.order.OrderService",
                  help: "复制提供方的完整 Java 接口名，包含包名。",
                },
                {
                  key: "method",
                  label: "内部方法",
                  placeholder: "queryOrder",
                  help: "提供方实际执行的方法名，与客户使用的操作标识可以不同。",
                },
                {
                  key: "providerApplication",
                  label: "提供方应用",
                  placeholder: "应用级发现时选择或填写",
                  help: "应用级发现需要与注册中心应用名一致；接口级发现可留空。",
                },
                {
                  key: "parameterTypes",
                  label: "参数类型（按顺序）",
                  placeholder: "java.lang.String, java.lang.Integer",
                  help: "按方法参数顺序填写完整 Java 类型，逗号分隔；无参数时留空，最多20项，不填写泛型。",
                },
                {
                  key: "version",
                  label: "内部版本（可未设置）",
                  placeholder: "未设置则留空",
                  help: "与提供方声明一致；未声明时留空，不自动补版本或通配符。",
                },
                {
                  key: "group",
                  label: "服务组（可未设置）",
                  placeholder: "未设置则留空",
                  help: "与提供方声明一致；未声明时留空，不使用通配符。",
                },
              ] as const
            ).map((field) => field.key === 'parameterTypes' ? (
              <div key={field.key} className="dubbo-field-parameterTypes">
                <span className="field-label">参数类型（按顺序）<FieldHelp label="参数类型">按方法参数顺序填写完整 Java 类型；argN 从 arg0 开始，对象字段可映射到 argN.field。最多 20 个参数，使用擦除泛型后的完整类型。</FieldHelp></span>
                <Table size="small" pagination={false} rowKey="index"
                  dataSource={(signature?.parameterTypes ?? []).map((type, index) => ({ type, index }))}
                  columns={[{ title: '索引', width: 72, dataIndex: 'index', render: index => `arg${index}` },
                    { title: 'Java类型', key: 'type', render: (_, row) => <Input aria-label={`arg${row.index} Java类型`} maxLength={200} value={row.type}
                      data-field-path={`/binding/dubbo/parameterTypes/${row.index}`}
                      onChange={event => patchDubbo({ parameterTypes: signature!.parameterTypes.map((type, index) => index === row.index ? event.target.value : type) })} /> },
                    { title: '操作', key: 'remove', width: 68, render: (_, row) => <Button type="link" size="small" aria-label={`删除arg${row.index}`} onClick={() => patchDubbo({ parameterTypes: signature!.parameterTypes.filter((_, index) => index !== row.index) })}>删除</Button> }]} />
                <Button size="small" disabled={(signature?.parameterTypes.length ?? 0) >= 20} onClick={() => patchDubbo({ parameterTypes: [...(signature?.parameterTypes ?? []), ''] })}>新增参数</Button>
              </div>
            ) : (
              <label key={field.key} className={`dubbo-field-${field.key}`}>
                <span className="field-label">
                  {field.label}
                  {["interfaceName", "method"].includes(field.key) && (
                    <span className="required-mark"> *</span>
                  )}
                  <FieldHelp label={field.label}>{field.help}</FieldHelp>
                </span>
                <Input
                  aria-label={field.label}
                  data-field-path={`/binding/dubbo/${field.key}`}
                  required={["interfaceName", "method"].includes(field.key)}
                  maxLength={
                    field.key === "interfaceName" ? 200 : 100
                  }
                  placeholder={field.placeholder}
                  value={
                    signature?.[field.key] ?? ""
                  }
                  onChange={(event) => {
                    const text = event.target.value;
                    patchDubbo(
                      field.key === "providerApplication"
                          ? { providerApplication: text || null }
                          : { [field.key]: text },
                    );
                  }}
                />
              </label>
            ))}
          </div>
          {manualPending && (
            <Alert
              type="warning"
              showIcon
              role="status"
              title="手工签名尚未应用"
              description={
                <>
                  当前已应用方法仍为 {value.dubbo?.method}
                  。确认后才替换接口、内部版本、分组、方法和有序参数类型；现有 {mappingCount} 条映射会保留，请核对调用含义。
                </>
              }
              action={
                <Space orientation="vertical">
                  <Button size="small" type="primary" onClick={() => replace({ ...value, dubbo: signature })}>
                    应用手工签名…
                  </Button>
                  <Button size="small" onClick={() => setManualSignature(value.dubbo)}>
                    撤销未应用签名
                  </Button>
                </Space>
              }
            />
          )}
        </>
      )}
    </div>
  );
}
export function MappingEditor({
  api,
  mappings,
  onChange,
  paths,
  binding,
  requestSchema,
  defaultMappingBlocked,
}: {
  api: AdminApi;
  mappings: Mapping[];
  onChange: (value: Mapping[]) => void;
  paths: string[];
  requestSchema?: SchemaNode;
  defaultMappingBlocked?: string;
  binding: Binding;
}) {
  // 行号随删除变化，输入组件身份不能随之复用到另一行。
  const currentMappings = useRef(mappings);
  currentMappings.current = mappings;
  const publishMappings = (next: Mapping[]) => { currentMappings.current = next; onChange(next); };
  const rowKeys = useRef<string[]>([]);
  const nextKey = useRef(0);
  while (rowKeys.current.length < mappings.length)
    rowKeys.current.push(`mapping-${nextKey.current++}`);
  if (rowKeys.current.length > mappings.length)
    rowKeys.current.length = mappings.length;
  const removeMappings = (indices: number[]) => {
    const removed = new Set(indices);
    rowKeys.current = rowKeys.current.filter((_, index) => !removed.has(index));
    publishMappings(currentMappings.current.filter((_, index) => !removed.has(index)));
  };
  const remove = (index: number) => removeMappings([index]);
  interface MappingRow { key: string; mapping: Mapping; index: number; virtual?: boolean }
  const update = (row: MappingRow, patch: Partial<Mapping>) => {
    const current = currentMappings.current;
    if (row.virtual) {
      if (current.length >= 100) { setActionError("映射已到100项上限，请先整理已有规则。"); return; }
      publishMappings([...current, { ...row.mapping, ...patch }]);
    } else {
      const index = rowKeys.current.indexOf(row.key);
      if (index >= 0) publishMappings(current.map((item, position) => position === index ? { ...item, ...patch } : item));
    }
  };
  const [actionError, setActionError] = useState('');
  const area = useRef<HTMLDivElement>(null);
  const rows = mappings.map((mapping, index) => ({ key: rowKeys.current[index], mapping, index }));
  const isHttp = binding.protocol === 'HTTP', method = binding.http?.method ?? 'POST';
  let variables: string[] = [], templateError = '';
  if (isHttp && binding.http && httpBindingTemplate(binding.http)) {
    try { variables = httpTemplate(httpBindingTemplate(binding.http)).names; }
    catch (failure) { templateError = (failure as Error).message; }
  }
  const pathRows: MappingRow[] = variables.map(name => rows.find(row => mappingLocation(row.mapping, method) === 'PATH' && row.mapping.target === name)
    ?? { key: `path:${name}`, index: -1, virtual: true, mapping: { target: name, source: 'REQUEST', path: null, location: 'PATH' } });
  const orphanRows = rows.filter(row => mappingLocation(row.mapping, method) === 'PATH' && !variables.includes(row.mapping.target));
  const bodyRows = rows.filter(row => mappingLocation(row.mapping, method) === 'BODY');
  const wrongBodyMethod = isHttp && !hasJsonBody(method);
  const migrateBody = () => {
    if (Array.from(area.current?.querySelectorAll<HTMLInputElement>('input') ?? []).some(input => input.validity.customError)) {
      setActionError('先切回支持正文的方法，校验并应用固定值，再迁移；也可明确移除正文规则。'); return;
    }
    const queryTargets = new Set(rows.filter(row => mappingLocation(row.mapping, method) === 'QUERY').map(row => row.mapping.target));
    if (bodyRows.some(row => [...queryTargets].some(target => target === row.mapping.target || target.startsWith(row.mapping.target + '.') || row.mapping.target.startsWith(target + '.')))) {
      setActionError('Query已有同名或覆盖目标，请先调整Query规则后迁移。'); return;
    }
    setActionError(''); onChange(mappings.map(mapping => mappingLocation(mapping, method) === 'BODY' ? { ...mapping, location: 'QUERY' } : mapping));
  };
  const help = (label: string, text: string) => <FieldHelp label={label.replace(/说明$/, '')}>{text}</FieldHelp>;
  const columns: TableColumnsType<MappingRow> = [
    {
      title: <span>内部目标 {binding.protocol === 'DUBBO' && <FieldHelp label="Dubbo映射顺序">argN 按 Java 方法参数顺序从 arg0 开始；对象字段使用 argN.field。</FieldHelp>}</span>,
      key: "0",
      width: "26%",
      render: (_, row) => {
        const { mapping, index } = row;
        const rowLabel = row.virtual ? `路径变量${mapping.target}` : `映射${index + 1}`;
        return (
        <div className="mapping-cell">
          <Input
            required
            readOnly={isHttp && mappingLocation(mapping, method) === 'PATH'}
            data-field-path={`/mappings/${index}/target`}
            aria-label={`${rowLabel}目标`}
            list={
              binding.protocol === "DUBBO"
                ? `mapping-target-${index}`
                : undefined
            }
            placeholder={
              binding.protocol === "DUBBO"
                ? "arg0 或 arg0.orderId"
                : "如 orderId"
            }
            value={mapping.target}
            onChange={(event) => update(row, { target: event.target.value })}
          />
          {binding.protocol === "DUBBO" && (
            <>
              <datalist id={`mapping-target-${index}`}>
                {binding.dubbo?.parameterTypes.map((type, arg) => (
                  <option key={arg} value={`arg${arg}`}>
                    {type}
                  </option>
                ))}
              </datalist>
            </>
          )}
        </div>
        );
      },
    },
    {
      title: <span>取值来源 {help('取值规则帮助', '客户请求取公开JSON字段；固定值每次相同；平台身份取真实验证上下文。预览身份仅为样例。')}</span>,
      key: "1",
      width: "25%",
      render: (_, row) => {
        const { mapping, index } = row;
        const rowLabel = row.virtual ? `路径变量${mapping.target}` : `映射${index + 1}`;
        return (
        <div className="mapping-cell">
          <Select
            value={mapping.source}
            data-field-path={`/mappings/${index}/source`}
            aria-label={`${rowLabel}来源`}
            style={{ width: '100%' }}
            onChange={source => update(row, { source, path: null, value: null })}
            options={[{ value: 'REQUEST', label: '客户请求字段' }, { value: 'CONTEXT', label: '平台验证的身份' }, { value: 'FIXED', label: '固定值' }]}
          />
        </div>
        );
      },
    },
    {
      title: <span>来源字段 / 固定值 {help('固定JSON值填写说明', '按JSON填写：字符串需双引号，数字、布尔、数组、对象使用JSON字面值。PATH仅接受非空标量；修改后先校验并应用。')}</span>,
      key: "2",
      width: "40%",
      render: (_, row) => {
        const { mapping, index } = row;
        const rowLabel = row.virtual ? `路径变量${mapping.target}` : `映射${index + 1}`;
        const sourcePaths = isHttp && mappingLocation(mapping, method) === 'PATH' && requestSchema
          ? schemaPaths(requestSchema).filter(item => !['OBJECT', 'ARRAY'].includes(item.type)).map(item => item.path) : paths;
        const invalidSource = mapping.source === 'REQUEST' && Boolean(mapping.path) && !sourcePaths.includes(mapping.path!);
        return (
        <div className="mapping-cell">
          {mapping.source === "FIXED" ? (
            <FixedValue
              fieldPath={`/mappings/${index}/value`}
              key={stringifyJson(mapping.value ?? null)}
              api={api}
              value={mapping.value ?? null}
              onChange={(value) => update(row, { value })}
            />
          ) : (<>
            <Select
              aria-label={`${rowLabel}字段`}
              data-field-path={`/mappings/${index}/path`}
              value={mapping.path || undefined}
              status={invalidSource ? 'error' : undefined}
              aria-invalid={invalidSource || undefined}
              placeholder="搜索来源字段"
              showSearch={{ optionFilterProp: "label" }}
              onChange={(path) => update(row, { path })}
              options={(mapping.source === "REQUEST"
                ? [
                    ...sourcePaths,
                    ...(mapping.path && !sourcePaths.includes(mapping.path)
                      ? [mapping.path]
                      : []),
                  ]
                : [
                    "applicationId",
                    "appKey",
                    "tenantId",
                    "userId",
                    "employeeId",
                    "employeeNo",
                  ]
              ).map((path) => ({
                value: path,
                label:
                  mapping.source === "REQUEST" && !paths.includes(path)
                    ? `${path}（字段不存在，请调整）`
                    : path,
              }))}
            />
            {invalidSource && <small className="error-note">{paths.includes(mapping.path!) ? 'PATH来源请选择标量字段' : '字段不存在，请调整'}</small>}
          </>)}
        </div>
        );
      },
    },
    {
      title: "操作",
      key: "3",
      width: "9%",
      render: (_, row) => {
        const { index } = row;
        return (
        <div className="mapping-cell">
          <Button type="link" size="small" danger disabled={row.virtual} onClick={() => remove(index)}>
            移除
          </Button>
        </div>
        );
      },
    },
  ];
  const table = (items: MappingRow[], location?: HttpLocation) => <Table<MappingRow> size="small" tableLayout="fixed" pagination={false}
    columns={columns.map(column => column.key === '0' ? { ...column, title: <span>{location === 'PATH' ? '路径变量（自动）' : location === 'QUERY' ? 'Query参数' : location === 'BODY' ? 'JSON字段' : '内部目标'} {help('目标位置说明', location === 'PATH' ? '变量来自URL模板，目标不可编辑；值须为非空标量。' : location === 'QUERY' ? '参数进入最终query；URL已有固定同名参数不可重复。' : location === 'BODY' ? '字段进入JSON正文，GET/DELETE不支持。' : 'argN按Java参数顺序；对象字段使用argN.field。')}</span> } : column)}
    dataSource={items} rowKey="key" onRow={({ index }) => ({ 'data-field-path': index < 0 ? '/binding/http/url' : `/mappings/${index}` }) as HTMLAttributes<HTMLTableRowElement>}
    locale={{ emptyText: location === 'PATH' ? '当前路径没有变量。' : '暂无取值规则。' }} />;
  const section = (location: HttpLocation, items: MappingRow[]) => <section className="http-mapping-section" aria-label={`${location}映射`}>
    <div className="mapping-toolbar"><h3>{location === 'PATH' ? '路径变量' : location === 'QUERY' ? 'Query参数' : 'JSON正文'} <code>{location}</code></h3>
      {location !== 'PATH' && <Button size="small" disabled={mappings.length >= 100 || location === 'BODY' && wrongBodyMethod}
        onClick={() => onChange([...mappings, { target: '', source: 'REQUEST', path: null, location }])}>＋ 添加{location === 'QUERY' ? 'Query参数' : '正文映射'}</Button>}</div>
    <ConfigProvider componentDisabled={location === 'BODY' && wrongBodyMethod ? true : undefined}><fieldset className="http-mapping-fields" disabled={location === 'BODY' && wrongBodyMethod}>{table(items, location)}</fieldset></ConfigProvider>
    {location === 'BODY' && wrongBodyMethod && <div className="http-body-disabled"><span>{method}不支持JSON正文；{items.length ? '已有规则保留，切回POST/PUT/PATCH可继续编辑。' : '请选择支持正文的方法。'}</span>
      {items.length > 0 && <div><Button size="small" onClick={migrateBody}>迁移到Query</Button><Button size="small" onClick={() => { setActionError(''); removeMappings(bodyRows.map(row => row.index)); }}>移除{items.length}条正文规则</Button></div>}</div>}
  </section>;
  return <div className="contract-mapping" ref={area}>
    <div className="mapping-toolbar"><span>{mappings.length}条取值规则</span>
      {requestSchema && <DefaultMappingButton schema={requestSchema} blockedReason={defaultMappingBlocked} binding={binding} mappings={mappings} onChange={onChange} />}
    </div>
    {isHttp ? <>
      {templateError && <p role="alert" className="error-note">{templateError}</p>}
      {section('PATH', pathRows)}
      {orphanRows.length > 0 && <div className="http-orphan-mappings"><p role="alert">已移除路径变量的旧规则仍保留，请核对后清理。</p>{table(orphanRows, 'PATH')}
        <Button size="small" onClick={() => removeMappings(orphanRows.map(row => row.index))}>清理{orphanRows.length}条旧PATH规则</Button></div>}
      {section('QUERY', rows.filter(row => mappingLocation(row.mapping, method) === 'QUERY'))}
      {section('BODY', bodyRows)}

    </> : table(rows)}
    {actionError && <p role="alert" className="error-note">{actionError}</p>}
  </div>;
}

export function HttpRequestPreview({ binding, mappings, requestSchema }: { binding: Binding; mappings: Mapping[]; requestSchema: SchemaNode }) {
  const [sampleOverride, setSampleOverride] = useState<string | null>(null);
  const text = sampleOverride ?? stringifyJson(schemaPreviewSample(requestSchema), 2);
  let preview: ReturnType<typeof previewHttpRequest> | null = null, error = '';
  try { preview = previewHttpRequest(binding, mappings, parseJson(text)); }
  catch (failure) { error = (failure as Error).message; }
  return <section className="http-request-preview" aria-label="最终HTTP请求预览">
    <div className="mapping-toolbar"><h3>最终请求预览</h3><span>样例取值；路径 → Query → JSON正文，预览不发送</span></div>
    {error && <p role="alert" className="error-note">{error}</p>}
    {preview && <><code className="http-preview-target">{preview.method} {preview.url}</code><pre>{preview.body == null ? '无JSON正文' : stringifyJson(preview.body, 2)}</pre></>}
    <details data-preview-input><summary>查看 / 调整预览样例</summary><Input.TextArea aria-label="HTTP预览样例JSON" rows={3} value={text} onChange={event => setSampleOverride(event.target.value)} />
      <Button type="link" size="small" onClick={() => setSampleOverride(null)}>使用请求文档样例</Button></details>
    <p className="help-text">身份是样例占位，不成为真实调用身份；提供方证明按最终方法、路径及Query生成，预览不生成真实凭据。</p>
  </section>;
}

function FixedValue({
  fieldPath,
  api,
  value,
  onChange,
}: {
  fieldPath: string;
  api: AdminApi;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [text, setText] = useState(stringifyJson(value));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<InputRef>(null);
  const validationRequest = useRef<AbortController | null>(null);
  useEffect(() => () => validationRequest.current?.abort(), []);
  return (
    <>
      <Input
        ref={input}
        data-field-path={fieldPath}
        aria-label="固定 JSON 值"
        value={text}
        maxLength={262144}
        disabled={busy}
        onChange={(event) => {
          setText(event.target.value);
          const pending = event.target.value !== stringifyJson(value);
          // antd 在设置 maxLength 时会克隆事件目标，未应用状态必须写到真实输入框上。
          input.current?.input?.setCustomValidity(pending ? "请校验并应用固定值" : "");
          setError(pending ? "尚未应用，先校验后才能保存草稿。" : "");
        }}
      />
      <Button
        type="link"
        size="small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const controller = new AbortController();
          validationRequest.current = controller;
          try {
            const validated = await api("/apis/validate-json", {
                method: "POST",
                bodyText: text,
                signal: controller.signal,
              });
            if (controller.signal.aborted) return;
            onChange(validated);
            input.current?.input?.setCustomValidity("");
            setError("");
          } catch (failure) {
            if (!controller.signal.aborted) setError((failure as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        校验并应用
      </Button>
      {error && (
        <small role="alert" className="error-note">
          {error}
        </small>
      )}
    </>
  );
}
