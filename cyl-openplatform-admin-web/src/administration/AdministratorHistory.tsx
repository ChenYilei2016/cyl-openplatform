import { EmptyState, PersonTag, TenantTag } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, type DataTableColumn } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Button } from "antd";
import { useState } from "react";
import type { AdminApi } from "../access/api";
import { permissionText, roleText } from "./administratorModel";
import { administratorActionNames, permissionNames, type Administrator, type AdministratorAudit } from "./types";

const formatTime = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });

function changes(item: AdministratorAudit) {
  const before = item.before,
    after = item.after;
  if (!after) return "无变更后记录";
  return (
    [
      before ? (before.enabled !== after.enabled ? (after.enabled ? "启用资格" : "停用资格") : "") : "新增资格",
      !before || before.superAdministrator !== after.superAdministrator ? (after.superAdministrator ? "设为总管理员" : "普通管理员") : "",
      ...after.permissions.filter((code) => !before?.permissions.includes(code)).map((code) => `增加 ${permissionNames[code] ?? code}`),
      ...(before?.permissions ?? []).filter((code) => !after.permissions.includes(code)).map((code) => `移除 ${permissionNames[code] ?? code}`),
    ]
      .filter(Boolean)
      .join("；") || "资格与业务权限未变化"
  );
}

function Snapshot({ label, value }: { label: string; value: Administrator | null }) {
  return (
    <section className="administrator-snapshot">
      <strong>{label}</strong>
      {value ? (
        <>
          <p>
            {value.enabled ? "启用" : "停用"} · {roleText(value.superAdministrator)} · 修订 {value.revision}
          </p>
          <p>{permissionText(value.permissions)}</p>
        </>
      ) : (
        <p>无记录</p>
      )}
    </section>
  );
}

/** 管理员授权变更记录：抽屉“变更记录”页（单人）或全部记录；可展开前后快照。 */
export default function AdministratorHistory({ api, administratorId, canRead }: { api: AdminApi; administratorId?: string | null; canRead: boolean }) {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const query = new URLSearchParams({ page: String(page), pageSize: "20" });
  if (administratorId) query.set("administratorId", administratorId);
  const history = useReadPage<AdministratorAudit>(api, `/administrators/audit?${query}`, 0, canRead, { keepPrevious: true });
  const columns: DataTableColumn<AdministratorAudit>[] = [
    {
      key: "time",
      title: "时间 / 操作",
      width: 176,
      hideable: false,
      render: (item) => (
        <span className="op-cell-main">
          <span>{formatTime(item.occurredAt)}</span>
          <span className="op-cell-sub">{administratorActionNames[item.action] ?? item.action}</span>
        </span>
      ),
    },
    {
      key: "operator",
      title: "操作人",
      width: 150,
      render: (item) => (
        <span className="op-cell-main">
          <PersonTag employeeNo={item.operatorEmployeeNo} />
          <span className="op-cell-sub">
            <TenantTag id={item.operatorTenantId} />
          </span>
        </span>
      ),
    },
    ...(administratorId
      ? []
      : [
          {
            key: "target",
            title: "目标",
            width: 140,
            render: (item: AdministratorAudit) => item.after?.displayName ?? item.before?.displayName ?? item.administratorId,
          },
        ]),
    {
      key: "change",
      title: "原因 / 权限变化",
      render: (item) => (
        <div className="administrator-history-change">
          <span>{item.reason}</span>
          <span className="op-cell-sub">{changes(item)}</span>
          <Button type="link" size="small" className="administrator-history-toggle" onClick={() => setExpanded(expanded === item.id ? null : item.id)}>
            {expanded === item.id ? "收起快照" : "查看前后快照"}
            <span className="sr-only"> {item.id}</span>
          </Button>
          {expanded === item.id && (
            <div className="administrator-snapshots">
              <Snapshot label="变更前" value={item.before} />
              <Snapshot label="变更后" value={item.after} />
            </div>
          )}
        </div>
      ),
    },
  ];
  return (
    <DataTable<AdministratorAudit>
      caption="管理员授权变更记录"
      rowKey={(item) => item.id}
      columns={columns}
      data={history.error ? [] : (history.data?.items ?? [])}
      loading={history.loading}
      pagination={
        history.data
          ? {
              page,
              pageSize: 20,
              total: history.data.total,
              onChange: (next) => {
                setExpanded(null);
                setPage(next);
              },
            }
          : undefined
      }
      empty={
        history.error ? (
          <EmptyState kind="error" title="变更记录加载失败" description={history.error} action={<Button onClick={history.reload}>重新加载</Button>} />
        ) : (
          <EmptyState title="暂无授权变更记录" />
        )
      }
      summary={history.data ? `共 ${history.data.total} 条` : undefined}
    />
  );
}
