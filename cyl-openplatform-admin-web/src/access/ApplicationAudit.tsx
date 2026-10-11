import { ReloadOutlined } from "@ant-design/icons";
import { IdText, PersonTag, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Alert, Button, Tooltip } from "antd";
import { useState } from "react";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { observationRoute } from "../observability/links";
import type { AdminApi, Audit } from "./api";

const time = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * 凭据“操作记录”：本页列出凭据与授权的变更（访问管理审计）。Token 签发/撤销、签名密钥等其他来源的记录在管理审计中，
 * 有审计查看权限时可一键带上本凭据条件打开。
 */
export default function ApplicationAudit({ api, applicationId, canReadAudits = false }: { api: AdminApi; applicationId: string; canReadAudits?: boolean }) {
  const navigation = useAdminNavigation();
  const [page, setPage] = useState(1);
  const list = useReadPage<Audit>(api, `/applications/${encodeURIComponent(applicationId)}/audit?page=${page}&pageSize=20`, 0, true, { keepPrevious: true });
  return (
    <section className="credential-audit" aria-label="凭据操作记录">
      <div className="credential-audit__head">
        <span className="op-muted">凭据与授权的变更。Token 签发与撤销、签名密钥等其他记录在管理审计中查看。</span>
        <span className="credential-audit__actions">
          <Tooltip title={canReadAudits ? undefined : "需要审计查看权限（VIEW_AUDIT）"}>
            <Button size="small" disabled={!canReadAudits} onClick={() => navigation.navigate(observationRoute("audits", { applicationId }, navigation.route))}>
              在管理审计中查看全部
            </Button>
          </Tooltip>
          <Tooltip title="刷新">
            <Button size="small" icon={<ReloadOutlined aria-hidden />} aria-label="刷新操作记录" disabled={list.loading} onClick={list.reload} />
          </Tooltip>
        </span>
      </div>
      {list.error && <Alert type="error" showIcon title={list.error} action={<Button size="small" onClick={list.reload}>重试</Button>} />}
      <DataTable<Audit>
        caption="凭据操作记录"
        rowKey={(item) => item.id}
        loading={list.loading}
        data={list.data?.items ?? []}
        empty="暂无凭据变更记录"
        pagination={list.data && list.data.total > 20 ? { page, pageSize: 20, total: list.data.total, onChange: setPage, pageSizeOptions: [20] } : undefined}
        columns={[
          { key: "time", title: "时间", width: 120, hideable: false, render: (item) => <time dateTime={item.occurredAt}>{time(item.occurredAt)}</time> },
          {
            key: "action",
            title: "操作",
            render: (item) => (
              <span className="credential-audit__action">
                {item.action}
                <StatusBadge tone={item.outcome === "SUCCESS" ? "success" : "error"}>{item.outcome === "SUCCESS" ? "成功" : item.outcome === "FAILURE" ? "失败" : item.outcome}</StatusBadge>
              </span>
            ),
          },
          { key: "operator", title: "操作人", render: (item) => <PersonTag employeeNo={item.operatorEmployeeNo} stacked /> },
          {
            key: "summary",
            title: "说明",
            render: (item) => (
              <span className="credential-audit__summary">
                <span>{item.summary}</span>
                {item.targetEmployeeNo && <span className="op-muted">目标工号 {item.targetEmployeeNo}（由操作人代办）</span>}
              </span>
            ),
          },
          { key: "request", title: "请求号", width: 210, render: (item) => <IdText value={item.requestId} label="请求号" maxChars={24} /> },
        ]}
      />
    </section>
  );
}
