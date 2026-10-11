import { ApiError, type ApiClient } from '../http';
import { parseJson, stringifyJson } from '../json';
import { readBoundedBlob } from '../download';

export type SdkAssetKind = 'PLATFORM' | 'LEGACY_API';

export interface SdkAsset {
  id: string; kind: SdkAssetKind;
  apiId: string | null; releaseId: string | null; service: string | null; version: string | null; method: string | null;
  name: string; sdkVersion: string; language: string; gatewayProtocol: string; runtime: string;
  releaseNotes: string; status: 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN'; revision: number;
  sha256: string | null; sizeBytes: number | null; createdAt: string; publishedAt: string | null;
}
export const assetStatusNames = { DRAFT: '草稿', PUBLISHED: '已发布', WITHDRAWN: '已撤下' };
export interface SdkArchivePreview { manifest: Pick<SdkAsset, 'sdkVersion' | 'language' | 'gatewayProtocol' | 'runtime'>; sha256: string; sizeBytes: number }
export interface SdkClient {
  inspect?: (file: File, signal: AbortSignal) => Promise<SdkArchivePreview>;
  read: ApiClient;
  upload?: (asset: SdkAsset, file: File, signal: AbortSignal) => Promise<SdkAsset>;
  download: (asset: SdkAsset, signal: AbortSignal) => Promise<{ blob: Blob; filename: string }>;
}
const maxBytes = 2 * 1024 * 1024;
export function createSdkClient(identity: { adminApi: ApiClient; csrfToken: string | null; onUnauthorized?: () => void } | { token: string; onUnauthorized?: () => void } | { public: true }): SdkClient {
  const admin = 'adminApi' in identity; const base = admin ? '/admin-api/sdk-assets' : 'public' in identity ? '/public-api/sdk-assets' : '/api/sdk-assets';
  const request = async (path: string, signal?: AbortSignal, file?: File) => {
    const headers: Record<string, string> = 'token' in identity ? { Authorization: `Bearer ${identity.token}` } : {};
    if (file) {
      if (!admin || !identity.csrfToken) throw new Error('会话缺少操作凭据，请重新登录。');
      if (!file.size || file.size > maxBytes) throw new Error('ZIP 必须为非空文件且不超过 2 MiB。');
      headers['Content-Type'] = 'application/zip'; headers['X-CSRF-Token'] = identity.csrfToken;
    }
    const response = await fetch(base + path, { method: file ? 'PUT' : 'GET', headers, body: file, credentials: admin ? 'same-origin' : 'omit', cache: 'no-store', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
    if (!response.ok) {
      if (response.status === 401 && 'onUnauthorized' in identity) identity.onUnauthorized?.();
      const result = parseJson<{ resultMsg?: string; code?: number; requestId?: string }>(await response.text());
      throw new ApiError(result.resultMsg || 'SDK 操作失败，请刷新核对状态。', result.code ?? response.status, result.requestId, undefined, response.status);
    }
    return response;
  };
  return {
    read: admin ? (path, options) => identity.adminApi(`/sdk-assets${path}`, options) : async <T>(path: string, options?: { signal?: AbortSignal }) => {
      const response = await request(path, options?.signal);
      const result = parseJson<{ code: number; resultMsg?: string; data: T }>(await response.text());
      if (result.code !== 200) throw new Error(result.resultMsg || 'SDK 读取失败。');
      return result.data;
    },
    ...(admin ? { inspect: async (file: File, signal: AbortSignal) => {
      const response = await request('/inspect', signal, file);
      const result = parseJson<{ code: number; data: SdkArchivePreview; resultMsg?: string }>(await response.text());
      if (result.code !== 200) throw new Error(result.resultMsg || 'ZIP 校验失败');
      return result.data;
    }, upload: async (asset: SdkAsset, file: File, signal: AbortSignal) => {
      const response = await request(`/${encodeURIComponent(asset.id)}/content?${new URLSearchParams({ expectedRevision: stringifyJson(asset.revision) })}`, signal, file);
      const result = parseJson<{ code: number; resultMsg?: string; data: SdkAsset }>(await response.text());
      if (result.code !== 200) throw new Error(result.resultMsg || '上传失败，请刷新核对状态。');
      return result.data;
    } } : {}),
    download: async (asset, signal) => {
      const response = await request(`/${encodeURIComponent(asset.id)}/download?${new URLSearchParams({ expectedRevision: stringifyJson(asset.revision) })}`, signal);
      if (response.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/zip') throw new Error('SDK 下载格式不正确。');
      const lengthHeader = response.headers.get('Content-Length');
      const length = lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : NaN;
      if (length > maxBytes) throw new Error('SDK 下载超过 2 MiB 限制。');
      if (!Number.isSafeInteger(length) || length <= 0) throw new Error('SDK 下载缺少有效长度。');
      const disposition = response.headers.get('Content-Disposition') ?? '';
      if (!/^attachment(?:;|$)/i.test(disposition)) throw new Error('SDK 下载格式缺少附件标记。');
      const filename = disposition.match(/filename="([A-Za-z0-9._-]+\.zip)"/i)?.[1] ?? 'sdk.zip';
      const blob = await readBoundedBlob(response, maxBytes, 'application/zip');
      if (blob.size !== length || blob.size !== asset.sizeBytes) throw new Error('SDK 下载长度不一致，请刷新重试。');
      return { blob, filename };
    },
  };
}
