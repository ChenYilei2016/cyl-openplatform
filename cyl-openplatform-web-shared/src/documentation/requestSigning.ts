/**
 * HMAC 请求签名（98 协议）：规范串与网关 `SignedRequest.verifies`、门户 `HmacExample.java`
 * （`okhttpJavaExample(..., 'HMAC')`）逐行一致。只用 Web Crypto 在本地计算，不发起请求、不保存输入。
 */
export const hmacScheme = 'SZ-HMAC-SHA256';

/** 网关 `SignatureRequestReader` 接受的格式；不满足时网关在验签前即拒绝。 */
const formats = {
  keyId: /^[a-f0-9]{32}$/,
  subject: /^[\x21-\x2B\x2D-\x7E]{1,64}$/,
  timestamp: /^[1-9][0-9]{0,10}$/,
  nonce: /^[0-9a-f]{32}$/,
  path: /^(?:\/[A-Za-z0-9_.~!$&'()*+,=:@-]+)*\/api\/sign\/[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,31}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/,
  secret: /^[A-Za-z0-9_-]{43}$/,
};

export interface HmacSigningInput {
  /** 实际请求路径，包含部署前缀，如 `/context/api/sign/orders/v1/query`。 */
  path: string;
  keyId: string;
  tenantId: string;
  /** 可选人员号；为空时规范串保留空行。 */
  employeeNo?: string;
  /** UTC 秒。 */
  timestamp: string;
  nonce: string;
  /** 原样发送的 UTF-8 正文；签名后不得重新序列化。 */
  body: string;
  /** Base64URL（无填充）编码的 32 字节 SigningSecret。 */
  signingSecret: string;
}

export interface HmacSignature {
  bodyHash: string;
  canonical: string;
  signature: string;
  /** 实际请求需要携带的认证头（不含 Content-Type）。 */
  headers: Record<string, string>;
}

/** 列出网关会拒绝的字段；只做格式提示，不代表凭据有效或已授权。 */
export function hmacInputProblems(input: HmacSigningInput): string[] {
  const problems: string[] = [];
  if (!formats.path.test(input.path) || /\/\.\.?(?:\/|$)/.test(input.path)) problems.push('路径须为实际 /api/sign/{服务}/{版本}/{操作}，可带部署前缀，不含查询串、编码或点段。');
  if (!formats.keyId.test(input.keyId)) problems.push('keyId 须为 32 位小写十六进制。');
  if (!formats.subject.test(input.tenantId)) problems.push('租户 ID 须为 1–64 个可见 ASCII 字符，不含空白和逗号。');
  if (input.employeeNo && !formats.subject.test(input.employeeNo)) problems.push('人员号须为 1–64 个可见 ASCII 字符，不含空白和逗号。');
  if (!formats.timestamp.test(input.timestamp)) problems.push('时间戳须为 UTC 秒（不是毫秒），且不能以 0 开头。');
  if (!formats.nonce.test(input.nonce)) problems.push('随机串须为 32 位小写十六进制，每次请求重新生成。');
  return problems;
}

/** SigningSecret 按 Base64URL 解码为 32 字节；非规范编码返回 undefined。 */
export function decodeSigningSecret(secret: string): Uint8Array<ArrayBuffer> | undefined {
  if (!formats.secret.test(secret)) return undefined;
  const binary = atob(secret.replaceAll('-', '+').replaceAll('_', '/') + '=');
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const canonical = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return bytes.length === 32 && canonical === secret ? bytes : undefined;
}

/** 9 行规范串，单个 LF 连接，末尾无 LF；方法固定 POST。 */
export function hmacCanonical(input: Omit<HmacSigningInput, 'body' | 'signingSecret'>, bodyHash: string): string {
  return [hmacScheme, 'POST', input.path, input.keyId, input.tenantId, input.employeeNo || '', input.timestamp, input.nonce, bodyHash].join('\n');
}

const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** 计算正文摘要、规范串与签名。SigningSecret 非规范时抛出错误；浏览器无 Web Crypto（非安全连接）时同样抛出。 */
export async function signHmacRequest(input: HmacSigningInput): Promise<HmacSignature> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('当前页面不是安全连接（HTTPS 或本机地址），浏览器未提供本地签名计算。');
  const secret = decodeSigningSecret(input.signingSecret);
  if (!secret) throw new Error('SigningSecret 须为 43 字符的规范 Base64URL（无填充），解码后为 32 字节。');
  const encoder = new TextEncoder();
  const bodyHash = hex(await subtle.digest('SHA-256', encoder.encode(input.body)));
  const canonical = hmacCanonical(input, bodyHash);
  const key = await subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = hex(await subtle.sign('HMAC', key, encoder.encode(canonical)));
  const headers: Record<string, string> = {
    Authorization: `${hmacScheme} ${input.keyId}:${signature}`,
    'X-SZ-Tenant': input.tenantId,
    'X-SZ-Timestamp': input.timestamp,
    'X-SZ-Nonce': input.nonce,
  };
  if (input.employeeNo) headers['X-SZ-Employee'] = input.employeeNo;
  return { bodyHash, canonical, signature, headers };
}
