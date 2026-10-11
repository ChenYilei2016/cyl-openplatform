import { ApiError, type ApiClient } from '../http';
import { parseJson, stringifyJson } from '../json';
import { readBoundedBlob } from '../download';
import type { DocumentFormat, DocumentView } from './types';

export interface DocumentClient {
  read: ApiClient;
  export: (view: Pick<DocumentView, 'releaseId' | 'stateVersion' | 'service' | 'version' | 'method'>, format: DocumentFormat, signal: AbortSignal) => Promise<Blob>;
}
export function createDocumentClient(identity: { adminApi: ApiClient; onUnauthorized?: () => void } | { token: string; onUnauthorized?: () => void } | { public: true } | { portal: true; onUnauthorized: () => void }): DocumentClient {
  const admin = 'adminApi' in identity;
  const portal = 'portal' in identity;
  const base = admin ? '/admin-api/documents' : portal ? '/portal-api/documents' : 'public' in identity ? '/public-api/documents' : '/api/docs';
  const headers: Record<string, string> = 'token' in identity ? { Authorization: `Bearer ${identity.token}` } : {};
  const request = async (path: string, signal?: AbortSignal) => {
    const response = await fetch(base + path, { headers, credentials: admin || portal ? 'same-origin' : 'omit', cache: 'no-store', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
    if (!response.ok) {
      if ((response.status === 401 || portal && response.status === 403) && 'onUnauthorized' in identity) identity.onUnauthorized?.();
      const result = parseJson<{ resultMsg?: string; code?: number; requestId?: string }>(await response.text());
      throw new ApiError(result.resultMsg || '文档读取失败，请刷新后重试。', result.code ?? response.status, result.requestId);
    }
    return response;
  };
  return {
    read: admin ? (path, options) => identity.adminApi(`/documents${path}`, options) : async <T>(path: string, options?: { signal?: AbortSignal }) => {
      const response = await request(path, options?.signal);
      const result = parseJson<{ code: number; resultMsg?: string; data: T }>(await response.text());
      if (result.code !== 200) throw new Error(result.resultMsg || '文档读取失败。');
      return result.data;
    },
    export: async (view, format, signal) => {
      const operation = [view.service, view.version, view.method].map(encodeURIComponent).join('/');
      const query = new URLSearchParams({ format, releaseId: view.releaseId, stateVersion: stringifyJson(view.stateVersion) });
      const response = await request(`/${operation}/export?${query}`, signal);
      const expectedType = format === 'JSON' ? 'application/json' : 'text/html';
      if (!response.headers.get('Content-Type')?.startsWith(expectedType)) throw new Error('导出响应格式不正确，请刷新后重试。');
      return readBoundedBlob(response, 2 * 1024 * 1024, expectedType);
    },
  };
}
