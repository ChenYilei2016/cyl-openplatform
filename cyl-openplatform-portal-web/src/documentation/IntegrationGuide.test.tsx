import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createHash, createHmac } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { signHmacRequest } from '@cyl/open-platform-web-shared/documentation/requestSigning';
import CustomerDocuments from './CustomerDocuments';
import { guideExamples } from './guideExamples';
import IntegrationGuide from './IntegrationGuide';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); history.replaceState(null, '', '/'); });

const figure = (title: string) => screen.getByText(title, { selector: '.op-code-block__title' }).closest('figure')!;
/** 代码块每行一个元素，按行还原原始文本。 */
const code = (title: string) => Array.from(figure(title).querySelectorAll('.op-code-block__line'), line => line.textContent === ' ' ? '' : line.textContent).join('\n');

test('三组主题与时间线步骤完整，本章目录链接均可定位，旧锚点映射到新步骤', async () => {
  history.replaceState(null, '', '/portal/?section=guide');
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: 200, data: { gatewayBaseUrl: 'https://gateway.example.test/context' } })); vi.stubGlobal('fetch', fetchMock);
  render(<CustomerDocuments />);
  const navigation = await screen.findByRole('navigation', { name: '接入指南主题' }, { timeout: 5000 });
  expect(within(navigation).getAllByRole('link').map(link => link.textContent)).toEqual(['快速接入', '接口约定与排障', 'SDK 与工具', 'API 文档 ↗', 'Java SDK 中心 ↗']);
  const journey = screen.getByRole('navigation', { name: '接入步骤' });
  expect(within(journey).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['#credential', '#token', '#invoke', '#signature']);
  for (const [id, title] of [['credential', '获取凭据'], ['token', '换取 Token'], ['invoke', '发起调用'], ['signature', '签名调用']]) {
    expect(document.getElementById(id)?.querySelector('h2')?.textContent).toBe(title);
  }
  expect(screen.getByText('推荐 Bearer Token')).toBeTruthy();
  expect(figure('成功响应')).toBeTruthy();
  expect(screen.getByText('data.accessToken')).toBeTruthy();
  const chapters = screen.getByRole('navigation', { name: '本章目录' });
  for (const link of within(chapters).getAllByRole('link')) {
    const id = link.getAttribute('href')!.slice(1);
    expect(document.getElementById(id)).toBeTruthy();
    fireEvent.click(link);
    expect(location.hash).toBe(`#${id}`);
    expect(document.activeElement?.id).toBe(id);
  }
  expect(screen.getByText(/生成新 Token并撤销旧 Token，没有并行使用宽限期/)).toBeTruthy();
  for (const [hash, title, target] of [['bearer-guide', '快速接入', 'token'], ['guide-identity', '快速接入', 'credential'], ['token-call', '快速接入', 'invoke'], ['hmac-guide', '快速接入', 'signature'], ['token-result', '快速接入', 'token-result'],
    ['guide-response', '接口约定与排障', 'guide-response'], ['guide-errors', '接口约定与排障', 'guide-errors'], ['guide-faq', '接口约定与排障', 'guide-faq'], ['guide-sdk', 'SDK 与工具', 'guide-sdk'], ['sdk-java', 'SDK 与工具', 'sdk-java'], ['guide-updates', 'SDK 与工具', 'guide-updates']]) {
    await act(async () => { location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(screen.getByRole('heading', { name: title, level: 1 })).toBeTruthy();
    expect(document.getElementById(target)).toBeTruthy();
    if (target !== 'guide-sdk') expect(document.activeElement?.id).toBe(target);
  }
  await waitFor(() => expect(code('ApiExample.java · JDK 8+ / OkHttp')).toContain('String baseUrl = "https://gateway.example.test/context"'));
  expect(fetchMock.mock.calls.filter(([url]) => url !== '/portal-api/session')).toHaveLength(1);
});

test('首页三步锚点：挂载前已有 hash 或下一帧经 pushState 写入 hash，都定位到对应步骤', async () => {
  history.replaceState(null, '', '/portal/?section=guide#invoke');
  const first = render(<IntegrationGuide gatewayBaseUrl="" />);
  expect(document.activeElement?.id).toBe('invoke');
  first.unmount();
  history.replaceState(null, '', '/portal/?section=guide');
  render(<IntegrationGuide gatewayBaseUrl="" />);
  history.pushState(null, '', '/portal/?section=guide#token');
  await waitFor(() => expect(document.activeElement?.id).toBe('token'));
});

test('主题切换支持后退；网关地址缺失时示例保留环境变量占位并给出说明', async () => {
  history.replaceState(null, '', '/portal/?section=guide');
  render(<CustomerDocuments />);
  const navigation = await screen.findByRole('navigation', { name: '接入指南主题' }, { timeout: 5000 });
  expect(screen.getByText(/未读取到网关地址：示例使用环境变量 OPEN_PLATFORM_BASE_URL/)).toBeTruthy();
  expect(code('安全运行配置（Shell）')).toContain("OPEN_PLATFORM_BASE_URL='<网关基地址，向平台维护者确认>'");
  fireEvent.click(within(navigation).getByRole('link', { name: '接口约定与排障' }));
  expect(screen.getByRole('heading', { name: '公共响应格式' })).toBeTruthy();
  expect(screen.getByText('code = 200 表示本次 API 调用成功；code ≠ 200 表示调用失败。')).toBeTruthy();
  expect(screen.getByText(/不要通过 resultMsg/)).toBeTruthy();
  expect(screen.getByRole('heading', { name: '公共错误码与排障' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '常见问题' })).toBeTruthy();
  fireEvent.click(within(navigation).getByRole('link', { name: 'SDK 与工具' }));
  expect(screen.getByRole('link', { name: '查看 SDK 版本与发布说明' }).getAttribute('href')).toBe('?section=sdk');
  await act(async () => { history.back(); });
  await waitFor(() => expect(screen.getByRole('heading', { name: '接口约定与排障', level: 1 })).toBeTruthy());
  await act(async () => { location.hash = 'main'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
  expect(screen.getByRole('heading', { name: '接口约定与排障', level: 1 })).toBeTruthy();
  const { curlToken, invokeSamples, javaExample } = guideExamples();
  expect(curlToken).toContain('${OPEN_PLATFORM_BASE_URL%/}/api/token');
  expect(curlToken).toContain('--data-binary @token-request.json');
  expect(invokeSamples[0].code).toContain('Bearer ${OPEN_PLATFORM_TOKEN}');
  expect(invokeSamples.map(sample => sample.label)).toEqual(['cURL', 'Java', 'Python', 'Node.js', 'HTTP']);
  expect(javaExample).toContain('okhttp3.OkHttpClient');
  expect(javaExample).not.toContain('OpenPlatformClient');
  expect(guideExamples('https://gw.example.test/ctx/').invokeSamples[2].code).toContain('"https://gw.example.test/ctx"');
});

test('滚到文档底部时标记最后章节，即使末章不足以滚至顶端', async () => {
  history.replaceState(null, '', '/portal/?section=guide');
  render(<CustomerDocuments />);
  await screen.findByRole('navigation', { name: '接入指南主题' }, { timeout: 5000 });
  vi.stubGlobal('scrollY', 1100);
  vi.stubGlobal('innerHeight', 900);
  const height = vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(2000);
  const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 400 } as DOMRect);
  try {
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.getByRole('navigation', { name: '本章目录' }).querySelector('[aria-current="location"]')?.textContent).toBe('Token 续期与管理'));
  } finally { height.mockRestore(); geometry.mockRestore(); }
});

test('切换调用身份同步请求字段、各语言 Token 示例与服务端核验身份示例', async () => {
  history.replaceState(null, '', '/portal/?section=guide#guide-user-token');
  render(<IntegrationGuide gatewayBaseUrl="https://gateway.example.test" />);
  expect(screen.getByRole('heading', { name: '用户级 Token 与人员委托' })).toBeTruthy();
  expect(figure('获取 Token').textContent).not.toContain('employeeNo');
  fireEvent.click(screen.getByRole('radio', { name: '用户级 Token（代表已获委托的员工）' }));
  expect(screen.getByText('employeeNo', { selector: 'td code' })).toBeTruthy();
  const tokenCode = figure('获取 Token');
  fireEvent.click(within(tokenCode).getByRole('tab', { name: 'Python' }));
  expect(tokenCode.textContent).toContain('payload["employeeNo"] = os.environ["OPEN_PLATFORM_EMPLOYEE_NO"]');
  expect(tokenCode.textContent).toContain('"https://gateway.example.test"');
  fireEvent.click(within(tokenCode).getByRole('tab', { name: '请求 JSON' }));
  expect(tokenCode.textContent).toContain('"employeeNo": "<EMPLOYEE_NO>"');
  expect(code('成功响应')).toContain('employeeId');
  fireEvent.click(screen.getByRole('radio', { name: '应用级 Token（不指定员工）' }));
  expect(tokenCode.textContent).not.toContain('employeeNo');
  expect(code('成功响应')).not.toContain('employeeId');
});

test('HMAC 签名计算器：已知输入得到与共享函数及独立实现一致的签名；Secret 默认遮蔽；全程不发请求、不写地址或存储', async () => {
  history.replaceState(null, '', '/portal/?section=guide#signature');
  const href = location.href;
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const push = vi.spyOn(history, 'pushState'); const replace = vi.spyOn(history, 'replaceState');
  render(<IntegrationGuide gatewayBaseUrl="https://gateway.example.test/context" />);
  expect(screen.getByText(/仅在当前浏览器本地计算：不发送任何请求，不写入地址栏或浏览器存储/)).toBeTruthy();
  const secretInput = screen.getByLabelText('SigningSecret（演示值）') as HTMLInputElement;
  expect(secretInput.type).toBe('password');
  expect((screen.getByLabelText('请求路径') as HTMLInputElement).value).toBe('/context/api/sign/orders/v1/query');
  const secret = Buffer.alloc(32, 9).toString('base64url');
  const input = { path: '/context/api/sign/orders/v1/query', keyId: 'c'.repeat(32), tenantId: 'tenant-9', employeeNo: 'E1001', timestamp: '1700000123', nonce: 'd'.repeat(32), body: '{ "orderNo": "中文 001" }', signingSecret: secret };
  const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fill('keyId', input.keyId); fill('租户 ID', input.tenantId); fill('人员号（可选）', input.employeeNo); fill('时间戳', input.timestamp);
  fill('随机串', input.nonce); fill('请求正文（原样 UTF-8，签名后不得改动）', input.body); fill('SigningSecret（演示值）', secret);
  const expected = await signHmacRequest(input);
  const canonical = ['SZ-HMAC-SHA256', 'POST', input.path, input.keyId, input.tenantId, input.employeeNo, input.timestamp, input.nonce, createHash('sha256').update(input.body).digest('hex')].join('\n');
  expect(expected.canonical).toBe(canonical);
  expect(expected.signature).toBe(createHmac('sha256', Buffer.alloc(32, 9)).update(canonical).digest('hex'));
  expect(await screen.findByText(expected.signature)).toBeTruthy();
  expect(code('待签字符串（9 行，以 LF 连接，末尾无换行）')).toBe(canonical);
  const request = code('签名后的请求');
  expect(request).toContain(`Authorization: SZ-HMAC-SHA256 ${input.keyId}:${expected.signature}`);
  expect(request).toContain('POST https://gateway.example.test/context/api/sign/orders/v1/query');
  expect(request).not.toContain(secret);
  fireEvent.click(screen.getByRole('button', { name: '显示' }));
  expect(secretInput.type).toBe('text');
  fill('时间戳', '1700000123000');
  expect(await screen.findByText(/时间戳须为 UTC 秒（不是毫秒）/)).toBeTruthy();
  fill('SigningSecret（演示值）', 'not-a-secret');
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('43 字符'));
  fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
  fireEvent.click(screen.getByRole('button', { name: '当前时间' }));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(xhr).not.toHaveBeenCalled();
  expect(setItem).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  expect(location.href).toBe(href);
});
