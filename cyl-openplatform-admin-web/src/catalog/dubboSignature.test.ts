import { expect, test } from 'vitest';
import { parseDubboSignature } from './dubboSignature';

test('两种签名格式按顺序解析，拒绝未擦除泛型和非法类型', () => {
  const expected = { interfaceName: 'com.example.OrderService', method: 'lookup', parameterTypes: ['java.lang.String[]', 'int', 'com.example.Outer$Input'] };
  for (const separator of ['#', '.']) expect(parseDubboSignature(` ${expected.interfaceName}${separator}lookup(java.lang.String[], int, com.example.Outer$Input) `)).toEqual(expected);
  expect(parseDubboSignature('com.example.OrderService.ready()').parameterTypes).toEqual([]);
  expect(() => parseDubboSignature('com.example.OrderService#lookup(java.util.List<Order>)')).toThrow('擦除泛型');
  for (const invalid of ['void', 'String', 'java.lang.String,', '[Ljava.lang.String;'])
    expect(() => parseDubboSignature(`com.example.OrderService#lookup(${invalid})`)).toThrow('类型不合法');
  expect(() => parseDubboSignature(`com.example.OrderService#lookup(${Array(21).fill('int').join(',')})`)).toThrow('最多20项');
});
