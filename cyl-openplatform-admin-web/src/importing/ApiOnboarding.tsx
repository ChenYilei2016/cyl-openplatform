import { UploadOutlined } from "@ant-design/icons";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import { parseJson, stringifyJson } from "@cyl/open-platform-web-shared/json";
import { PageHeader, StatusBadge, StickyActionBar } from "@cyl/open-platform-web-shared/ui/components";
import { Button, Checkbox, Form, Input, Radio, Table } from "antd";
import { useEffect, useRef, useState } from "react";
import type { AdminApi } from "../access/api";
import type { ApiDefinition } from "../catalog/CatalogPanel";
import { CategoryPicker, OwnerPicker, isOwnerReference } from "../catalog/CatalogReferenceFields";
import { httpTargetLabel } from "../catalog/httpMapping";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import ApiImport, { readPendingImport } from "./ApiImport";
import CandidateEditor from "./CandidateEditor";
import { parseHttpRequestSource } from "./httpRequestSource";
import "./importing.css";

type SourceKind = "PLATFORM" | "OPENAPI" | "HTTP";
interface Candidate {
  key: string;
  label: string;
  definition: Partial<ApiDefinition> | null;
  warnings: string[];
  blockers: string[];
  prepared?: string;
}
const maxBytes = 256 * 1024;
const sourceNames = {
  OPENAPI: "接口文档 · OpenAPI 3.0 JSON",
  HTTP: "HTTP 请求 · cURL / 原始 HTTP",
  PLATFORM: "平台导出的接口配置 JSON",
};
const sourceScopes = {
  OPENAPI: "支持 OpenAPI 3.0 JSON 与本地引用，最多 100 个操作；不支持 3.1、Swagger 2 或 YAML，请转换后再导入。",
  HTTP: "支持 cURL 或原始 HTTP 的 JSON 对象。只解析，不执行命令或访问地址；不支持文件、变量、脚本和表单。",
  PLATFORM: "平台导出的配置，最多 20 项。请补回导出时移除的敏感配置。",
};
function missingFields(item: Candidate) {
  if (!item.definition) return "需按原文重建配置";
  return (
    (
      [
        ["service", "服务标识"],
        ["version", "外部版本"],
        ["method", "操作标识"],
        ["name", "名称"],
        ["category", "分类"],
        ["owner", "负责人"],
        ["responseSchema", "真实响应结构"],
      ] as const
    )
      .filter(([key]) => !item.definition?.[key] || (key === "owner" && !isOwnerReference(String(item.definition.owner || ""))))
      .map(([, label]) => label)
      .join("、") || "核对映射、权限和真实响应"
  );
}
const sample = {
  format: "cyl-openplatform.catalog/v1",
  apis: [
    {
      service: "sample_orders",
      version: "1.0",
      method: "find",
      name: "查询订单（请替换示例）",
      category: "订单",
      owner: "请填写负责人",
      scopeCodes: [],
      description: "请核对权限组、内部地址与真实响应。",
      requestSchema: {
        type: "OBJECT",
        properties: { orderId: { type: "STRING", required: true } },
      },
      responseSchema: {
        type: "OBJECT",
        properties: { orderId: { type: "STRING" } },
      },
      errorDefinitions: [],
      binding: {
        protocol: "HTTP",
        timeoutMillis: 3000,
        http: { url: "https://provider.example/orders", method: "POST" },
      },
      mappings: [{ target: "orderId", source: "REQUEST", path: "orderId" }],
    },
  ],
};

/** 导入 API（/apis/import）：选择来源 → 逐项补齐候选 → 核对差异并批量写入草稿。 */
export default function ApiOnboarding({
  api,
  onReturn,
  onManual,
  onOpen,
  operatorKey,
  initialKind = "OPENAPI",
}: {
  initialKind?: SourceKind;
  api: AdminApi;
  onReturn: () => void;
  /** 改用其他新建方式（来源面板：cURL、Dubbo 签名、复制已有、从零新建）。 */
  onManual: () => void;
  onOpen: (id: string) => void;
  operatorKey?: string;
}) {
  const navigation = useAdminNavigation(),
    releaseGuard = useRef<(() => void) | null>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<SourceKind>(initialKind),
    [text, setText] = useState("");
  const [source, setSource] = useState<{
    kind: SourceKind;
    digest: string;
  } | null>(null);
  const [items, setItems] = useState<Candidate[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [editing, setEditing] = useState<string | null>(null),
    [batch, setBatch] = useState<string | null>(null);
  const [batchKeys, setBatchKeys] = useState<string[]>([]);
  const [returnedBatch, setReturnedBatch] = useState<string | null>(null);
  const [defaults, setDefaults] = useState({
    service: "",
    version: "1.0",
    category: "",
    owner: "",
  });
  const [completed, setCompleted] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(1);
  const [recovering, setRecovering] = useState(() => {
    try {
      return readPendingImport(operatorKey) !== null;
    } catch {
      return true;
    }
  });
  const active = useRef(0);
  useEffect(
    () => () => {
      active.current++;
    },
    [],
  );
  function replaceSource(value: string, nextKind = kind) {
    setText(value);
    setKind(nextKind);
    setSource(null);
    setItems([]);
    setSelected([]);
    setError("");
    setPage(1);
    setDefaults({ service: "", version: "1.0", category: "", owner: "" });
    setReturnedBatch(null);
  }
  function openCandidate(item: Candidate) {
    releaseGuard.current?.();
    navigation.navigate(
      { ...navigation.route, apiId: "new", step: "outer" },
      true,
    );
    setEditing(item.key);
  }
  function reviewBatch(candidates: Candidate[]) {
    setBatchKeys(candidates.map((item) => item.key));
    setBatch(
      `{"format":"cyl-openplatform.catalog/v1","apis":[${candidates.map((item) => item.prepared).join(",")}]}`,
    );
  }
  async function parse() {
    if (busy) return;
    setBusy(true);
    setError("");
    const context = active.current;
    try {
      const bytes = new TextEncoder().encode(text);
      if (!bytes.length || bytes.length > maxBytes)
        throw new Error("请提供不超过 256 KiB 的来源文本。");
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      if (context !== active.current) return;
      if (kind === "PLATFORM") {
        parseJson(text);
        setSource({ kind, digest });
        setBatch(text);
        return;
      }
      let candidates: Candidate[];
      if (kind === "OPENAPI") {
        const parsed = await api<{ sourceDigest: string; items: Candidate[] }>(
          "/api-imports/sources/openapi",
          { method: "POST", bodyText: text },
        );
        if (context !== active.current) return;
        candidates = parsed.items;
        setSource({ kind, digest: parsed.sourceDigest });
      } else {
        const parsed = parseHttpRequestSource(text),
          http = (
            parsed.definition.binding as {
              http: { method: string; url: string };
            }
          ).http;
        candidates = [
          {
            key: "request",
            label: `${http.method} ${httpTargetLabel(http)}`,
            ...parsed,
            blockers: [],
          },
        ];
        setSource({ kind, digest });
      }
      setItems(candidates);
      setSelected([]);
      setPage(1);
      if (candidates.length === 1) openCandidate(candidates[0]);
    } catch (failure) {
      if (context === active.current) setError((failure as Error).message);
    } finally {
      if (context === active.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (editing || batch || recovering) return;
    const release = navigation.registerDraft({
      page: navigation.route.page === "imports" ? "imports" : "catalog",
      apiId: navigation.route.apiId ?? "import",
      dirty: () => Boolean(text || items.length || returnedBatch),
      busy: () => busy,
      save: async () => false,
    });
    releaseGuard.current = release;
    return release;
  }, [
    editing,
    batch,
    recovering,
    text,
    items.length,
    returnedBatch,
    busy,
    navigation.registerDraft,
    navigation.route.apiId,
    navigation.route.page,
  ]);
  const candidate = items.find((item) => item.key === editing);
  if (candidate)
    return (
      <CandidateEditor
        key={candidate.key}
        api={api}
        initial={candidate.prepared ? parseJson(candidate.prepared) : (candidate.definition ?? {})}
        title={candidate.label}
        description={
          <>
            来源：{sourceNames[kind]} · 仅补齐候选，尚未写入
            {!candidate.prepared && `。来源缺项 / 核对提醒：${missingFields(candidate)}；当前填写结果以校验为准。`}
          </>
        }
        reminders={[...candidate.blockers, ...candidate.warnings]}
        backLabel="返回候选列表"
        onCancel={() => {
          if (window.confirm("放弃本次未确认的编辑并返回候选列表？")) setEditing(null);
        }}
        onPrepared={(bodyText) => {
          setItems((current) =>
            current.map((item) =>
              item.key === candidate.key ? { ...item, prepared: bodyText } : item,
            ),
          );
          setSelected((current) =>
            current.includes(candidate.key)
              ? current
              : current.length < 20
                ? [...current, candidate.key]
                : current,
          );
          setEditing(null);
          if (items.length === 1) reviewBatch([{ ...candidate, prepared: bodyText }]);
        }}
      />
    );
  if (recovering || (batch && source))
    return (
      <ApiImport
        api={api}
        key={operatorKey}
        operatorKey={operatorKey}
        initialDocument={batch ?? ""}
        preparedBatch={source?.kind !== "PLATFORM"}
        returnLabel={
          source?.kind === "PLATFORM" ? "返回来源资料" : "返回候选列表"
        }
        source={source ?? undefined}
        onOpen={onOpen}
        onCommitted={(ids) => {
          setCompleted((current) => [...new Set([...current, ...ids])]);
          setSelected([]);
        }}
        onReturn={(draft) => {
          if (draft?.source && !source) setSource(draft.source);
          if (
            draft?.document &&
            (source?.kind ?? draft.source?.kind) === "PLATFORM"
          ) {
            setText(draft.document);
            setKind("PLATFORM");
          } else if (draft?.document) {
            try {
              const parsed = parseJson<{ apis?: unknown[] }>(draft.document);
              if (
                draft.canEditCandidates &&
                Array.isArray(parsed.apis) &&
                parsed.apis.length === batchKeys.length
              ) {
                const prepared = new Map(
                  batchKeys.map((key, index) => [
                    key,
                    stringifyJson(parsed.apis![index]),
                  ]),
                );
                setItems((current) =>
                  current.map((item) =>
                    prepared.has(item.key)
                      ? { ...item, prepared: prepared.get(item.key) }
                      : item,
                  ),
                );
              } else if (!draft.committed) setReturnedBatch(draft.document);
            } catch {
              setReturnedBatch(draft.document);
            }
          }
          setBatch(null);
          setRecovering(false);
        }}
      />
    );
  const mayLeave = () =>
    (!text && !items.length && returnedBatch === null) || window.confirm("放弃当前来源及未导入候选？");
  const leave = (action: () => void) => {
    if (busy || !mayLeave()) return;
    releaseGuard.current?.();
    action();
  };
  const header = (
    <PageHeader
      breadcrumb={
        <>
          <a href="#/apis" onClick={(event) => { event.preventDefault(); leave(onReturn); }}>
            API 列表
          </a>{" "}
          / 导入
        </>
      }
      title="导入 API"
      meta={<span className="op-muted">选择来源 → 补齐候选 → 核对并写入草稿；只写入草稿，不会发布。</span>}
      secondaryActions={
        <Button disabled={busy} onClick={() => leave(onManual)}>
          改用其他新建方式
        </Button>
      }
    />
  );
  if (returnedBatch !== null)
    return (
      <section className="op-import" aria-labelledby="import-returned-title">
        {header}
        <div className="op-import__card">
          <h2 id="import-returned-title" className="op-import__title">本批修改已保留</h2>
          <p className="op-muted">本批 JSON 尚未完成，或条目范围已调整。继续核对可恢复完整输入；原候选仍保留。</p>
          <div className="op-import__row">
            <Button
              type="primary"
              onClick={() => {
                setBatch(returnedBatch);
                setReturnedBatch(null);
              }}
            >
              继续核对本批
            </Button>
            <Button
              onClick={() => {
                if (window.confirm("放弃本批JSON修改，返回原候选？")) setReturnedBatch(null);
              }}
            >
              放弃本批修改，返回原候选
            </Button>
          </div>
        </div>
      </section>
    );
  const selectedItems = items.filter((item) => selected.includes(item.key) && item.prepared);
  return (
    <section className="op-import" aria-label="导入 API">
      {header}
      {!items.length ? (
        <div className="op-import__card" aria-label="来源资料" role="group">
          <Form layout="vertical" component={false}>
            <Form.Item label="资料来源" extra={`${sourceScopes[kind]} 每份来源最多 256 KiB。`}>
              <Radio.Group
                aria-label="资料来源"
                optionType="button"
                disabled={busy}
                value={kind}
                onChange={(event) => {
                  if (!text || window.confirm("切换资料类型并清空当前文本？")) replaceSource("", event.target.value as SourceKind);
                }}
                options={Object.entries(sourceNames).map(([value, label]) => ({ value, label }))}
              />
            </Form.Item>
            <Form.Item
              label="来源文本"
              htmlFor="import-source-text"
              required
            >
              <div className="op-import__toolbar">
                <input
                  ref={fileInput}
                  type="file"
                  className="op-visually-hidden"
                  aria-label="上传来源文件"
                  tabIndex={-1}
                  accept={kind === "HTTP" ? ".txt,.http" : ".json,application/json"}
                  disabled={busy}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    if (file.size > maxBytes) {
                      setError("文件超过 256 KiB，请拆小文件。");
                      return;
                    }
                    setBusy(true);
                    const context = active.current;
                    try {
                      const value = await file.text();
                      if (context === active.current) replaceSource(value);
                    } catch {
                      if (context === active.current) setError("读取失败，请重新选择。");
                    } finally {
                      if (context === active.current) setBusy(false);
                    }
                  }}
                />
                <Button size="small" icon={<UploadOutlined aria-hidden />} disabled={busy} onClick={() => fileInput.current?.click()}>
                  上传文件
                </Button>
                {kind === "PLATFORM" && (
                  <Button size="small" type="link" onClick={() => replaceSource(stringifyJson(sample, 2))}>
                    填入脱敏格式示例
                  </Button>
                )}
              </div>
              <Input.TextArea
                id="import-source-text"
                aria-label="来源文本"
                className="op-import__code"
                value={text}
                autoSize={{ minRows: 10, maxRows: 24 }}
                disabled={busy}
                spellCheck={false}
                placeholder={
                  kind === "HTTP"
                    ? `curl https://provider.example/orders -X POST -H 'Content-Type: application/json' -d '{"orderId":"demo"}'`
                    : "粘贴 JSON，或上传文件"
                }
                onChange={(event) => replaceSource(event.target.value)}
              />
            </Form.Item>
          </Form>
          <StickyActionBar status={<span className="op-muted">仅解析候选，不会创建 API 或发起提供方调用。</span>}>
            <Button
              type="primary"
              loading={busy}
              disabled={busy || !text.trim()}
              onClick={() => void parse()}
            >
              解析来源，选择接口
            </Button>
          </StickyActionBar>
        </div>
      ) : (
        <div className="op-import__card" aria-label="接口候选" role="group">
          <div className="op-import__heading">
            <h2 className="op-import__title">接口候选 · {items.length} 项</h2>
            <Button
              onClick={() => {
                if (mayLeave()) replaceSource(text);
              }}
            >
              更换来源资料
            </Button>
          </div>
          {items.length > 1 && (
            <details className="op-import__details">
              <summary>批量补充共用信息</summary>
              <p className="op-muted">
                补入未确认候选的空字段，并替换尚未关联人员 ID 的旧负责人名称；接口内容仍逐项核对。
              </p>
              <div className="op-import__defaults">
                {(
                  [
                    ["service", "共用服务标识"],
                    ["version", "共用外部版本"],
                    ["category", "共用分类"],
                    ["owner", "共用负责人"],
                  ] as const
                ).map(([key, label]) =>
                  key === "category" ? (
                    <CategoryPicker key={key} api={api} label={label} value={defaults.category} onChange={(value) => setDefaults((current) => ({ ...current, category: value }))} />
                  ) : key === "owner" ? (
                    <OwnerPicker key={key} api={api} label={label} value={defaults.owner} onChange={(value) => setDefaults((current) => ({ ...current, owner: value }))} />
                  ) : (
                    <label key={key} className="op-import__field">
                      <span>{label}</span>
                      <Input
                        aria-label={label}
                        value={defaults[key]}
                        maxLength={key === "service" ? 64 : 32}
                        onChange={(event) => setDefaults((current) => ({ ...current, [key]: event.target.value }))}
                      />
                    </label>
                  ),
                )}
                <Button
                  onClick={() =>
                    setItems((current) =>
                      current.map((item) => {
                        if (item.prepared || !item.definition) return item;
                        const next = { ...item.definition };
                        for (const key of ["service", "version", "category", "owner"] as const)
                          if ((!next[key]?.trim() || (key === "owner" && !isOwnerReference(next.owner || ""))) && defaults[key].trim())
                            next[key] = defaults[key].trim();
                        return { ...item, definition: next };
                      }),
                    )
                  }
                >
                  补入共用信息
                </Button>
              </div>
            </details>
          )}
          <Table<Candidate>
            size="small"
            rowKey="key"
            dataSource={items}
            pagination={items.length > 20 ? { current: page, pageSize: 20, onChange: setPage, showSizeChanger: false } : false}
            columns={[
              {
                title: "选择",
                width: 68,
                render: (_, item) => (
                  <Checkbox
                    aria-label={`选择 ${item.label}`}
                    disabled={!item.prepared || (!selected.includes(item.key) && selected.length >= 20)}
                    checked={selected.includes(item.key)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked ? [...current, item.key] : current.filter((key) => key !== item.key),
                      )
                    }
                  />
                ),
              },
              {
                title: "来源接口 / 当前状态",
                render: (_, item) => (
                  <div className="op-import__cell">
                    <strong>{item.label}</strong>
                    <StatusBadge tone={item.prepared ? "success" : "neutral"}>{item.prepared ? "已核对，待批次校验" : "待补齐"}</StatusBadge>
                  </div>
                ),
              },
              {
                title: "待补齐 / 来源提醒",
                render: (_, item) => (
                  <div className="op-import__cell">
                    {!item.prepared && <span>{missingFields(item)}</span>}
                    {!!(item.blockers.length + item.warnings.length) && (
                      <details className="op-import__details" open={item.blockers.length > 0}>
                        <summary>{item.blockers.length + item.warnings.length} 条来源提醒</summary>
                        <ul className="op-import__list">
                          {[...item.blockers, ...item.warnings].map((reminder, index) => (
                            <li key={index}>{reminder}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                ),
              },
              {
                title: "操作",
                width: 120,
                render: (_, item) => (
                  <Button type="link" size="small" onClick={() => openCandidate(item)}>
                    {item.prepared ? "修改候选" : "补齐配置"}
                  </Button>
                ),
              },
            ]}
          />
          <StickyActionBar
            status={
              <span>
                已选择 {selectedItems.length} / 20 <span className="op-muted">· 确认候选后自动加入本批；已有 API 的覆盖在差异页单独选择。</span>
              </span>
            }
          >
            <Button type="primary" disabled={!selectedItems.length} onClick={() => reviewBatch(selectedItems)}>
              核对本批差异（{selectedItems.length} / 20）
            </Button>
          </StickyActionBar>
        </div>
      )}
      <ErrorFeedback error={error} />
      {!!completed.length && (
        <div className="op-import__card" role="group" aria-label="本次已写入">
          <h2 className="op-import__title">本次已写入 {completed.length} 个 API</h2>
          <div className="op-import__row">
            {completed.map((id, index) => (
              <Button key={id} onClick={() => onOpen(id)}>
                打开第 {index + 1} 个已完成 API
              </Button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
