import { expect, test } from 'vitest';
import { parseJson, stringifyJson } from '@cyl/open-platform-web-shared/json';
import { httpTemplate, previewHttpRequest } from './httpMapping';
import type { Binding } from './BindingEditor';
import type { Mapping } from './SchemaEditor';

const binding = (url: string, method = 'POST'): Binding => ({ protocol: 'HTTP', timeoutMillis: 3000, http: { url, method } });
test('三个位置同名并存，重复路径变量只编码值一次，保留精确数字', () => {
  const mappings: Mapping[] = [
    { target: 'id', source: 'REQUEST', path: 'pathId', location: 'PATH' },
    { target: 'id', source: 'FIXED', value: 'query+%中', location: 'QUERY' },
    { target: 'id', source: 'FIXED', value: parseJson('9007199254740993'), location: 'BODY' },
  ];
  const result = previewHttpRequest(binding('https://provider.example/orders/{id}/copy/{id}?fixed=a%20b'), mappings, { pathId: '中文 a+b %~' });
  const segment = '%E4%B8%AD%E6%96%87%20a%2Bb%20%25~';
  expect(result.url).toBe(`https://provider.example/orders/${segment}/copy/${segment}?fixed=a%20b&id=query%2B%25%E4%B8%AD`);
  expect(stringifyJson(result.body)).toBe('{"id":9007199254740993}');
});
test('GET正文规则保留并明确阻断，固定编码路径保持原义', () => {
  const mappings: Mapping[] = [{ target: 'id', source: 'FIXED', value: 'body', location: 'BODY' }];
  expect(() => previewHttpRequest(binding('https://provider.example/orders', 'GET'), mappings, {})).toThrow('已有BODY规则保留');
  expect(mappings[0].location).toBe('BODY');
  expect(httpTemplate('https://provider.example/orders/%7Bid%7D').names).toEqual([]);
  const literal = previewHttpRequest(binding('https://provider.example/orders/%7Bid%7D', 'GET'), [{ target: 'id', source: 'FIXED', value: '%' }], {});
  expect(literal.url).toBe('https://provider.example/orders/%7Bid%7D?id=%25');
});
test('非法位置、路径结构和固定query冲突都就近报错', () => {
  for (const url of ['https://{host}/orders', 'https://provider.example/orders?q={id}', 'https://provider.example/orders/{id:[0-9]+}'])
    expect(() => httpTemplate(url)).toThrow();
  for (const value of ['', '.', '..', 'a/b', 'a\\b', null, { id: 1 }])
    expect(() => previewHttpRequest(binding('https://provider.example/orders/{id}'), [{ target: 'id', source: 'FIXED', value, location: 'PATH' }], {})).toThrow('需要非空标量');
  expect(() => previewHttpRequest(binding('https://provider.example/orders?id=fixed'), [{ target: 'id', source: 'FIXED', value: 'query', location: 'QUERY' }], {})).toThrow('固定参数同名');
});

 test('编码后的证明目标仍遵守Provider SDK的8KiB上限', () => {
  expect(() => previewHttpRequest({ protocol: 'HTTP', timeoutMillis:3000, http:{url:'https://internal.example/orders/{id}',method:'GET'} }, [{target:'id',source:'REQUEST',path:'id',location:'PATH'}], {id:'中'.repeat(1000)})).toThrow('8KiB');
 });
