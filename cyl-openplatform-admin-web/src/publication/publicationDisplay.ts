/** 管理差异也不展示凭据正文；比较始终使用原值，仅在渲染时脱敏。 */
const sensitiveName = (name: string) => /^(?:authorization|cookie|setcookie|password|passwd|secret|appsecret|signingsecret|token|accesstoken|refreshtoken|apikey|xapikey|xszsignature|clientsecret|credential|credentials|accesskey|secretkey|privatekey|accesskeyid|accesskeysecret)$/i.test(name.replace(/[-_]/g, ''));

export function publicationDisplay<T>(value: T, root: 'definition' | 'schema' = 'definition'): T {
  const visit = (current: unknown, kind: 'definition' | 'schema' | 'fields' | 'value', privateField = false): unknown => {
    if (current === null || current === undefined) return current;
    if (typeof current === 'string') {
      let text = current.replace(/\bBearer\s+[^\s"',}]+/gi, 'Bearer [已隐藏]');
      if (/^https?:\/\//i.test(text)) {
        try {
          const url = new URL(text);
          let changed = false;
          for (const key of new Set(url.searchParams.keys())) {
            if (sensitiveName(key)) { url.searchParams.set(key, '[已隐藏]'); changed = true; }
          }
          if (url.username || url.password) { url.username = '[已隐藏]'; url.password = ''; changed = true; }
          if (changed) text = url.toString();
        } catch { /* 非URL正文保持原文；原始绑定格式由后端验证。 */ }
      }
      return text;
    }
    if (typeof current !== 'object' || (JSON as typeof JSON & { isRawJSON?: (value: unknown) => boolean }).isRawJSON?.(current)) return current;
    if (Array.isArray(current)) return current.map(item => visit(item, 'value'));
    const object = current as Record<string, unknown>;
    if (kind === 'fields') return Object.fromEntries(Object.entries(object).map(([name, field]) => [name, visit(field, 'schema', privateField || sensitiveName(name))]));
    const fixedSecret = object.source === 'FIXED' && typeof object.target === 'string' && object.target.split('.').some(sensitiveName);
    return Object.fromEntries(Object.entries(object).map(([key, entry]) => {
      if (kind === 'definition' && ['requestSchema', 'responseSchema'].includes(key)) return [key, visit(entry, 'schema')];
      if (kind === 'schema' && key === 'properties') return [key, visit(entry, 'fields', privateField)];
      if (kind === 'schema' && key === 'items') return [key, visit(entry, 'schema', privateField)];
      const secret = sensitiveName(key) || (fixedSecret && key === 'value') || (privateField && ['defaultValue', 'example', 'enumValues'].includes(key));
      return [key, secret && entry != null ? '[已隐藏]' : visit(entry, 'value')];
    }));
  };
  return visit(value, root) as T;
}

/** 发布与跨环境记录的时间统一按 24 小时制本地时间显示。 */
export const publicationTime = (value: string) =>
  Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "时间无效";
