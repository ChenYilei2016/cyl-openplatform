import { afterEach, expect, test, vi } from 'vitest';
import { createPortalApi, PortalMutationError } from './api';

afterEach(() => vi.unstubAllGlobals());

test('业务AK或Secret无效不清平台会话，明确平台会话失败仍退出', async () => {
  const expired = vi.fn();
  const request = vi.fn(async () => Response.json({ code: 40100002, resultMsg: '应用凭据无效' }, { status: 401 }));
  vi.stubGlobal('fetch', request);
  const api = createPortalApi('csrf', expired);
  await expect(api('/bindings', { method: 'POST', body: { appKey: 'a'.repeat(32), appSecret: 'not-valid' } })).rejects.toMatchObject({ outcome: 'REJECTED', code: 40100002 });
  expect(expired).not.toHaveBeenCalled();
  request.mockImplementation(async () => Response.json({ code: 40100001, resultMsg: '请先登录' }, { status: 401 }));
  await expect(api('/applications')).rejects.toThrow('请先登录');
  expect(expired).toHaveBeenCalledExactlyOnceWith('expired');
});

test('创建写请求不会重试，网络和不可信结果为UNKNOWN，明确拒绝及本地CSRF失败为REJECTED', async () => {
  const cases: [() => Promise<Response>, 'UNKNOWN' | 'REJECTED'][] = [
    [async () => { throw new TypeError('网络中断'); }, 'UNKNOWN'],
    [async () => Response.json({ code: 50000001, resultMsg: '服务异常' }, { status: 500 }), 'UNKNOWN'],
    [async () => new Response('<html>登录页</html>'), 'UNKNOWN'],
    [async () => Response.json({ code: 200 }), 'UNKNOWN'],
    [async () => Response.json({ code: 40000001, resultMsg: '参数错误' }, { status: 400 }), 'REJECTED'],
  ];
  for (const [reply, outcome] of cases) {
    const request = vi.fn(reply); vi.stubGlobal('fetch', request);
    await expect(createPortalApi('csrf', vi.fn())('/applications', { method: 'POST', body: {} })).rejects.toMatchObject({ outcome });
    expect(request).toHaveBeenCalledOnce();
    const options = (request.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(options.redirect).toBe('error');
  }
  const request = vi.fn(); vi.stubGlobal('fetch', request);
  await expect(createPortalApi(null, vi.fn())('/applications', { method: 'POST', body: {} })).rejects.toBeInstanceOf(PortalMutationError);
  expect(request).not.toHaveBeenCalled();
});
