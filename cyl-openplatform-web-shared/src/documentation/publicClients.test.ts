import { afterEach, expect, test, vi } from 'vitest';
import { createDocumentClient } from './api';
import { createSdkClient } from '../sdk/api';
import { readBoundedBlob } from '../download';

afterEach(() => vi.unstubAllGlobals());

test('公开文档和SDK请求显式匿名，不发送Cookie、Token或跟随重定向', async () => {
  const request = vi.fn(async () => Response.json({ code: 200, data: { items: [], total: 0 } }));
  vi.stubGlobal('fetch', request);
  await createDocumentClient({ public: true }).read('?page=1');
  const sdk = createSdkClient({ public: true });
  await sdk.read('?page=2');
  expect(sdk.upload).toBeUndefined();
  expect(request.mock.calls.map(call => (call as unknown as [string])[0])).toEqual([
    '/public-api/documents?page=1', '/public-api/sdk-assets?page=2',
  ]);
  for (const call of request.mock.calls) {
    const options = (call as unknown as [string, RequestInit])[1];
    expect(options.credentials).toBe('omit');
    expect(options.cache).toBe('no-store');
    expect(options.redirect).toBe('error');
    expect(new Headers(options.headers).has('Authorization')).toBe(false);
  }
});

test('公开导出保留固定版本，404不触发登录流程且不产生文件', async () => {
  const request = vi.fn(async () => Response.json({ code: 40400001, resultMsg: '文档已停用' }, { status: 404 }));
  vi.stubGlobal('fetch', request);
  await expect(createDocumentClient({ public: true }).export({
    releaseId: 'release-1', stateVersion: 8, service: 'order', version: 'v01', method: 'get',
  }, 'JSON', new AbortController().signal)).rejects.toThrow('文档已停用');
  expect((request.mock.calls[0] as unknown as [string])[0]).toBe('/public-api/documents/order/v01/get/export?format=JSON&releaseId=release-1&stateVersion=8');
});

test('有界下载不信任缺失或偏小长度头，超过上限立即取消流', async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(6)); controller.enqueue(new Uint8Array(6)); },
    cancel,
  }), { headers: { 'Content-Length': '1' } });
  await expect(readBoundedBlob(response, 10, 'application/json')).rejects.toThrow('超过');
  expect(cancel).toHaveBeenCalledOnce();
  const blob = await readBoundedBlob(new Response('精确内容'), 100, 'text/html');
  expect(blob.size).toBe(new TextEncoder().encode('精确内容').byteLength);
  expect(blob.type).toBe('text/html');
  const failed = new Response(new ReadableStream({ start(controller) { controller.error(new Error('网络中断')); } }));
  await expect(readBoundedBlob(failed, 10, 'application/json')).rejects.toThrow('网络中断');
  expect(failed.body?.locked).toBe(false);
});
