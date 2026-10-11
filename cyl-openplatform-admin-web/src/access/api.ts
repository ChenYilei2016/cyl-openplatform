import { parseJson, stringifyJson } from '@cyl/open-platform-web-shared/json';
import {
  ApiError as AdminApiError,
  type ApiClient as AdminApi,
  type ApiRequestOptions as RequestOptions,
} from '@cyl/open-platform-web-shared/http';

export { ApiError as AdminApiError } from '@cyl/open-platform-web-shared/http';
export type { ApiClient as AdminApi, Page } from '@cyl/open-platform-web-shared/http';

/** 子工作区只汇报操作状态，不向导航层传递秘密。 */
export interface CredentialOperationState { busy: boolean; unresolved: boolean; unacknowledged: boolean }

export interface Scope {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  defaultForNewApplication: boolean;
  /** 公共通用：启用期间所有租户在 MCP 工具与门户展示中可用，动态生效，不复制到凭据。 */
  publicAccess: boolean;
  /** 已发布生效版本携带该组的 API 数（权限组列表与详情返回）；草稿中的增删发布后才计入。 */
  apiCount?: number;
  /** 持有该组的凭据数。 */
  credentialCount?: number;
  /** 有效直接开通的租户数，不含公共通用的隐式授权。 */
  tenantCount?: number;
}
/** 租户权限：权限组开通给指定租户；撤销保留记录。updatedAt 为最近一次开通或撤销的时间。 */
export interface TenantScopeGrant {
  id: string;
  scopeCode: string;
  tenantId: string;
  tenantName?: string | null;
  status: "ACTIVE" | "REVOKED";
  grantedByTenantId: string;
  grantedByEmployeeNo: string;
  grantedByName?: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}
/** 权限组相关 API：关联保存在 API 草稿 scopeCodes 中，draftIncluded 与 liveIncluded 不同即为待发布的增删。 */
export interface ScopeApi {
  id: string;
  name: string;
  service: string;
  version: string;
  method: string;
  protocol: string;
  draftRevision: number;
  liveDraftRevision: number | null;
  draftIncluded: boolean;
  liveIncluded: boolean;
}
export interface Application {
  activeTenantGrantCount?: number | null;
  tenantNames?: Record<string, string>;
  scopeNames?: Record<string, string>;
  tenantGrantCount?: number;
  matchedTenantGrantCount?: number;
  matchedTenantGrants?: { tenantId: string; status: 'ACTIVE' | 'REVOKED' }[];
  selectedTenantGrantStatus?: 'ACTIVE' | 'REVOKED' | null;
  id: string;
  appKey: string;
  name: string;
  ownerTenantId: string;
  status: 'ENABLED' | 'DISABLED';
  authorizationVersion: number;
  scopeCodes: string[];
  /** 最近一次正式调用时间（列表与详情按页批量聚合）；保留期内无记录为空。 */
  lastCalledAt?: string | null;
  /** 按 Token 记录 ID 搜索命中时返回该记录 ID，用于打开 Token 页签定位。 */
  matchedTokenId?: string | null;
}
export interface TenantGrant {
  tenantName?: string | null;
  id: string;
  applicationId: string;
  tenantId: string;
  status: 'ACTIVE' | 'REVOKED';
  authorizationVersion: number;
  note?: string;
  noteRevision?: number;
}
export interface UserGrant {
  id: string;
  tenantGrantId: string;
  tenantId: string;
  userId: string;
  employeeId: string;
  employeeNo: string;
  displayName: string;
  status: 'ACTIVE' | 'REVOKED';
  authorizationVersion: number;
}
export interface Audit {
  id: string;
  action: string;
  operatorTenantId: string;
  operatorEmployeeNo: string;
  operatorUserId?: string | null;
  operatorEmployeeId?: string | null;
  tenantGrantId?: string | null;
  targetUserId?: string | null;
  targetEmployeeId?: string | null;
  targetEmployeeNo?: string | null;
  targetTenantId: string;
  targetId: string;
  outcome: string;
  summary: string;
  requestId: string;
  occurredAt: string;
}
export interface Credential {
  appKey: string;
  appSecret: string;
}

export function createAdminApi(
  csrfToken: string | null,
  onUnauthorized: () => void,
  onForbidden?: () => void,
): AdminApi {
  return async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
    const method = options.method ?? 'GET';
    if (method !== 'GET' && !csrfToken)
      throw new Error('会话缺少操作凭据，请刷新页面重新验证登录。');
    if (options.body !== undefined && options.bodyText !== undefined)
      throw new Error('不能同时提交两种请求正文。');
    const headers: Record<string, string> = {};
    if (options.body !== undefined || options.bodyText !== undefined)
      headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken!;
    if (options.bearerToken) headers.Authorization = `Bearer ${options.bearerToken}`;
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000);
    let response: Response;
    try {
      response = await fetch(`/admin-api${path}`, {
        method,
        headers,
        credentials: 'same-origin',
        signal,
        body:
          options.bodyText ??
          (options.body === undefined ? undefined : stringifyJson(options.body)),
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new Error(
        method === 'GET'
          ? '网络连接失败，请重试。'
          : '未收到操作结果，请先刷新核对状态，避免重复提交。',
      );
    }
    const result = await response
      .text()
      .then((text) =>
        parseJson<{ code: number; resultMsg?: string; requestId?: string; data: T }>(text),
      );
    if (response.status === 401 && result?.code !== 40100003 && result?.code !== 40100002) {
      onUnauthorized();
      throw new Error('登录已失效，请重新登录。');
    }
    if (response.status === 403) onForbidden?.();
    if (!response.ok || result?.code !== 200) {
      const message =
        result?.resultMsg ||
        (response.status === 403 ? '没有执行此操作的权限。' : '操作失败，请稍后重试。');
      throw new AdminApiError(
        `${message}${result?.requestId ? `（请求号：${result.requestId}）` : ''}`,
        result?.code ?? response.status,
        result?.requestId,
        result?.data,
        response.status,
      );
    }
    return result.data as T;
  };
}
