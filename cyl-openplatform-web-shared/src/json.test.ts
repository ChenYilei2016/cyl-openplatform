import { expect, test } from 'vitest';
import { parseJson, stringifyJson } from './json';

test('JSON数值及任意字段名透明往返，计数保持安全整数且不污染原型', () => {
  const text = '{"total":20,"code":200,"numbers":[9007199254740993,1.00000000000000001,0.123456789012345678901,1e999,1e-999,-0],"__proto__":{"polluted":true},"value":{"isLosslessNumber":true,"rawJSON":"ordinary-field","amount":1}}';
  const value = parseJson<{ total: number; code: number }>(text);
  expect(value.total).toBe(20);
  expect(value.code).toBe(200);
  expect(stringifyJson(value)).toBe(text);
  expect(Object.hasOwn(value, '__proto__')).toBe(true);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

test('浏览器缺少原生保精度能力时明确拒绝，不回退成有损解析', () => {
  const descriptor = Object.getOwnPropertyDescriptor(JSON, 'rawJSON')!;
  try {
    Object.defineProperty(JSON, 'rawJSON', { ...descriptor, value: undefined });
    expect(() => parseJson('{"value":9007199254740993}')).toThrow('请更新浏览器');
  } finally { Object.defineProperty(JSON, 'rawJSON', descriptor); }
});
