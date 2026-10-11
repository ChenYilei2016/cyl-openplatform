import { parse as parseShell } from 'shell-quote';
import { parseJson, stringifyJson } from '@cyl/open-platform-web-shared/json';
import type { SchemaNode } from '@cyl/open-platform-web-shared/documentation/types';
import type { ApiDefinition } from '../catalog/CatalogPanel';
import { newBinding } from '../catalog/BindingEditor';
import { httpTemplate } from '../catalog/httpMapping';

const identityFields = new Set(['applicationid', 'appkey', 'tenantid', 'userid', 'employeeid', 'employeeno']);
const sensitiveName = (name: string) => {
  const normalized = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return identityFields.has(normalized) || /authorization|cookie|password|passwd|secret|token|credential|apikey|accesskey|privatekey|sessionid|csrf|signature/.test(normalized);
};

/** 只验证受支持的shell外形；分词交给shell-quote，绝不求值、执行或读取文件。 */
function curlTokens(source: string): string[] {
  if (/[$`]/.test(source)) throw new Error('不支持变量、命令替换或脚本，请粘贴脱敏后的字面请求。');
  let quote = '';
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (escaped) { escaped = false; continue; }
    if (quote === "'" && char === '\\' && source[index + 1] === '\n') throw new Error('单引号内容中的反斜杠换行不能作为shell续行，请提供合法JSON字面值。');
    if (char === '\\' && quote !== "'") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ''; }
    else if (char === '"' || char === "'") quote = char;
    else if (char === '\n') throw new Error('cURL仅支持一条命令；换行请使用反斜杠续行。');
  }
  if (quote || escaped) throw new Error('cURL引号或转义未闭合，请检查请求文本。');
  const tokens = parseShell(source.replace(/\\\n/g, ''), () => { throw new Error('不支持环境变量。'); });
  if (tokens.some(token => typeof token !== 'string')) throw new Error('不支持管道、重定向、通配符或注释脚本；带查询参数的URL请加引号。');
  return tokens as string[];
}

function requestSchema(body: string): SchemaNode {
  // shared JSON解析保留数值；预检防止重复键被JSON.parse覆盖，以及深层/隐藏身份字段被遗漏。
  const containers: (Set<string> | null)[] = [];
  for (const match of body.matchAll(/"(?:\\.|[^"\\])*"\s*(:)?|[{}\[\]]/g)) {
    const token = match[0];
    if (token === '{' || token === '[') {
      containers.push(token === '{' ? new Set<string>() : null);
      if (containers.length > 8) throw new Error('请求样例嵌套不能超过8层，请缩小样例后人工补齐。');
    } else if (token === '}' || token === ']') containers.pop();
    else if (match[1]) {
      const name: string = JSON.parse(token.slice(0, token.lastIndexOf(':')).trim());
      if (sensitiveName(name)) throw new Error('请求消息体包含身份或秘密字段，请先脱敏；身份映射须人工配置。');
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)) throw new Error('样例字段名不符合平台规则，请人工调整字段与映射。');
      const names = containers[containers.length - 1];
      if (names?.has(name)) throw new Error('JSON样例包含重复字段，请明确保留的字段后重试。');
      names?.add(name);
      if (names && names.size > 50) throw new Error('单个对象不能超过50个字段。');
    }
  }
  let sample: unknown;
  try { sample = parseJson(body || '{}'); }
  catch { throw new Error('消息体必须是合法JSON对象；不支持表单或脚本文本。'); }
  const isRawNumber = (value: unknown) => (JSON as typeof JSON & { isRawJSON(value: unknown): boolean }).isRawJSON(value);
  if (!sample || typeof sample !== 'object' || Array.isArray(sample) || isRawNumber(sample)) {
    throw new Error('消息体仅支持JSON对象，不支持数组或单个值作为根节点。');
  }
  let nodes = 0;
  const infer = (value: unknown, depth: number): SchemaNode => {
    if (depth > 8 || ++nodes > 200) throw new Error('请求样例超过8层或200个节点，请缩小样例后人工补齐。');
    if (value === null) throw new Error('null不能确定字段类型，请提供非空样例或手动配置。');
    if (typeof value === 'number' || isRawNumber(value)) return { type: /^-?\d+$/.test(stringifyJson(value)) ? 'INTEGER' : 'NUMBER', required: false };
    if (typeof value === 'boolean') return { type: 'BOOLEAN', required: false };
    if (typeof value === 'string') {
      if (value.length > 10_000) throw new Error('样例字符串不能超过10000个字符。');
      return { type: 'STRING', required: false };
    }
    if (Array.isArray(value)) {
      if (!value.length) throw new Error('空数组不能确定元素类型，请提供代表性样例或手动配置。');
      const items = value.map(item => infer(item, depth + 1));
      if (items.some(item => stringifyJson(item) !== stringifyJson(items[0]))) throw new Error('数组样例包含不同类型或结构，请人工确认完整元素结构。');
      return { type: 'ARRAY', required: false, items: items[0] };
    }
    return { type: 'OBJECT', required: false, properties: Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right)).map(([name, child]) => [name, infer(child, depth + 1)])) };
  };
  return { ...infer(sample, 1), example: sample };
}

/** 离线解析受支持的脱敏cURL/原始HTTP，仅产生待人工确认的草稿候选。 */
export function parseHttpRequestSource(text: string): { definition: Partial<ApiDefinition>; warnings: string[] } {
  if (new TextEncoder().encode(text).length > 256 * 1024) throw new Error('请求来源不能超过256KiB，请缩小样例。');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('请求文本包含不支持的控制字符。');
  const source = text.replace(/\r\n/g, '\n').trim();
  if (!source) throw new Error('请粘贴脱敏的cURL或原始HTTP请求。');
  const warnings = ['仅离线解析，尚未调用该地址；内部地址和方法、对外标识、权限组仍需人工确认；已按消息体字段生成同名参数映射，可在对内配置调整。',
    '字段类型由样例推测，必填、约束、精确数值和数组完整结构需人工确认；响应结构必须另行补充。'];
  let url = '';
  let method = '';
  let body = '';
  const headers: string[] = [];
  if (/^curl(?:\s|$)/.test(source)) {
    const tokens = curlTokens(source);
    let hasBody = false;
    for (let index = 1; index < tokens.length; index++) {
      const token = tokens[index];
      const option = token.match(/^(--(?:request|header|data|data-raw|data-binary|url))=(.*)$/s)
        ?? token.match(/^(-[XHd])(.+)$/s);
      const name = option?.[1] ?? token;
      if (['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--url'].includes(name)) {
        const value = option ? option[2] : tokens[++index];
        if (value === undefined || value.startsWith('@')) throw new Error('选项缺少字面值，或使用了不支持的文件引用。');
        if (name === '-X' || name === '--request') {
          if (method) throw new Error('不支持重复指定请求方法。');
          method = value;
        } else if (name === '-H' || name === '--header') headers.push(value);
        else if (name === '--url') {
          if (url) throw new Error('一次只支持一个URL。');
          url = value;
        } else {
          if (hasBody) throw new Error('不支持多段消息体，请合并为一个JSON对象。');
          hasBody = true; body = value;
        }
      } else if (/^https?:\/\//i.test(token)) {
        if (url) throw new Error('一次只支持一个URL。');
        url = token;
      } else throw new Error('存在不支持的cURL选项或位置参数，请改用手动配置。');
    }
    method ||= hasBody ? 'POST' : 'GET';
  } else {
    const lines = source.split('\n');
    const first = lines.shift()?.match(/^([A-Z]+) (\S+) HTTP\/(?:1\.[01]|2(?:\.0)?)$/);
    if (!first) throw new Error('原始HTTP须以“METHOD /path HTTP/1.1”请求行开始。');
    method = first[1]; url = first[2];
    const separator = lines.indexOf('');
    headers.push(...(separator < 0 ? lines : lines.slice(0, separator)));
    body = separator < 0 ? '' : lines.slice(separator + 1).join('\n');
  }
  let host = '';
  for (const header of headers) {
    const parts = header.match(/^([!#$%&'*+.^_`|~a-zA-Z0-9-]+):[ \t]*([^\r\n]*)$/);
    if (!parts) throw new Error('请求头格式不支持，请使用单行“名称: 值”，不支持文件头或折行。');
    const name = parts[1].toLowerCase();
    const value = parts[2].trim();
    if (name === 'host') {
      if (host) throw new Error('Host不能重复。');
      host = value;
    } else if (name === 'content-type') {
      if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(value)) {
        throw new Error('仅支持JSON消息体，不支持表单或其他内容类型。');
      }
      if (!/^application\/json(?:\s*;|$)/i.test(value)) warnings.push('HTTP绑定使用application/json，不保留来源中的自定义JSON媒体类型，请确认提供方要求。');
    } else if (name === 'transfer-encoding' || name === 'content-encoding') {
      throw new Error('不支持分块或编码后的消息体，请提供解码后的JSON请求。');
    } else if (sensitiveName(name)) warnings.push('认证、Cookie、身份或秘密请求头已忽略，不会进入候选配置。');
    else warnings.push('样例中的其他请求头未导入；当前HTTP绑定不承载自定义请求头，请人工确认。');
  }
  if (url.startsWith('/') && !url.startsWith('//')) {
    if (!host || /[\s/@?#\\]/.test(host)) throw new Error('相对路径需要合法Host请求头。');
    url = `http://${host}${url}`;
    warnings.push('原始HTTP未声明协议，暂按http://生成地址；请向提供方确认是否应改为https://。');
  }
  if (!/^https?:\/\//i.test(url) || /[\s\\$`]/.test(url)) throw new Error('仅支持绝对HTTP(S)地址，不支持相对地址或变量。');
  let target: URL;
  try { target = new URL(url); } catch { throw new Error('内部HTTP地址格式不合法。'); }
  if (target.username || target.password || target.hash) throw new Error('URL不能包含认证信息或片段，请先脱敏。');
  const template = httpTemplate(url);
  if (host && target.host.toLowerCase() !== host.toLowerCase()) throw new Error('Host与URL目标不一致，请明确真实地址。');
  if ([...target.searchParams.keys()].some(sensitiveName)) throw new Error('URL查询参数包含身份或秘密字段，请先脱敏。');
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('平台HTTP绑定仅支持GET、POST、PUT、PATCH、DELETE。');
  if (body.trim() && ['GET', 'DELETE'].includes(method)) throw new Error('平台GET/DELETE使用查询参数，不能直接导入JSON消息体，请人工确认映射。');
  if (body.trim() && !headers.some(header => /^content-type:/i.test(header))) warnings.push('来源未声明Content-Type；样例按JSON解释，请确认提供方接受application/json。');
  const schema = requestSchema(body);
  const mappings: NonNullable<ApiDefinition['mappings']> = Object.keys(schema.properties ?? {}).map(path => ({ target: path, source: 'REQUEST', path, location: 'BODY' }));
  for (const name of template.names) {
    const requestField = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name) && !sensitiveName(name);
    if (requestField) schema.properties = { ...schema.properties, [name]: schema.properties?.[name] ?? { type: 'STRING', required: true } };
    mappings.push({ target: name, source: 'REQUEST', path: requestField ? name : null, location: 'PATH' });
  }
  if (template.names.length) warnings.push('路径变量已单独生成PATH规则；来源只是同名字段建议，请核对实际来源并补充请求样例。');
  return { definition: { protocol: 'HTTP', binding: { ...newBinding('HTTP'), http: { url: template.names.length ? url : target.href, method } }, requestSchema: schema, mappings }, warnings: [...new Set(warnings)] };
}
