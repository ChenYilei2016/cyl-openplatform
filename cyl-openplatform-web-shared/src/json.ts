const unsupportedBrowser = '当前浏览器不支持保精度 JSON，请更新浏览器后重试。';

/** 用原生数字源码及RawJSON保留契约数值，普通安全整数仍用于分页等计数。 */
export function parseJson<T = unknown>(text: string): T {
  const rawJSON = (JSON as typeof JSON & { rawJSON?: (text: string) => object }).rawJSON;
  if (!rawJSON) throw new Error(unsupportedBrowser);
  try {
    return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
      if (typeof value !== 'number') return value;
      if (!context?.source) throw new Error(unsupportedBrowser);
      return /^-?\d+$/.test(context.source) && Number.isSafeInteger(value) && !Object.is(value, -0)
        ? value : rawJSON(context.source);
    }) as T;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('JSON 内容格式不合法。');
    throw error;
  }
}

export function stringifyJson(value: unknown, space?: number): string {
  const text = JSON.stringify(value, null, space);
  if (text === undefined) throw new Error('JSON 内容不可为空。');
  return text;
}


export function decimalContent(value: unknown): string | null {
  if (typeof value !== 'number' && !(JSON as typeof JSON & { isRawJSON?: (value: unknown) => boolean }).isRawJSON?.(value)) return null;
  const parts = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(stringifyJson(value));
  if (!parts) return null;
  const digits = (parts[2] + (parts[3] ?? '')).replace(/^0+/, '');
  if (!digits) return '0';
  const coefficient = digits.replace(/0+$/, '');
  const exponent = BigInt(parts[4] ?? '0') - BigInt((parts[3] ?? '').length) + BigInt(digits.length - coefficient.length);
  return `${parts[1]}${coefficient}e${exponent}`;
}

export function sameJsonValue(left: unknown, right: unknown): boolean {
  const decimal = decimalContent(left);
  if (decimal !== null) return decimal === decimalContent(right);
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && sameJsonValue(a[key], b[key]));
}
