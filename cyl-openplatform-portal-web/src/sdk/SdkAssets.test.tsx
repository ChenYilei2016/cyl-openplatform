import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { createSdkClient } from '@cyl/open-platform-web-shared/sdk/api';
import CustomerSdkAssets from './CustomerSdkAssets';
import { parseJson } from '@cyl/open-platform-web-shared/json';
import { okhttpMavenDependency } from '@cyl/open-platform-web-shared/documentation/invocationExamples';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); history.replaceState(null, '', '/'); });
const asset = { kind: 'LEGACY_API' as const, id: 'sdk1', apiId: 'a1', releaseId: 'r1', service: 'orders', version: 'v1', method: 'query', name: '订单 Java SDK', sdkVersion: '1.0.0', language: 'JAVA', gatewayProtocol: 'HTTP_JSON_BEARER_V1', runtime: 'Java 21+', releaseNotes: '<script>danger()</script>', status: 'PUBLISHED' as const, revision: 2, sha256: 'a'.repeat(64), sizeBytes: 4, createdAt: '', publishedAt: '' };
const zip = () => new Response(new Uint8Array([80, 75, 3, 4]), { headers: { 'Content-Type': 'application/zip', 'Content-Length': '4', 'Content-Disposition': 'attachment; filename="orders-1.0.0.zip"' } });

test('下载只带业务Bearer，revision保持精度并验证类型和长度', async () => {
  const fetcher = vi.fn(async () => zip()); vi.stubGlobal('fetch', fetcher);
  const client = createSdkClient({ token: 'private-token' });
  await client.download({ ...asset, revision: parseJson('9007199254740993') }, new AbortController().signal);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain('expectedRevision=9007199254740993'); expect(url).not.toContain('private-token');
  expect(init.credentials).toBe('omit'); expect(new Headers(init.headers).get('Authorization')).toBe('Bearer private-token');
  fetcher.mockImplementation(async () => new Response('error', { headers: { 'Content-Type': 'application/json' } }));
  await expect(client.download(asset, new AbortController().signal)).rejects.toThrow('格式');
  fetcher.mockImplementation(async () => new Response('bad', { headers: { 'Content-Type': 'application/zip', 'Content-Length': '4', 'Content-Disposition': 'attachment; filename="x.zip"' } }));
  await expect(client.download(asset, new AbortController().signal)).rejects.toThrow('长度');
});

test('401只通知传入业务身份失效；超2MiB响应与超额上传都拒绝', async () => {
  const expired = vi.fn(); const fetcher = vi.fn(async () => Response.json({ code: 401, resultMsg: '失效' }, { status: 401 })); vi.stubGlobal('fetch', fetcher);
  const client = createSdkClient({ token: 't', onUnauthorized: expired });
  await expect(client.download(asset, new AbortController().signal)).rejects.toThrow('失效'); expect(expired).toHaveBeenCalledOnce();
  fetcher.mockImplementation(async () => new Response('x', { headers: { 'Content-Type': 'application/zip', 'Content-Length': String(2 * 1024 * 1024 + 1) } }));
  await expect(client.download(asset, new AbortController().signal)).rejects.toThrow('2 MiB');
  const admin = createSdkClient({ adminApi: vi.fn(), csrfToken: 'csrf' });
  const before = fetcher.mock.calls.length;
  await expect(admin.upload!(asset, new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'sdk.zip'), new AbortController().signal)).rejects.toThrow('2 MiB');
  expect(fetcher.mock.calls.length).toBe(before);
});

test('上传使用原始ZIP和CSRF，保精度query，不能转JSON或业务Token', async () => {
  const fetcher = vi.fn(async () => Response.json({ code: 200, data: asset })); vi.stubGlobal('fetch', fetcher);
  const client = createSdkClient({ adminApi: vi.fn(), csrfToken: 'csrf' }); const file = new File(['ZIP'], 'sdk.zip');
  await client.upload!({ ...asset, revision: parseJson('9007199254740993') }, file, new AbortController().signal);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain('expectedRevision=9007199254740993'); expect(init.body).toBe(file); expect(init.method).toBe('PUT');
  expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf'); expect(new Headers(init.headers).get('Content-Type')).toBe('application/zip');
});

test('门户按明确操作分页显示版本说明，下载回收URL且卸载取消请求', async () => {
  const create = vi.fn(() => 'blob:sdk'); const revoke = vi.fn(); vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const fetcher = vi.fn(async (url: string) => url.includes('/download') ? zip() : Response.json({ code: 200, data: { items: [asset], total: 21, page: 1, pageSize: 20 } })); vi.stubGlobal('fetch', fetcher);
  const { unmount } = render(<CustomerSdkAssets operation={{ service: 'orders', version: 'v1', method: 'query' }} token="t" onUnauthorized={vi.fn()} />);
  await screen.findByText('订单 Java SDK'); expect(document.querySelector('script')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '下载 SDK 1.0.0' })); await waitFor(() => expect(create).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '下一页' })); await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes('page=2'))).toBe(true));
  expect(fetcher.mock.calls[0][0]).toContain('service=orders&version=v1&method=query');
  unmount(); expect(revoke).toHaveBeenCalledWith('blob:sdk');
});

test('临时下载失败可重试，确定不可见后清除旧详情和下载操作',async()=>{
 history.replaceState(null,'','/portal/?section=sdk&asset=sdk1');
 let gone=false;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  if(url==='/platform-info')return Response.json({code:200,data:{gatewayBaseUrl:'https://gateway.example.test'}});
  if(url.includes('/download')){if(!gone)throw new TypeError('网络中断');return Response.json({code:40400001,resultMsg:'SDK资产当前不可见'},{status:404});}
  return Response.json({code:200,data:url.includes('/sdk-assets?')?{items:gone?[]:[{...asset,kind:'PLATFORM'}],total:gone?0:1,page:1,pageSize:20}:{...asset,kind:'PLATFORM'}});
 }));
 const CustomerDocuments=(await import('../documentation/CustomerDocuments')).default;render(<CustomerDocuments/>);
 fireEvent.click(await screen.findByRole('button',{name:'下载 SDK 1.0.0'}));await screen.findByText('网络中断');expect(screen.getByRole('button',{name:'下载 SDK 1.0.0'})).toBeTruthy();
 gone=true;fireEvent.click(screen.getByRole('button',{name:'下载 SDK 1.0.0'}));await screen.findByText('此 SDK 版本当前不可下载，请刷新版本信息或返回列表。');expect(screen.queryByRole('button',{name:'下载 SDK 1.0.0'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'返回 SDK 列表'}));await screen.findByText('暂无匹配的已发布平台 SDK');
});

const platform = (id: string, sdkVersion: string, publishedAt: string, releaseNotes = '') => ({ ...asset, kind: 'PLATFORM' as const, id, sdkVersion, publishedAt, releaseNotes, name: '平台 Java SDK' });
const center = async (search: string, items: ReturnType<typeof platform>[]) => {
  history.replaceState(null, '', `/portal/?${search}`);
  const fetcher = vi.fn(async (url: string) => url === '/platform-info' ? Response.json({ code: 200, data: { gatewayBaseUrl: '' } })
    : Response.json({ code: 200, data: { items, total: items.length, page: 1, pageSize: 20 } }));
  vi.stubGlobal('fetch', fetcher);
  const CustomerDocuments = (await import('../documentation/CustomerDocuments')).default;
  render(<CustomerDocuments />);
  return fetcher;
};

test('SDK 中心：未筛选首页突出最近发布的当前版本，更新日志按发布时间倒序；筛选后不标记当前版本', async () => {
  const items = [platform('s2', '1.1.0', '2026-03-01T00:00:00Z', '修复超时'), platform('s3', '1.2.0', '2026-06-01T00:00:00Z', '新增 HMAC 签名'), platform('s1', '1.0.0', '2026-01-01T00:00:00Z')];
  await center('section=sdk', items);
  const versions = await screen.findByRole('heading', { name: '版本' }, { timeout: 5000 });
  const cards = within(versions.closest('section')!).getAllByRole('listitem');
  expect(cards.map(card => card.querySelector('.op-sdk-version__number')?.textContent)).toEqual(['v1.1.0', 'v1.2.0', 'v1.0.0']);
  const current = cards.filter(card => card.getAttribute('aria-current') === 'true');
  expect(current).toHaveLength(1);
  expect(within(current[0]).getByText('当前版本')).toBeTruthy();
  expect(within(current[0]).getByRole('button', { name: '下载 SDK 1.2.0' })).toBeTruthy();
  const changelog = screen.getByRole('heading', { name: '更新日志' }).closest('section')!;
  expect(Array.from(changelog.querySelectorAll('h3'), heading => heading.textContent)).toEqual(['v1.2.0 平台 Java SDK', 'v1.1.0 平台 Java SDK', 'v1.0.0 平台 Java SDK']);
  expect(within(changelog).getByText('新增 HMAC 签名')).toBeTruthy();
  expect(within(changelog).getByText('暂无版本发布说明，请以包内 README 为准。')).toBeTruthy();
  fireEvent.click(within(changelog).getAllByRole('link', { name: '查看完整说明 →' })[0]);
  expect(new URLSearchParams(location.search).get('asset')).toBe('s3');
  cleanup();
  await center('section=sdk&language=JAVA', items);
  await screen.findByRole('heading', { name: '版本' }, { timeout: 5000 });
  expect(screen.queryByText('当前版本')).toBeNull();
});

test('SDK 中心：依赖坐标按 Maven / Gradle 页签一键复制原文；读取失败显示可重试状态页', async () => {
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText } }));
  history.replaceState(null, '', '/portal/?section=sdk');
  let fail = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/platform-info' ? Response.json({ code: 200, data: { gatewayBaseUrl: '' } })
    : fail ? Response.json({ code: 50300001, resultMsg: 'SDK 目录暂不可用' }, { status: 503 }) : Response.json({ code: 200, data: { items: [], total: 0, page: 1, pageSize: 20 } })));
  const CustomerDocuments = (await import('../documentation/CustomerDocuments')).default;
  render(<CustomerDocuments />);
  const coordinates = (await screen.findByText('依赖坐标', { selector: '.op-code-block__title' }, { timeout: 5000 })).closest('figure')!;
  fireEvent.click(within(coordinates).getByRole('button', { name: '复制Maven代码' }));
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(okhttpMavenDependency));
  fireEvent.click(within(coordinates).getByRole('tab', { name: 'Gradle (Kotlin)' }));
  fireEvent.click(within(coordinates).getByRole('button', { name: /复制/ }));
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('implementation("com.squareup.okhttp3:okhttp:4.12.0")'));
  expect(await screen.findByText('SDK 目录暂不可用')).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  expect(await screen.findByText('暂无匹配的已发布平台 SDK')).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看接入指南' }).getAttribute('href')).toBe('?section=guide');
});
