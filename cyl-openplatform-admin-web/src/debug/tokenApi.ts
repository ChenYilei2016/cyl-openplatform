import { ApiError } from '@cyl/open-platform-web-shared/http';
import { parseJson, stringifyJson } from '@cyl/open-platform-web-shared/json';
import { readBoundedBlob } from '@cyl/open-platform-web-shared/download';

export interface DebugToken {
  accessToken: string;
  expiresAt: string;
  context: { tenantId: string; appKey: string; applicationId: string; employeeNo?: string | null };
}

/** 业务凭据独立签发，不能沿管理端 client 携带平台登录或 CSRF。 */
export async function issueDebugToken(
  credentials: { tenantId: string; appKey: string; appSecret: string; employeeNo?: string },
  signal: AbortSignal,
): Promise<DebugToken> {
  const response = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    body: stringifyJson(credentials),
  });
  const requestId = response.headers.get('X-Request-Id') || undefined;
  let result: { code: number; resultMsg?: string; requestId?: string; data: DebugToken };
  try {
    result = parseJson(await (await readBoundedBlob(response, 64 * 1024, 'application/json')).text());
    if (!result || typeof result.code !== 'number') throw new Error('响应格式不完整');
  } catch {
    throw new ApiError(`无法读取 Token 响应（HTTP ${response.status}${requestId ? `，请求号：${requestId}` : ''}）。`, response.status, requestId);
  }
  signal.throwIfAborted();
  const traceId = result.requestId || requestId;
  if (!response.ok || result.code !== 200) {
    throw new ApiError(`${result.resultMsg || '获取 Token 失败'}（错误码：${result.code}${traceId ? `，请求号：${traceId}` : ''}）`, result.code, traceId);
  }
  const token = result.data;
  if (!token || typeof token.accessToken !== 'string' || !token.accessToken || token.accessToken.length > 4096 ||
      typeof token.expiresAt !== 'string' || !Number.isFinite(Date.parse(token.expiresAt)) || Date.parse(token.expiresAt) <= Date.now() ||
      !token.context || typeof token.context.applicationId !== 'string' || !token.context.applicationId ||
      token.context.tenantId !== credentials.tenantId || token.context.appKey !== credentials.appKey ||
      (token.context.employeeNo || '') !== (credentials.employeeNo || '')) {
    throw new Error('签发响应的身份或有效期不正确，请核对租户、AK 和员工号后重试。');
  }
  return token;
}

/** 校验已粘贴Token的真实上下文，不签发、不自动获取授权。 */
export async function inspectDebugToken(accessToken: string, signal: AbortSignal): Promise<DebugToken> {
  const response = await fetch('/api/token/introspect', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    credentials: 'omit', cache: 'no-store', redirect: 'error', body: '{}',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  const body = parseJson<{ code: number; resultMsg?: string; requestId?: string; data: DebugToken['context'] & { expiresAt: string } }>(
    await (await readBoundedBlob(response, 64 * 1024, 'application/json')).text());
  signal.throwIfAborted();
  if (!response.ok || body.code !== 200) throw new ApiError(body.resultMsg || '业务身份校验失败', body.code, body.requestId);
  if (!body.data?.tenantId || !body.data.applicationId || !Number.isFinite(Date.parse(body.data.expiresAt))) throw new Error('业务身份响应不完整');
  return { accessToken, expiresAt: body.data.expiresAt, context: body.data };
}
