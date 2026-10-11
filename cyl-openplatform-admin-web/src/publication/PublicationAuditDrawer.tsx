import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { EntityDrawer, IdText, PersonTag, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Alert, Button } from "antd";
import { useState } from "react";
import type { AdminApi } from "../access/api";
import { publicationDisplay } from "./publicationDisplay";
import type { EffectiveRelease, PublicationAudit, PublicationState } from "./types";

const actionNames: Record<string, string> = {
  SUBMIT: "提交发布",
  APPROVE: "审核通过",
  REJECT: "驳回",
  ROLLBACK: "回滚发布",
  ENABLE: "启用",
  DISABLE: "停用",
};

/** 发布操作明细：按时间倒序的发布审计（操作人显示姓名）以及当前状态指针、生效快照原文。 */
export default function PublicationAuditDrawer({
  open,
  api,
  apiId,
  state,
  effective,
  onClose,
}: {
  open: boolean;
  api: AdminApi;
  apiId: string;
  state: PublicationState | null;
  effective: EffectiveRelease | null;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const audits = useReadPage<PublicationAudit>(api, `/publications/apis/${encodeURIComponent(apiId)}/audit?page=${page}&pageSize=20`, 0, open);
  return (
    <EntityDrawer open={open} width="lg" title="发布操作明细" subtitle="提交、审核、回滚与启停的操作记录" onClose={onClose}>
      {audits.error && <Alert type="error" showIcon title={audits.error} action={<Button size="small" onClick={audits.reload}>重试</Button>} />}
      <DataTable<PublicationAudit>
        rowKey={(item) => item.id}
        loading={audits.loading}
        data={audits.data?.items ?? []}
        empty="暂无发布操作记录"
        caption="发布操作审计"
        pagination={audits.data ? { page, pageSize: 20, total: audits.data.total, onChange: setPage, pageSizeOptions: [20] } : undefined}
        columns={[
          {
            key: "action",
            title: "操作",
            hideable: false,
            render: (item) => (
              <span className="op-publish__audit-action">
                {actionNames[item.action] ?? item.action}
                <StatusBadge tone={item.outcome === "SUCCESS" ? "success" : "error"}>{item.outcome === "SUCCESS" ? "成功" : "失败"}</StatusBadge>
              </span>
            ),
          },
          { key: "operator", title: "操作人", render: (item) => <PersonTag name={item.operatorName} employeeNo={item.operatorEmployeeNo} stacked /> },
          { key: "summary", title: "说明", render: (item) => item.summary || "—" },
          { key: "time", title: "时间", width: 168, render: (item) => <time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString()}</time> },
          { key: "request", title: "请求号", width: 150, defaultHidden: true, render: (item) => <IdText value={item.requestId} label="请求号" maxChars={14} /> },
        ]}
      />
      {state && (
        <details className="op-publish__raw">
          <summary>状态指针与生效快照原文</summary>
          <p className="op-muted">
            状态版本 {stringifyJson(state.stateVersion)} · 生效记录 {state.liveReleaseId ?? "无"} · 待审记录 {state.pendingReleaseId ?? "无"}
          </p>
          {effective && <pre className="op-publish__json">{stringifyJson(publicationDisplay(effective.snapshot), 2)}</pre>}
        </details>
      )}
    </EntityDrawer>
  );
}
