import { afterEach, expect, test, vi } from 'vitest';
import type { Binding } from '../catalog/BindingEditor';
import { stringifyJson } from '@cyl/open-platform-web-shared/json';
import { parseHttpRequestSource } from './httpRequestSource';

const curl = (body: string) => `curl 'https://internal.example/orders' -H 'Content-Type: application/json' --data-raw '${body}'`;
afterEach(() => vi.unstubAllGlobals());

test('常见cURL仅离线生成HTTP绑定与样例结构，生成同名参数映射，不臆造外部标识、权限或响应', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const result = parseHttpRequestSource(`curl \\\n    --url 'https://internal.example/orders?region=cn' \\\n    -X POST -H 'Content-Type: application/json' \\\n    -d '{"orderNo":"ORDER-1","count":2,"enabled":true,"address":{"city":"上海"},"items":[{"sku":"A"},{"sku":"B"}]}'`);
  expect(result.definition.binding).toEqual({ protocol: 'HTTP', timeoutMillis: 3000,
    http: { method: 'POST', url: 'https://internal.example/orders?region=cn' } });
  expect(result.definition.requestSchema?.properties?.orderNo).toEqual({ type: 'STRING', required: false });
  expect(result.definition.requestSchema?.properties?.count.type).toBe('INTEGER');
  expect(result.definition.requestSchema?.properties?.enabled.type).toBe('BOOLEAN');
  expect(result.definition.requestSchema?.properties?.items.items?.properties?.sku.type).toBe('STRING');
  for (const field of ['service', 'version', 'method', 'scopeCodes', 'responseSchema']) expect(result.definition).not.toHaveProperty(field);
  expect(result.definition.mappings).toEqual(['address','count','enabled','items','orderNo'].map(path => ({target:path,source:'REQUEST',path,location:'BODY'})));
  expect(result.warnings.join(' ')).toContain('人工确认');
  expect(result.warnings.join(' ')).toContain('响应结构必须另行补充');
  expect(fetch).not.toHaveBeenCalled();
});

test.each(['-d', '--data', '--data-raw', '--data-binary'])('%s支持字面JSON消息体并默认POST', option => {
  const result = parseHttpRequestSource(`curl https://internal.example/orders ${option} '{"count":1}'`);
  expect(result.definition.binding).toMatchObject({ http: { method: 'POST' } });
});

test('支持长选项等号及紧邻短选项，多个数组样例字段顺序不同不丢结构', () => {
  const result = parseHttpRequestSource(`curl --url=https://internal.example/orders -XPATCH -H'Content-Type: application/json' --data-raw='{"items":[{"sku":"A","count":1},{"count":2,"sku":"B"}]}'`);
  expect(result.definition.binding).toMatchObject({ http: { method: 'PATCH' } });
  expect(Object.keys(result.definition.requestSchema?.properties?.items.items?.properties ?? {})).toEqual(['count', 'sku']);
});

test('原始HTTP相对路径由Host生成地址且明确要求核对HTTPS', () => {
  const result = parseHttpRequestSource('POST /orders HTTP/1.1\r\nHost: internal.example:8080\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"orderNo":"A"}');
  expect(result.definition.binding).toMatchObject({ http: { url: 'http://internal.example:8080/orders', method: 'POST' } });
  expect(result.warnings.some(warning => warning.includes('https://'))).toBe(true);
});

test('原始HTTP绝对URL及无消息体GET可解析，不从缺少的消息体臆造业务参数', () => {
  const result = parseHttpRequestSource('GET https://internal.example/orders?status=open HTTP/1.1\nHost: internal.example\n\n');
  expect(result.definition.binding).toMatchObject({ http: { method: 'GET', url: 'https://internal.example/orders?status=open' } });
  expect(result.definition.requestSchema).toEqual({ type: 'OBJECT', required: false, properties: {}, example: {} });
});

test('认证、Cookie与秘密头值完全不进入候选和警告，其他自定义头明确提示未导入', () => {
  const result = parseHttpRequestSource(`curl https://internal.example/orders -H 'Authorization: Bearer bearer-private' -H 'Cookie: session=cookie-private' -H 'X-Api-Key: key-private' -H 'X-Business-Tag: custom-header-value' -d '{"orderNo":"A"}'`); // gitleaks:allow -- fabricated secret-stripping test vector
  const output = stringifyJson(result);
  for (const secret of ['bearer-private', 'cookie-private', 'key-private', 'custom-header-value']) expect(output).not.toContain(secret);
  expect(result.warnings.join(' ')).toContain('秘密请求头已忽略');
  expect(result.warnings.join(' ')).toContain('其他请求头未导入');
});

test('大整数、高精度小数及负零保留原始数值，结构推断不把RawJSON当对象', () => {
  const result = parseHttpRequestSource(curl('{"orderNumber":9223372036854775807,"amount":0.123456789012345678901,"negativeZero":-0}'));
  expect(result.definition.requestSchema?.properties?.orderNumber.type).toBe('INTEGER');
  expect(result.definition.requestSchema?.properties?.amount.type).toBe('NUMBER');
  expect(stringifyJson(result.definition.requestSchema?.example)).toBe('{"orderNumber":9223372036854775807,"amount":0.123456789012345678901,"negativeZero":-0}');
});

test.each([
  '{"tenantId":"101"}', '{"nested":{"employee_no":"E1"}}', '{"items":[{"appKey":"a"}]}',
  '{"password":"body-private"}', '{"access_token":"body-private"}', '{"nested":{"apiSecret":"body-private"}}',
  '{"t\\u0065nantId":"101"}', '{"hidden":{"token":"body-private"},"hidden":{}}',
])('身份或秘密body字段阻断，含转义键或重复键隐藏的字段：%s', body => {
  expect(() => parseHttpRequestSource(curl(body))).toThrow(/身份或秘密/);
  try { parseHttpRequestSource(curl(body)); } catch (failure) { expect((failure as Error).message).not.toContain('body-private'); }
});

test.each([
  'curl https://internal.example/orders | cat',
  'curl https://internal.example/orders && echo done',
  'curl https://internal.example/orders > output.json',
  'curl "$API_URL"',
  'curl $(cat url.txt)',
  'curl `cat url.txt`',
  'curl https://internal.example/orders -d @body.json',
  'curl https://internal.example/orders -H @headers.txt',
  'curl https://internal.example/orders -F value=1',
  'curl https://internal.example/orders --data-urlencode value=1',
  'curl https://internal.example/orders --insecure',
  'curl https://internal.example/orders --location',
  'curl https://internal.example/orders\n-H "X-Test: 1"',
  'curl "https://internal.example/orders',
  'curl https://internal.example/orders # comment',
  'curl https://internal.example/orders https://another.example/orders',
  'curl https://internal.example/orders -d "{}" -d "{}"',
  'curl https://internal.example/orders -X POST -X PUT',
  'curl file:///tmp/body.json',
  'curl /relative/path',
])('不支持的shell语法、文件、表单或选项明确拒绝：%s', source => {
  expect(() => parseHttpRequestSource(source)).toThrow();
});

test.each([
  'curl https://name:private@internal.example/orders',
  "curl 'https://internal.example/orders?access_token=private'",
  "curl 'https://internal.example/orders?tenant_id=101'",
  'POST /orders HTTP/1.1\n\n{}',
  'POST https://internal.example/orders HTTP/1.1\nHost: other.example\n\n{}',
  'POST /orders HTTP/1.1\nHost: internal.example\nHost: other.example\n\n{}',
  'POST /orders HTTP/1.1\nHost: internal.example\nContent-Type: application/x-www-form-urlencoded\n\ncount=1',
  'POST /orders HTTP/1.1\nHost: internal.example\nTransfer-Encoding: chunked\n\n0',
  'curl https://internal.example/orders -X GET -d "{}"',
  'curl https://internal.example/orders -X HEAD',
  'GET http://$HOST/orders HTTP/1.1',
])('拒绝含秘密/歧义URL、非JSON和无法保持语义的HTTP请求：%s', source => {
  expect(() => parseHttpRequestSource(source)).toThrow();
});

test('不将单引号JSON内的反斜杠换行误删为合法值', () => {
  expect(() => parseHttpRequestSource(curl('{"value":"before\\\nafter"}'))).toThrow('单引号内容');
});

test.each(['[]', '1', '{"items":[]}', '{"unknown":null}', '{"items":[1,"2"]}', '{"items":[{"a":1},{"b":2}]}', '{"count":1,"count":2}', '{"bad.key":1}', '{"__proto__":{}}'])('不能无损推断的消息体明确拒绝：%s', body => {
  expect(() => parseHttpRequestSource(curl(body))).toThrow();
});

test('输入按UTF-8限制256KiB，结构按节点、深度及字段数量限制', () => {
  expect(() => parseHttpRequestSource(curl(`{"value":"${'中'.repeat(90_000)}"}`))).toThrow('256KiB');
  expect(() => parseHttpRequestSource(curl('{"nested":'.repeat(9) + '{}' + '}'.repeat(9)))).toThrow('8层');
  expect(() => parseHttpRequestSource(curl(stringifyJson(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`field${i}`, i])))))).toThrow('50个字段');
  expect(() => parseHttpRequestSource(curl(stringifyJson({ items: Array.from({ length: 201 }, () => 1) })))).toThrow('200个节点');
});

 test('路径模板与正文位置分别保留，旧编码花括号仍为固定字面路径', () => {
  const result = parseHttpRequestSource(curl('{"id":"body-id"}').replace('/orders', '/orders/{id}'));
  expect((result.definition.binding as Binding).http?.url).toBe('https://internal.example/orders/{id}');
  expect(result.definition.mappings).toEqual([
    {target:'id', source:'REQUEST', path:'id', location:'BODY'},
    {target:'id', source:'REQUEST', path:'id', location:'PATH'},
  ]);
  expect(parseHttpRequestSource("curl 'https://internal.example/orders/%7Bid%7D'").definition.mappings).toEqual([]);
  expect(() => parseHttpRequestSource("curl 'https://{host}/orders'")).toThrow();
 });
