import { Alert, Button, Descriptions, Popover, Table, Tag, Typography } from "antd";
import type { ReactNode } from "react";
import type { AdminApi } from "../access/api";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { LoadFeedback } from "@cyl/open-platform-web-shared/components";
import { EmptyState, EntityDrawer, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { observationRoute } from "./links";
import {
  actorNames,
  auditActions,
  modeNames,
  reasonNames,
  sourceNames,
  timeText,
  type CallRecord,
  type ManagementAudit,
  type ObservationRecord,
  type ObservationView,
} from "./model";
import { permitted, targetNames, type TargetType } from "../governance/model";

export function CopyValue({ value }: { value: string | null | undefined }) {
  return value ? (
    <Typography.Text copyable={{ text: value }} className="observation-id">
      {value}
    </Typography.Text>
  ) : (
    <span className="observation-muted">未记录</span>
  );
}

/** 调用结论文案：业务失败（平台 2xx 而提供方返回错误码）与调用失败分开，不只看 HTTP 状态。 */
export function callConclusion(record: Pick<CallRecord, "outcome" | "httpStatus">) {
  if (record.outcome === "SUCCESS") return { tone: "success" as const, label: "调用成功" };
  if (record.outcome === "FAILURE")
    return { tone: "error" as const, label: record.httpStatus >= 200 && record.httpStatus < 300 ? "业务失败" : "调用失败" };
  return { tone: "neutral" as const, label: record.outcome };
}

/** 错误码与 HTTP 状态并列时等宽显示。 */
export function callCodes(record: Pick<CallRecord, "errorCode" | "httpStatus">) {
  return record.errorCode != null ? `${record.errorCode} · HTTP ${record.httpStatus}` : `HTTP ${record.httpStatus}`;
}

export function auditOutcome(value: string) {
  return value === "SUCCESS"
    ? { tone: "success" as const, label: "成功" }
    : value === "FAILURE"
      ? { tone: "error" as const, label: "失败" }
      : { tone: "neutral" as const, label: value || "未知" };
}

/** 原因：先给治理拒绝，再按平台响应解释失败方向；只基于元数据，不推断提供方正文。 */
function callReason(call: CallRecord) {
  if (call.governance && !call.governance.allowed)
    return `被限流与访问控制拒绝：${reasonNames[call.governance.denialReason] ?? call.governance.denialReason}${call.governance.retryAfterSeconds > 0 ? `，建议 ${call.governance.retryAfterSeconds} 秒后重试` : ""}。`;
  if (call.outcome !== "FAILURE") return "";
  if (call.httpStatus >= 200 && call.httpStatus < 300)
    return `平台已转发，提供方返回业务错误${call.errorCode != null ? `（错误码 ${call.errorCode}）` : ""}；请按请求号查看提供方运行日志。`;
  if (call.httpStatus === 401 || call.httpStatus === 403) return "身份或授权校验未通过：检查凭据状态、Token 与调用权限。";
  if (call.httpStatus === 404) return "未匹配到可调用的 API：检查路径、外部版本与发布状态。";
  if (call.httpStatus === 429) return "请求被限流：查看下方治理命中与对应规则。";
  if (call.httpStatus >= 500) return "平台或提供方处理异常：按请求号排查网关与提供方日志。";
  return `请求未被接受（HTTP ${call.httpStatus}）：检查请求格式与参数。`;
}

function NamedId({ name, id }: { name?: string | null; id: string | null | undefined }) {
  if (!id) return <span className="observation-muted">未记录</span>;
  return name ? (
    <span className="observation-named">
      <span>{name}</span>
      <CopyValue value={id} />
    </span>
  ) : (
    <CopyValue value={id} />
  );
}

const leaveDetail = { observationId: null, observationSource: null, observationAt: null };

export default function ObservationDetail({
  api,
  view,
  entries,
  permissions,
  onOpenCredential,
  onSelect,
}: {
  api: AdminApi;
  view: ObservationView;
  entries: ObservationRecord[];
  permissions: string[];
  onOpenCredential?: (id: string) => void;
  onSelect: (entry: ObservationRecord) => void;
}) {
  const navigation = useAdminNavigation(),
    route = navigation.route,
    id = route.observationId,
    source = route.observationSource;
  const missingSource = view === "audits" && !source;
  const params = new URLSearchParams({ page: "1", pageSize: "1", id: id ?? "" });
  if (source && view === "audits") params.set("source", source);
  if (route.observationAt) {
    const at = Date.parse(route.observationAt);
    params.set("from", new Date(at - 1000).toISOString());
    params.set("to", new Date(at + 1000).toISOString());
  }
  const detail = useReadPage<ObservationRecord>(api, `/observability/${view}?${params}`, 0, Boolean(id) && !missingSource);
  const entry = detail.data?.items[0];
  const index = entries.findIndex((item) => item.id === id && (view === "calls" || ("source" in item && item.source === source)));
  const call = entry && "mode" in entry ? (entry as CallRecord) : null,
    audit = entry && "source" in entry ? (entry as ManagementAudit) : null;
  const close = () => navigation.navigate({ ...route, ...leaveDetail });
  const relation = (next: ObservationView) => {
    if (!entry) return;
    const time = Date.parse(entry.occurredAt);
    navigation.navigate(
      observationRoute(next, { requestId: entry.requestId, from: new Date(time - 60000).toISOString(), to: new Date(time + 60000).toISOString() }, route),
    );
  };
  const field = (label: string, value: ReactNode) => ({
    key: label,
    label,
    children: typeof value === "string" || value == null ? <CopyValue value={value as string | null} /> : value,
  });
  const canOpenApi = Boolean(entry?.apiId) && permissions.includes("MANAGE_APIS");
  const release = entry && {
    key: "release",
    label: (
      <span>
        {call ? "本次发布快照 ID" : "关联发布记录 ID"}{" "}
        <Popover
          trigger={["hover", "click"]}
          content="这是一次发布所保存的固定 API 配置记录ID，与外部版本、草稿修订号不同。调用记录指向当时使用的快照，不代表当前生效配置。"
        >
          <Button type="text" size="small" className="observation-help" aria-label="发布快照说明">
            ?
          </Button>
        </Popover>
      </span>
    ),
    children: (
      <>
        <CopyValue value={entry.releaseId} />
        {entry.releaseId && permissions.some((permission) => ["MANAGE_APIS", "PUBLISH_APIS", "REVIEW_APIS"].includes(permission)) && (
          <Button
            type="link"
            size="small"
            onClick={() => navigation.navigate({ ...route, page: "publications", apiId: null, releaseId: entry.releaseId, ...leaveDetail })}
          >
            查看发布快照
          </Button>
        )}
      </>
    ),
  };
  const links = entry && (entry.applicationId && onOpenCredential || canOpenApi) && (
    <div className="observation-inline">
      {entry.applicationId && onOpenCredential && <Button onClick={() => onOpenCredential(entry.applicationId!)}>查看凭据授权</Button>}
      {canOpenApi && (
        <Button onClick={() => navigation.navigate({ ...route, page: "catalog", apiId: entry.apiId, step: "outer", ...leaveDetail })}>打开当前 API 工作区</Button>
      )}
    </div>
  );
  const conclusion = call ? callConclusion(call) : audit ? auditOutcome(audit.outcome) : null;
  const reason = call ? callReason(call) : "";
  return (
    <EntityDrawer
      open={Boolean(id)}
      width="lg"
      title={view === "calls" ? "调用详情" : "管理审计详情"}
      status={conclusion && <StatusBadge tone={conclusion.tone}>{conclusion.label}</StatusBadge>}
      subtitle={
        call ? (
          <span className="observation-muted">{call.service && call.method ? `${call.service}.${call.method}` : "API 未识别"}</span>
        ) : audit ? (
          <span className="observation-muted">{auditActions[audit.action] ?? audit.action}</span>
        ) : undefined
      }
      actions={<Typography.Text copyable={{ text: window.location.href }}>复制详情链接</Typography.Text>}
      onClose={close}
      footer={
        <div className="observation-detail-footer">
          <span>{index >= 0 ? `本页第 ${index + 1} / ${entries.length} 条` : "详情链接定位"}</span>
          <Button
            aria-disabled={index <= 0 || detail.loading}
            onClick={() => {
              if (index > 0 && !detail.loading) onSelect(entries[index - 1]);
            }}
          >
            上一条
          </Button>
          <Button
            aria-disabled={index < 0 || index >= entries.length - 1 || detail.loading}
            onClick={() => {
              if (index >= 0 && index < entries.length - 1 && !detail.loading) onSelect(entries[index + 1]);
            }}
          >
            下一条
          </Button>
        </div>
      }
    >
      {missingSource && <Alert type="warning" title="审计详情链接缺少来源，请关闭后从列表选择记录。" />}
      <LoadFeedback {...detail} retry={detail.reload} />
      {detail.error && <p className="observation-muted">详情尚未读取成功；可重试或关闭，列表条件仍保留。</p>}
      {!missingSource && !detail.loading && !detail.error && !entry && (
        <EmptyState kind="noResult" title="没有找到这条记录" description="记录不存在、已过保留期或不在链接时间范围内。" />
      )}
      {entry && conclusion && (
        <>
          <section className="observation-conclusion" aria-label="结论">
            <div className="observation-conclusion__headline">
              <StatusBadge tone={conclusion.tone}>{call ? conclusion.label : `${auditActions[audit!.action] ?? audit!.action} · ${conclusion.label}`}</StatusBadge>
              {call && (
                <>
                  {call.errorCode != null && <span className="op-code">错误码 {call.errorCode}</span>}
                  <span className="op-code">平台响应 HTTP {call.httpStatus}</span>
                  <span className="op-code">{call.durationMillis} ms</span>
                  <span>{modeNames[call.mode]}</span>
                </>
              )}
              {audit && <span>{sourceNames[audit.source] ?? audit.source}</span>}
              <time className="observation-muted">{timeText(entry.occurredAt)}</time>
            </div>
            {reason && <p className="observation-reason">{reason}</p>}
            <div className="observation-inline">
              <span className="observation-muted">请求号</span>
              <CopyValue value={entry.requestId} />
              <Button size="small" onClick={() => relation(view === "calls" ? "audits" : "calls")}>
                {view === "calls" ? "同请求管理审计" : "同请求调用记录"}
              </Button>
              <Popover
                trigger={["hover", "click"]}
                content="这里仅记录调用与操作元数据；如需提供方返回摘要，请按请求号查询应用运行日志。管理请求与业务请求可能没有相同请求号的关联记录。"
              >
                <Button type="text" size="small" className="observation-help" aria-label="排查说明">
                  ?
                </Button>
              </Popover>
            </div>
          </section>
          {call && (
            <>
              <section className="observation-detail-section">
                <h3>调用身份</h3>
                <Descriptions
                  size="small"
                  column={{ xs: 1, sm: 2 }}
                  layout="vertical"
                  items={[
                    field("业务租户", <NamedId name={call.tenantName} id={call.tenantId} />),
                    field("调用人员", call.employeeName ? <span>{call.employeeName}</span> : <span className="observation-muted">{call.employeeNo ? "未登记档案" : call.applicationId ? "凭据自主调用" : "未识别"}</span>),
                    field("调用员工号", call.employeeNo),
                    field("调用员工 ID", call.employeeId),
                    field("业务账号 ID", call.userId),
                    field("接入凭据 ID", call.applicationId),
                    field("操作人租户 ID", call.operatorTenantId),
                    field("操作员工号", call.operatorEmployeeNo),
                  ]}
                />
                {call.applicationId && onOpenCredential && (
                  <div className="observation-inline">
                    <Button onClick={() => onOpenCredential(call.applicationId!)}>查看凭据授权</Button>
                  </div>
                )}
              </section>
              <section className="observation-detail-section">
                <h3>HTTP 来源与耗时</h3>
                <Descriptions
                  size="small"
                  column={{ xs: 1, sm: 3 }}
                  layout="vertical"
                  items={[
                    field("来源 IP", call.clientIp),
                    { key: "protocol", label: "协议", children: call.protocol ?? <span className="observation-muted">未记录</span> },
                    { key: "status", label: "平台响应", children: <span className="op-code">{callCodes(call)}</span> },
                    { key: "duration", label: "耗时", children: <span className="op-code">{call.durationMillis} ms</span> },
                    { key: "mode", label: "调用方式", children: modeNames[call.mode] ?? call.mode },
                    { key: "channel", label: "调用渠道", children: call.channel === "MCP" ? "MCP" : "普通API" },
                    ...(call.toolName ? [{ key: "toolName", label: "MCP工具名", children: <span className="op-code">{call.toolName}</span> }] : []),
                  ]}
                />
              </section>
              <section className="observation-detail-section">
                <h3>调用接口与版本</h3>
                <p className="observation-operation">
                  {call.service && call.method ? `${call.service}.${call.method} · 外部 ${call.version ?? "未记录"}` : "API 未识别"}
                  {call.protocol && <Tag>{call.protocol}</Tag>}
                </p>
                <Descriptions
                  size="small"
                  column={{ xs: 1, sm: 2 }}
                  layout="vertical"
                  items={[
                    field("API ID", call.apiId),
                    release!,
                    { key: "revision", label: "草稿修订", children: call.draftRevision == null ? "未记录" : `r${call.draftRevision}` },
                  ]}
                />
                {canOpenApi && (
                  <div className="observation-inline">
                    <Button onClick={() => navigation.navigate({ ...route, page: "catalog", apiId: call.apiId, step: "outer", ...leaveDetail })}>打开当前 API 工作区</Button>
                  </div>
                )}
              </section>
              <GovernanceHits call={call} permissions={permissions} />
            </>
          )}
          {audit && (
            <>
              <section className="observation-detail-section">
                <h3>操作人</h3>
                <Descriptions
                  size="small"
                  column={{ xs: 1, sm: 2 }}
                  layout="vertical"
                  items={[
                    field("姓名", audit.operatorName ? <span>{audit.operatorName}</span> : <span className="observation-muted">未登记</span>),
                    field("操作员工号", audit.operatorEmployeeNo),
                    field("操作人租户 ID", audit.operatorTenantId),
                    { key: "actor", label: "操作人类型", children: actorNames[audit.actorKind] ?? audit.actorKind ?? "未记录" },
                  ]}
                />
              </section>
              <section className="observation-detail-section">
                <h3>操作对象与事实</h3>
                <Descriptions
                  size="small"
                  column={{ xs: 1, sm: 2 }}
                  layout="vertical"
                  items={[
                    field("操作对象 ID", audit.targetId),
                    field("操作标识", audit.action),
                    field("API ID", audit.apiId),
                    field("接入凭据 ID", audit.applicationId),
                    field("业务租户", <NamedId name={audit.tenantName} id={audit.tenantId} />),
                    release!,
                    { key: "revision", label: "草稿修订", children: audit.draftRevision == null ? "未记录" : `r${audit.draftRevision}` },
                  ]}
                />
                {links}
              </section>
            </>
          )}
          <section className="observation-detail-section">
            <h3>记录标识</h3>
            <CopyValue value={entry.id} />
          </section>
        </>
      )}
    </EntityDrawer>
  );
}

/** 治理命中：可配置规则可跳到“限流与访问控制”中的当前规则；运行时内置限额没有规则记录，不提供跳转。 */
function GovernanceHits({ call, permissions }: { call: CallRecord; permissions: string[] }) {
  const navigation = useAdminNavigation(),
    route = navigation.route;
  return (
    <section className="observation-detail-section">
      <h3>治理命中</h3>
      {call.governance ? (
        <>
          <p>
            {call.governance.allowed ? "治理放行" : "治理拒绝"} · {reasonNames[call.governance.denialReason] ?? call.governance.denialReason}
            {call.governance.retryAfterSeconds > 0 && ` · 建议 ${call.governance.retryAfterSeconds} 秒后重试`}
          </p>
          {call.governance.hits.length ? (
            <Table
              size="small"
              rowKey={(hit) => hit.ruleId + ":" + hit.version}
              pagination={false}
              dataSource={call.governance.hits}
              columns={[
                {
                  title: "规则 / 来源",
                  render: (_, hit) => {
                    const builtIn = hit.ruleId.startsWith("DRAFT_DEBUG_LIMIT:");
                    return (
                      <div className="op-cell-main">
                        <strong>{builtIn ? "草稿调试内置限额" : `${targetNames[hit.targetType as TargetType] ?? hit.targetType} · v${hit.version}`}</strong>
                        {builtIn && <span className="op-cell-sub">平台内置 · 按 API 独立计数，无独立规则配置</span>}
                        <CopyValue value={hit.ruleId} />
                        {!builtIn &&
                          hit.targetType in targetNames &&
                          permitted(hit.targetType as TargetType, permissions) &&
                          permissions.some((p) => ["MANAGE_APPLICATIONS", "MANAGE_APIS"].includes(p)) && (
                            <Button
                              type="link"
                              size="small"
                              className="observation-link-start"
                              onClick={() => navigation.navigate({ ...route, page: "governance", apiId: null, governanceRuleId: hit.ruleId, ...leaveDetail })}
                            >
                              打开当前规则
                            </Button>
                          )}
                      </div>
                    );
                  },
                },
                {
                  title: "模式",
                  width: 88,
                  render: (_, hit) => <StatusBadge tone={hit.mode === "OBSERVE" ? "info" : "warning"}>{hit.mode === "OBSERVE" ? "观察" : "执行"}</StatusBadge>,
                },
                {
                  title: "当次判定",
                  width: 180,
                  render: (_, hit) => (
                    <div className="op-cell-main">
                      <span>{reasonNames[hit.reason] ?? hit.reason}</span>
                      {hit.retryAfterSeconds > 0 && <span className="op-cell-sub">等待 {hit.retryAfterSeconds} 秒</span>}
                    </div>
                  ),
                },
              ]}
            />
          ) : (
            <p className="observation-muted">没有命中规则</p>
          )}
        </>
      ) : (
        <p className="observation-muted">未记录治理判定；请求可能在进入治理前已被拒绝。</p>
      )}
    </section>
  );
}
