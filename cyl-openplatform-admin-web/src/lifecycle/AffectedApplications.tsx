import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import type { ApiLifecycle } from "@cyl/open-platform-web-shared/lifecycle";
import { IdText, StatusBadge, TenantTag } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, useDebouncedCallback } from "@cyl/open-platform-web-shared/ui/list";
import { Alert, Button, Input, Segmented } from "antd";
import { useEffect, useState } from "react";
import type { AdminApi, Page } from "../access/api";

interface AffectedApplication {
  applicationId: string;
  name: string;
  ownerTenantId: string;
  status: "ENABLED" | "DISABLED";
  matchedScopeCodes: string[];
  activeTenantGrantCount: number;
}
interface AffectedApplicationsResult {
  apiId: string;
  basis: "EFFECTIVE" | "DRAFT";
  draftRevision: number;
  releaseId: string | null;
  lifecycle: ApiLifecycle;
  enabled: boolean;
  evaluatedAt: string;
  applications: Page<AffectedApplication>;
}
type Basis = "EFFECTIVE" | "DRAFT";

/** 浏览上限：超出时提示用搜索缩小范围。 */
const MAX_BROWSE = 100020;

/**
 * 可能受影响的接入方：按 API 任一启用权限组匹配的凭据（含停用凭据与零有效租户授权的凭据）。
 * 这不是实际调用名单，也不表示持有有效 Token；翻页固定同一修订，契约变化后从第一页重新查询。
 */
export default function AffectedApplications({ api, apiId, defaultBasis = "EFFECTIVE" }: { api: AdminApi; apiId: string; defaultBasis?: Basis }) {
  const [request, setRequest] = useState<{ basis: Basis; page: number; query: string; expectedRevision?: number }>({ basis: defaultBasis, page: 1, query: "" });
  const [query, setQuery] = useState("");
  const [data, setData] = useState<AffectedApplicationsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const search = useDebouncedCallback((value: string) => setRequest((current) => ({ basis: current.basis, page: 1, query: value.trim() })));
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ basis: request.basis, page: String(request.page), pageSize: "20", query: request.query });
    if (request.expectedRevision !== undefined) params.set("expectedRevision", stringifyJson(request.expectedRevision));
    setLoading(true);
    setError("");
    void api<AffectedApplicationsResult>(`/apis/${encodeURIComponent(apiId)}/affected-applications?${params}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setData(null);
          setError((failure as Error).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, apiId, request, retry]);
  return (
    <section className="op-affected" aria-label="可能受影响的接入方">
      <div className="op-affected__toolbar">
        <Segmented<Basis>
          aria-label="查询依据"
          value={request.basis}
          options={[
            { value: "EFFECTIVE", label: "按当前生效版本" },
            { value: "DRAFT", label: "按已保存草稿" },
          ]}
          onChange={(basis) => setRequest({ basis, page: 1, query: request.query })}
        />
        <Input.Search
          allowClear
          aria-label="搜索凭据名称"
          placeholder="搜索凭据名称"
          maxLength={100}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            search.run(event.target.value);
          }}
          className="op-affected__search"
        />
      </div>
      <p className="op-muted op-affected__note">
        按 API 任一启用权限组匹配，包含已停用凭据和零有效租户授权的凭据；这不是实际调用名单。尚未发布的 API 请切换到“按已保存草稿”。
        {data && ` · ${data.basis === "EFFECTIVE" ? "生效" : "草稿"}修订 r${stringifyJson(data.draftRevision)} · 查询于 ${new Date(data.evaluatedAt).toLocaleString()}`}
      </p>
      {error && <Alert type="error" showIcon title={error} action={<Button size="small" onClick={() => setRetry((value) => value + 1)}>重试</Button>} />}
      <DataTable<AffectedApplication>
        rowKey={(item) => item.applicationId}
        loading={loading}
        data={data?.applications.items ?? []}
        caption="可能受影响的接入方"
        empty="没有符合授权覆盖条件的接入凭据"
        pagination={
          data
            ? {
                page: request.page,
                pageSize: 20,
                total: Math.min(data.applications.total, MAX_BROWSE),
                pageSizeOptions: [20],
                onChange: (page) => setRequest((current) => ({ ...current, page, expectedRevision: data.draftRevision })),
              }
            : undefined
        }
        columns={[
          {
            key: "name",
            title: "接入凭据",
            hideable: false,
            render: (item) => (
              <span className="op-affected__name">
                <span>{item.name}</span>
                <IdText value={item.applicationId} label="凭据 ID" maxChars={18} />
              </span>
            ),
          },
          { key: "tenant", title: "所属租户", render: (item) => <TenantTag id={item.ownerTenantId} /> },
          { key: "status", title: "状态", width: 96, render: (item) => <StatusBadge tone={item.status === "ENABLED" ? "success" : "neutral"}>{item.status === "ENABLED" ? "已启用" : "已停用"}</StatusBadge> },
          { key: "scopes", title: "匹配权限组", render: (item) => item.matchedScopeCodes.join("、") },
          { key: "grants", title: "有效租户授权", width: 112, align: "right", render: (item) => stringifyJson(item.activeTenantGrantCount) },
        ]}
      />
      {data && data.applications.total > MAX_BROWSE && <p className="op-muted">共 {data.applications.total} 个候选，最多浏览前 {MAX_BROWSE} 条，请用搜索缩小范围。</p>}
    </section>
  );
}
