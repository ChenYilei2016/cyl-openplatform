import { afterEach, expect, test, vi } from 'vitest';
import { createRequestKey } from './requestKey';

afterEach(() => vi.unstubAllGlobals());

test('仅有 getRandomValues 时生成符合服务端格式的 UUID v4，保留版本与变体之外的随机位', () => {
  vi.stubGlobal('crypto', {
    getRandomValues: (bytes: Uint8Array) => bytes.fill(0xff),
  });
  expect(createRequestKey()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
});

test('连续请求分别取得安全随机数并生成不同的键', () => {
  const getRandomValues = vi.fn(crypto.getRandomValues.bind(crypto));
  vi.stubGlobal('crypto', { getRandomValues });
  const keys = Array.from({ length: 10 }, createRequestKey);
  expect(new Set(keys).size).toBe(keys.length);
  expect(getRandomValues).toHaveBeenCalledTimes(keys.length);
  for (const key of keys) expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
