import {
  ApiOutlined,
  AppstoreOutlined,
  ArrowRightOutlined,
  CloudUploadOutlined,
  FileSearchOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { EmptyState, IdText, Metric, PageHeader, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { useRead } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Button, Skeleton } from "antd";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import type { AdminApi } from "../access/api";
import { useAdminNavigation, type AdminRoute } from "../navigation/AdminNavigation";
import { readRecentPages } from "../navigation/CommandPalette";
import "./workbench.css";

interface Session {
  displayName: string;
  employeeNo: string;
  permissions: string[];
  superAdministrator: boolean;
}

/** 114 B6 `GET /admin-api/workbench`：无权限的区块为 null。 */
export interface WorkbenchData {
  pendingReviews: {
    total: number;
    items: { id: string; apiId: string; name: string; service: string; version: string; method: string; draftRevision: number; submittedAt: string; submittedByEmployeeNo: string; submittedByName?: string | null }[];
  } | null;
  myDrafts: {
    ownerId: string | null;
    truncated: boolean;
    items: { id: string; name: string; service: string; version: string; method: string; draftRevision: number; liveDraftRevision: number | null; pendingReleaseId: string | null; updatedAt: string | null }[];
  } | null;
  traffic: { from: string; to: string; requests: number; failures: number; failureRate: string | null } | null;
  alerts: { firing: number; stale: boolean } | null;
}

const base: AdminRoute = { page: "home", apiId: null, step: "outer", query: "", pageNo: 1 };
const reviewPermissions = ["MANAGE_APIS", "PUBLISH_APIS", "REVIEW_APIS"];
/** 调用日志的通用条件（字段名由日志页约定，见 114 报告）。 */
const lastHour = { "logs.range": ["1h"] };

const formatTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
};

function Panel({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="op-workbench__panel" aria-label={title}>
      <header>
        <h2>{title}</h2>
        {extra}
      </header>
      {children}
    </section>
  );
}

/** 聚合接口加载中/失败时各区块共用的占位。 */
function Loading({ loading, error, reload }: { loading: boolean; error: string; reload: () => void }) {
  return loading ? (
    <Skeleton active paragraph={{ rows: 3 }} title={false} />
  ) : (
    <EmptyState kind="error" description={error || "加载失败"} action={<Button onClick={reload}>重试</Button>} />
  );
}

type Read = { data: WorkbenchData | null; loading: boolean; error: string; reload: () => void };
type Open = (route: Partial<AdminRoute>) => void;

function PendingReviews({ read, open }: { read: Read; open: Open }) {
  const block = read.data?.pendingReviews;
  // 会话权限与服务端裁剪不一致（如权限刚被收回）时隐藏区块。
  if (read.data && !block) return null;
  return (
    <Panel
      title={block ? `待审核 · ${block.total}` : "待审核"}
      extra={<Button type="link" size="small" onClick={() => open({ page: "publications", releaseResult: "PENDING" })}>查看全部 <ArrowRightOutlined /></Button>}
    >
      {!block ? (
        <Loading {...read} />
      ) : !block.items.length ? (
        <EmptyState title="没有待审核的发布" description="提交的发布申请会出现在这里。" />
      ) : (
        <ul className="op-workbench__list">
          {block.items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => open({ page: "publications", releaseId: item.id })}>
                <span className="op-workbench__list-main">
                  <span className="op-workbench__list-title">{item.name}</span>
                  <IdText value={`${item.service}.${item.method} · ${item.version}`} copyable={false} maxChars={48} />
                </span>
                <StatusBadge tone="info" detail={`r${String(item.draftRevision)}`}>待审核</StatusBadge>
                <span className="op-workbench__list-meta">{item.submittedByName || `工号 ${item.submittedByEmployeeNo}`} · {formatTime(item.submittedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function MyDrafts({ read, open }: { read: Read; open: Open }) {
  const block = read.data?.myDrafts;
  if (read.data && !block) return null;
  return (
    <Panel
      title="我的草稿"
      extra={block?.ownerId && (
        <Button type="link" size="small" onClick={() => open({ page: "catalog", ownerId: block.ownerId!, sort: "UPDATED_DESC" })}>我负责的 API <ArrowRightOutlined /></Button>
      )}
    >
      {!block ? (
        <Loading {...read} />
      ) : !block.items.length ? (
        <EmptyState
          title={block.ownerId ? "没有未发布的修改" : "还没有负责的 API"}
          description={block.ownerId ? "你负责的 API 有未发布修改时会出现在这里。" : "在 API 配置中把负责人设为自己后，未发布的修改会出现在这里。"}
        />
      ) : (
        <>
          <ul className="op-workbench__list">
            {block.items.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => open({ page: "catalog", apiId: item.id, step: "outer" })}>
                  <span className="op-workbench__list-main">
                    <span className="op-workbench__list-title">{item.name}</span>
                    <IdText value={`${item.service}.${item.method} · ${item.version}`} copyable={false} maxChars={48} />
                  </span>
                  {item.pendingReleaseId ? (
                    <StatusBadge tone="info" detail={`r${String(item.draftRevision)}`}>审核中</StatusBadge>
                  ) : (
                    <StatusBadge tone="warning" detail={`r${String(item.draftRevision)}`}>{item.liveDraftRevision == null ? "未发布" : "有修改"}</StatusBadge>
                  )}
                  {item.updatedAt && <span className="op-workbench__list-meta">{formatTime(item.updatedAt)}</span>}
                </button>
              </li>
            ))}
          </ul>
          {block.truncated && <p className="op-workbench__note">只显示最近更新的 10 项，完整列表见“我负责的 API”。</p>}
        </>
      )}
    </Panel>
  );
}

function Runtime({ read, open }: { read: Read; open: Open }) {
  const traffic = read.data?.traffic;
  const alerts = read.data?.alerts;
  const failing = Boolean(traffic?.failures);
  if (read.data && (!traffic || !alerts)) return null;
  return (
    <Panel title="近 1 小时运行" extra={<Button type="link" size="small" onClick={() => open({ page: "calls", managementFilters: lastHour })}>调用日志 <ArrowRightOutlined /></Button>}>
      {!traffic || !alerts ? (
        <Loading {...read} />
      ) : (
        <div className="op-workbench__runtime">
          <button type="button" className="op-workbench__stat" onClick={() => open({ page: "calls", managementFilters: lastHour })}>
            <Metric label="正式调用" value={traffic.requests.toLocaleString("zh-CN")} />
          </button>
          <button
            type="button"
            className={`op-workbench__stat${failing ? " is-error" : ""}`}
            onClick={() => open({ page: "calls", managementFilters: { ...lastHour, "logs.outcome": ["FAILURE"] } })}
            aria-label={`失败率 ${traffic.failureRate == null ? "无调用" : `${traffic.failureRate}%`}，查看失败调用`}
          >
            <Metric label={`失败率 · ${traffic.failures.toLocaleString("zh-CN")} 次失败`} value={traffic.failureRate == null ? "—" : `${traffic.failureRate}%`} />
          </button>
          <button
            type="button"
            className={`op-workbench__stat${alerts.firing ? " is-error" : ""}`}
            onClick={() => open({ page: "operations", operationsView: "alerts" })}
            aria-label={`未恢复告警 ${alerts.firing}，查看告警`}
          >
            <Metric label={alerts.stale ? "未恢复告警 · 评估已过期" : "未恢复告警"} value={alerts.firing} />
          </button>
          {!traffic.requests && !alerts.firing && <p className="op-workbench__note">近 1 小时没有正式调用，也没有未恢复的告警。</p>}
        </div>
      )}
    </Panel>
  );
}

function RecentVisits() {
  const recent = readRecentPages();
  const navigateTo = useNavigate();
  return (
    <Panel title="最近访问">
      {recent.length ? (
        <ul className="op-workbench__list">
          {recent.map((item) => (
            <li key={item.path}>
              <a href={`#${item.path}`} onClick={(event) => {
                event.preventDefault();
                navigateTo(item.path);
              }}>
                <span className="op-workbench__list-main">
                  <span className="op-workbench__list-title">{item.title}</span>
                  {item.detail && <IdText value={item.detail} copyable={false} maxChars={40} />}
                </span>
                <span className="op-workbench__list-meta">{formatTime(new Date(item.at).toISOString())}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="还没有访问记录" description="打开过的页面会出现在这里，也可按 Ctrl/⌘ + K 搜索。" />
      )}
    </Panel>
  );
}

export default function Workbench({ api, session }: { api: AdminApi; session: Session }) {
  const navigation = useAdminNavigation();
  const has = (...codes: string[]) => codes.some((code) => session.permissions.includes(code));
  const go: Open = (route) => navigation.navigate({ ...base, ...route } as AdminRoute);
  const showReviews = has(...reviewPermissions);
  const showDrafts = has("MANAGE_APIS");
  const showRuntime = has("VIEW_AUDIT");
  // 单次聚合请求；没有任何聚合区块权限时不请求。
  const read = useRead<WorkbenchData>(api, "/workbench", 0, showReviews || showDrafts || showRuntime);
  const actions = [
    has("MANAGE_APIS") && { key: "new", icon: <PlusOutlined />, title: "新建 API", hint: "从 cURL、OpenAPI 或空白开始", route: { page: "catalog", apiId: "new", step: "outer" } },
    has("MANAGE_APIS") && { key: "import", icon: <CloudUploadOutlined />, title: "导入 API", hint: "OpenAPI / cURL / 平台导出", route: { page: "imports" } },
    has("MANAGE_APIS") && { key: "apis", icon: <ApiOutlined />, title: "API 列表", hint: "查找、编辑、调试已接入的 API", route: { page: "catalog" } },
    has("MANAGE_APPLICATIONS") && { key: "credentials", icon: <AppstoreOutlined />, title: "接入凭据", hint: "授权、Token 与签名", route: { page: "applications" } },
    has("VIEW_AUDIT") && { key: "logs", icon: <FileSearchOutlined />, title: "调用日志", hint: "按 requestId 定位失败原因", route: { page: "calls" } },
  ].filter(Boolean) as { key: string; icon: ReactNode; title: string; hint: string; route: Partial<AdminRoute> }[];
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  return (
    <div className="op-workbench">
      <PageHeader title="工作台" meta={`${greeting}，${session.displayName || session.employeeNo}`} />
      {actions.length > 0 && (
        <nav className="op-workbench__actions" aria-label="常用操作">
          {actions.map((action) => (
            <button key={action.key} type="button" className="op-workbench__action" onClick={() => go(action.route)}>
              <span className="op-workbench__action-icon" aria-hidden>{action.icon}</span>
              <span>
                <strong>{action.title}</strong>
                <small>{action.hint}</small>
              </span>
            </button>
          ))}
        </nav>
      )}
      <div className="op-workbench__grid">
        {showReviews && <PendingReviews read={read} open={go} />}
        {showDrafts && <MyDrafts read={read} open={go} />}
        {showRuntime && <Runtime read={read} open={go} />}
        <RecentVisits />
      </div>
      {!session.permissions.length && !session.superAdministrator && (
        <EmptyState kind="forbidden" title="当前未分配操作权限" description="请联系总管理员分配 API、凭据或审计等权限。" />
      )}
    </div>
  );
}
