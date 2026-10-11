import { ApiError, type ApiClient } from '@cyl/open-platform-web-shared/http';
import { parseJson, stringifyJson } from '@cyl/open-platform-web-shared/json';

/** 身份只来自服务端会话；tenantName 仅用于展示，缺失时回退显示租户 ID。 */
export interface PortalSession { tenantId: string; tenantName?: string | null; userId: string; employeeNo: string; displayName: string }
/** 平台登录失效（401）与门户资格被取消（403）需要不同的下一步提示。 */
export type PortalSessionLoss = 'expired' | 'forbidden';
export interface PortalScope { code: string; name: string; enabled: boolean }
export interface PortalApplication { id: string; applicationId: string; appKey: string; name: string; applicationStatus: 'ENABLED' | 'DISABLED'; status: 'ACTIVE' | 'REVOKED'; authorizationVersion: number; globalName?: string; note: string; noteRevision: number; scopes: PortalScope[] }
export interface TokenContext { tenantId: string; applicationId: string; appKey: string; employeeNo?: string | null; expiresAt: string }
export interface TokenResponse { accessToken: string; context: TokenContext; expiresAt: string }
interface ApiResult<T> { code: number; resultMsg?: string; requestId?: string; data: T }

/** 写请求区分明确拒绝与结果未知，调用方不能把超时当作未执行。 */
export class PortalMutationError extends ApiError {
  constructor(message: string, readonly outcome: 'REJECTED' | 'UNKNOWN', code = 0, requestId?: string) {
    super(message, code, requestId);
  }
}

export function createPortalApi(csrfToken: string | null, onExpired: (reason: PortalSessionLoss) => void): ApiClient {
  return async <T>(path: string, options: Parameters<ApiClient>[1] = {}): Promise<T> => {
    const method = options.method ?? 'GET';
    const mutation = method !== 'GET';
    if (mutation && !csrfToken) throw new PortalMutationError('会话缺少操作凭据，请重新验证登录。', 'REJECTED');
    const headers: Record<string, string> = {};
    if (mutation) headers['X-CSRF-Token'] = csrfToken!;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const body = options.body === undefined ? undefined : stringifyJson(options.body);
    let response: Response;
    try {
      response = await fetch(`/portal-api${path}`, { method, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), body });
    } catch (error) {
      if (mutation) throw new PortalMutationError('未收到明确的操作结果，请先核对列表状态。', 'UNKNOWN');
      throw error;
    }
    let result: ApiResult<T>;
    try {
      result = parseJson<ApiResult<T>>(await response.text());
      if (!result || typeof result.code !== 'number' || (result.code === 200 && !Object.hasOwn(result, 'data')))
        throw new Error('响应格式不完整');
    } catch {
      if (mutation) {
        const rejected = response.status >= 400 && response.status < 500;
        throw new PortalMutationError(rejected ? '请求被拒绝，无法读取详细错误；请核对输入。' : '响应无法确认操作结果，请先核对列表状态。',
          rejected ? 'REJECTED' : 'UNKNOWN', response.status);
      }
      throw new ApiError('响应格式不正确，请刷新核对。', response.status);
    }
    // AK/Secret校验失败是业务凭据问题，不能误清除已验证的平台登录。
    if (response.status === 401 && result.code === 40100001) onExpired('expired');
    else if (response.status === 403 && result.code === 40300001) onExpired('forbidden');
    if (!response.ok || result.code !== 200) {
      const message = result.resultMsg || '操作失败，请重新核对状态。';
      if (mutation) throw new PortalMutationError(message,
        response.status >= 400 && response.status < 500 ? 'REJECTED' : 'UNKNOWN', result.code, result.requestId);
      throw new ApiError(message, result.code, result.requestId);
    }
    return result.data;
  };
}

/** 正式业务请求只携带Bearer；请求最高256KiB、响应2MiB；服务端仍按运行配置执行更小限制。 */
export async function businessRequest<T = unknown>(path: string, options: { token?: string; body?: unknown; bodyText?: string; signal?: AbortSignal; onUnauthorized?: () => void } = {}): Promise<ApiResult<T> & { httpStatus: number }> {
  if (options.bodyText !== undefined && new TextEncoder().encode(options.bodyText).length > 256 * 1024) throw new Error('请求正文超过 256 KiB 限制。');
  const body = options.bodyText === undefined ? stringifyJson(options.body ?? {}) : stringifyJson(parseJson(options.bodyText));
  if (new TextEncoder().encode(body).length > 256 * 1024) throw new Error('请求正文超过 256 KiB 限制。');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(path, { method: 'POST', headers, credentials: 'omit', cache: 'no-store', redirect: 'error', body,
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
  options.signal?.throwIfAborted();
  if (response.status === 401) options.onUnauthorized?.();
  const requestId = response.headers.get('X-Request-Id') || undefined;
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(`业务响应正文为空（HTTP ${response.status}${requestId ? `，请求号：${requestId}` : ''}）。`, response.status, requestId);
  const decoder = new TextDecoder(); let text = ''; let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error('响应正文超过 2 MiB 限制。');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    throw new ApiError(`${error instanceof Error ? error.message : '读取业务响应失败'}（HTTP ${response.status}${requestId ? `，请求号：${requestId}` : ''}）。请核对业务状态。`, response.status, requestId);
  } finally {
    // 网络失败时 cancel 也可能拒绝，不能覆盖原始错误或跳过释放锁。
    try { await reader.cancel(); } catch { /* 原始读取错误交由调用方处理。 */ }
    finally { reader.releaseLock(); }
  }
  options.signal?.throwIfAborted();
  let result: ApiResult<T>;
  try {
    result = parseJson<ApiResult<T>>(text);
    if (!result || typeof result.code !== 'number' || (result.code === 200 && !Object.hasOwn(result, 'data'))) throw new Error('业务响应格式不完整。');
  } catch {
    throw new ApiError(`无法读取业务响应（HTTP ${response.status}${requestId ? `，请求号：${requestId}` : ''}）。请核对业务状态。`, response.status, requestId, undefined, response.status);
  }
  const traceId = result.requestId || requestId;
  if (!response.ok || result.code !== 200) throw new ApiError(`${result.resultMsg || '业务调用失败'}（HTTP ${response.status}，错误码：${result.code}${traceId ? `，请求号：${traceId}` : ''}）`, result.code, traceId, undefined, response.status);
  return { ...result, requestId: traceId, httpStatus: response.status };
}
