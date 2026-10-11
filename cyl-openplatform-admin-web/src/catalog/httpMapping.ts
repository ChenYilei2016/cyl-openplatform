import { decimalContent, stringifyJson, sameJsonValue } from '@cyl/open-platform-web-shared/json';
import type { SchemaNode } from '@cyl/open-platform-web-shared/documentation/types';
import type { Mapping } from './SchemaEditor';
import type { Binding } from './BindingEditor';
import { sampleAt } from './sampleSchema';

export type HttpLocation = 'PATH' | 'QUERY' | 'BODY';
export const hasJsonBody = (method: string) => ['POST', 'PUT', 'PATCH'].includes(method);
export const mappingLocation = (mapping: Mapping, method: string): HttpLocation => mapping.location ?? (hasJsonBody(method) ? 'BODY' : 'QUERY');
export function switchHttpMethodMappings(mappings: Mapping[], before: string, after: string, original: Mapping[] = [], originalMethod?: string): Mapping[] {
  return mappings.map(mapping => {
    const next = mapping.location == null ? { ...mapping, location: mappingLocation(mapping, before) } : mapping;
    if (after !== originalMethod) return next;
    const baseline = original.find(item => item.location == null && mappingLocation(item, after) === next.location
      && sameJsonValue({ ...item, location: null, path: item.path ?? null, value: item.value ?? null }, { ...next, location: null, path: next.path ?? null, value: next.value ?? null }));
    return baseline ?? next;
  });
}
const variable = /\{([a-zA-Z_][a-zA-Z0-9_]{0,63})}/g;
export const httpBindingTemplate = (http: NonNullable<Binding['http']>) => http.targetMode === 'SERVICE_NAME' ? 'http://discovery.invalid' + (http.path ?? '') : http.url ?? '';
export const httpTargetLabel = (http: Pick<NonNullable<Binding['http']>, 'url' | 'targetMode' | 'serviceName' | 'path'>) => http.targetMode === 'SERVICE_NAME' ? `服务名 ${http.serviceName || '未填写'} · ${http.path || '路径未填写'}` : http.url ?? '';

export function httpTemplate(url: string) {
  if (url.length > 2000 || /[\s\\]/.test(url) || /%(?![0-9a-fA-F]{2})/.test(url)) throw new Error('地址不超过2000字符；空格和百分号请使用有效URL编码。');
  const parts = /^(https?:\/\/)([^/?#]+)([^?#]*)(\?[^#]*)?$/i.exec(url);
  if (!parts || /[{}]/.test(parts[2] + (parts[4] ?? ''))) throw new Error('使用固定HTTP(S)主机；{name}仅可出现在路径中。');
  const target = new URL(url.replaceAll('{', '%7B').replaceAll('}', '%7D'));
  if (target.username || target.password || target.hash || target.port === '0') throw new Error('地址不能含账号密码、fragment或无效端口。');
  const names = [...new Set([...parts[3].matchAll(variable)].map(match => match[1]))];
  if (names.length > 100) throw new Error('路径变量超过100项映射上限。');
  if (/[{}]/.test(parts[3].replace(variable, ''))) throw new Error('只支持普通{name}路径变量，不支持正则或URI模板表达式。');
  return { names, target, path: parts[3] || '/', query: parts[4] ?? '', origin: target.origin };
}

const encode = (text: string) => encodeURIComponent(text).replace(/[!'()*]/g, value => '%' + value.charCodeAt(0).toString(16).toUpperCase());
function scalar(value: unknown): string | null {
  if (decimalContent(value) !== null) return stringifyJson(value);
  return typeof value === 'string' || typeof value === 'boolean' ? String(value) : null;
}
function setField(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  for (const part of parts.slice(0, -1)) {
    if (!Object.hasOwn(target, part)) target[part] = Object.create(null) as Record<string, unknown>;
    if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) throw new Error('同一位置的映射目标重复或相互覆盖。');
    target = target[part] as Record<string, unknown>;
  }
  const key = parts.at(-1)!;
  if (Object.hasOwn(target, key)) throw new Error('同一位置的映射目标重复或相互覆盖。');
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

/** 已应用配置＋公开样例；身份是明确的预览占位，永不作为调用身份发送。 */
export function previewHttpRequest(binding: Binding, mappings: Mapping[], sample: unknown) {
  const http = binding.http!;
  if (http.targetMode === 'SERVICE_NAME' && (!http.serviceName || !http.path?.startsWith('/') || http.path.startsWith('//'))) throw new Error('请填写当前环境服务名与以单个/开头的请求路径。');
  const template = httpTemplate(httpBindingTemplate(http));
  const buckets: Record<HttpLocation, Record<string, unknown>> = { PATH: Object.create(null), QUERY: Object.create(null), BODY: Object.create(null) };
  const identity: Record<string, string> = { applicationId: 'sample-application', appKey: 'sample-app-key', tenantId: 'sample-tenant',
    userId: 'sample-user', employeeId: 'sample-employee', employeeNo: 'sample-employee-no' };
  for (const mapping of mappings) {
    const location = mappingLocation(mapping, http.method);
    if (!mapping.target) throw new Error('先填写映射目标。');
    let value: unknown;
    if (mapping.source === 'FIXED') value = mapping.value;
    else if (mapping.source === 'CONTEXT') value = identity[mapping.path ?? ''];
    else {
      try { value = sampleAt(sample, mapping.path ?? ''); }
      catch { if (location === 'PATH') throw new Error(`路径变量 ${mapping.target} 缺少样例值，请补充公开样例或选择字段。`); else continue; }
    }
    if (location === 'PATH' && !template.names.includes(mapping.target)) throw new Error(`路径已移除 ${mapping.target}，请清理旧PATH规则。`);
    setField(buckets[location], mapping.target, value);
  }
  if (!hasJsonBody(http.method) && mappings.some(mapping => mappingLocation(mapping, http.method) === 'BODY'))
    throw new Error(`${http.method} 不支持正文；已有BODY规则保留，先迁移到Query或移除。`);
  let path = template.path;
  for (const name of template.names) {
    const value = scalar(buckets.PATH[name]);
    if (value === null || !value || /[/\\]/.test(value) || value === '.' || value === '..') throw new Error(`路径变量 ${name} 需要非空标量，不允许斜杠、反斜杠或独立 . / .. 段。`);
    path = path.replaceAll(`{${name}}`, encode(value));
  }
  const query = template.query ? [template.query.slice(1)] : [];
  for (const [name, value] of Object.entries(buckets.QUERY)) {
    if (template.target.searchParams.has(name)) throw new Error(`Query ${name} 与URL中的固定参数同名，请先调整。`);
    query.push(`${encode(name)}=${encode(scalar(value) ?? stringifyJson(value))}`);
  }
  path = path.replace(/[^\x00-\x7f]/gu, value => encode(value));
  const encodedQuery = query.join('&').replace(/[^\x00-\x7f]/gu, value => encode(value));
  const url = template.origin + path + (encodedQuery ? '?' + encodedQuery : '');
  if (url.slice(template.origin.length).length > 8192) throw new Error('最终HTTP路径和query超过8KiB限制。');
  return { method: http.method, url: http.targetMode === 'SERVICE_NAME' ? `[${http.serviceName} → 当前环境实例]` + url.slice(template.origin.length) : url,
    path, query: encodedQuery, body: hasJsonBody(http.method) ? buckets.BODY : null };
}

export function schemaPreviewSample(schema: SchemaNode): unknown {
  if (schema.example !== undefined && schema.example !== null) return schema.example;
  if (schema.defaultValue !== undefined && schema.defaultValue !== null) return schema.defaultValue;
  if (schema.enumValues?.length) return schema.enumValues[0];
  if (schema.type === 'OBJECT') return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([name, child]) => [name, schemaPreviewSample(child)]));
  if (schema.type === 'ARRAY') return schema.items ? [schemaPreviewSample(schema.items)] : [];
  return schema.type === 'BOOLEAN' ? false : ['INTEGER', 'NUMBER'].includes(schema.type) ? 1 : 'sample';
}
