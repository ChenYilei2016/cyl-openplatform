import { EyeInvisibleOutlined, EyeOutlined, LockOutlined } from '@ant-design/icons';
import { hmacInputProblems, signHmacRequest, type HmacSignature, type HmacSigningInput } from '@cyl/open-platform-web-shared/documentation/requestSigning';
import { shellLiteral } from '@cyl/open-platform-web-shared/documentation/invocationExamples';
import { Button, Input } from 'antd';
import { useEffect, useId, useState } from 'react';
import CodeBlock from '../shell/CodeBlock';
import MethodBadge from '../shell/MethodBadge';

/** 公开演示向量：32 个 0x07 字节的 Base64URL，与共享签名回归一致；不是任何环境的真实密钥。 */
const demoSecret = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';
const randomNonce = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
const nowSeconds = () => String(Math.floor(Date.now() / 1000));

/** 网关地址带部署前缀时，签名路径要包含该前缀。 */
const signPath = (gatewayBaseUrl: string) => {
  let prefix = '';
  try {
    prefix = gatewayBaseUrl ? new URL(gatewayBaseUrl).pathname.replace(/\/+$/, '') : '';
  } catch {
    /* 地址不规范时按无前缀演示。 */
  }
  return `${prefix}/api/sign/orders/v1/query`;
};

type Field = Exclude<keyof HmacSigningInput, 'signingSecret' | 'body'>;
const fields: { key: Field; label: string; hint: string }[] = [
  { key: 'path', label: '请求路径', hint: '实际 /api/sign 路径，包含部署前缀' },
  { key: 'keyId', label: 'keyId', hint: '32 位小写十六进制' },
  { key: 'tenantId', label: '租户 ID', hint: 'X-SZ-Tenant' },
  { key: 'employeeNo', label: '人员号（可选）', hint: '留空时待签字符串保留空行' },
  { key: 'timestamp', label: '时间戳', hint: 'UTC 秒' },
  { key: 'nonce', label: '随机串', hint: '32 位小写十六进制' },
];

/**
 * HMAC 签名交互演示（115 用户故事 15）：输入变化后用共享签名函数在浏览器本地重新计算。
 * 输入只保存在组件状态里，不发请求、不写地址栏或浏览器存储。
 */
export default function HmacSignatureDemo({ gatewayBaseUrl }: { gatewayBaseUrl: string }) {
  const id = useId();
  const [input, setInput] = useState<HmacSigningInput>(() => ({
    path: signPath(gatewayBaseUrl), keyId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', tenantId: 'tenant-demo', employeeNo: '',
    timestamp: nowSeconds(), nonce: randomNonce(), body: '{ "orderNo": "COMMON-001" }', signingSecret: demoSecret,
  }));
  const [showSecret, setShowSecret] = useState(false);
  const [result, setResult] = useState<HmacSignature | null>(null);
  const [error, setError] = useState('');
  const [pathEdited, setPathEdited] = useState(false);
  useEffect(() => {
    const path = signPath(gatewayBaseUrl);
    if (!pathEdited) setInput((current) => (current.path === path ? current : { ...current, path }));
  }, [gatewayBaseUrl, pathEdited]);
  useEffect(() => {
    let current = true;
    signHmacRequest(input).then(
      (value) => { if (current) { setResult(value); setError(''); } },
      (reason: Error) => { if (current) { setResult(null); setError(reason.message); } },
    );
    return () => { current = false; };
  }, [input]);
  const update = (key: keyof HmacSigningInput, value: string) => setInput((current) => ({ ...current, [key]: value }));
  const problems = hmacInputProblems(input);
  const origin = gatewayBaseUrl ? (() => { try { return new URL(gatewayBaseUrl).origin; } catch { return ''; } })() : '';
  const requestSamples = result ? [
    { label: 'HTTP', language: 'text' as const, code: [`POST ${origin}${input.path}`, ...Object.entries(result.headers).map(([name, value]) => `${name}: ${value}`), 'Content-Type: application/json', '', input.body].join('\n') },
    { label: 'cURL', language: 'bash' as const, code: [
      ...(origin ? [] : ['# OPEN_PLATFORM_ORIGIN 为网关协议与主机（不含路径）；上面的请求路径已包含部署前缀。']),
      `printf '%s' ${shellLiteral(input.body)} | \\`,
      `  curl --silent --show-error --connect-timeout 3 --max-time 10 \\`,
      `    --request POST --url ${origin ? shellLiteral(origin + input.path) : `"\${OPEN_PLATFORM_ORIGIN}"${shellLiteral(input.path)}`} \\`,
      ...Object.entries(result.headers).map(([name, value]) => `    --header ${shellLiteral(`${name}: ${value}`)} \\`),
      `    --header 'Content-Type: application/json' \\`,
      '    --include --data-binary @-',
    ].join('\n') },
  ] : [];
  return (
    <section className="op-hmac" aria-labelledby={`${id}-title`}>
      <header className="op-hmac__header">
        <h3 id={`${id}-title`}>签名计算器</h3>
        <p className="op-hmac__privacy"><LockOutlined aria-hidden /> 仅在当前浏览器本地计算：不发送任何请求，不写入地址栏或浏览器存储。请使用演示值，不要粘贴生产 SigningSecret。</p>
      </header>
      <div className="op-hmac__grid">
        <form className="op-hmac__form" onSubmit={(event) => event.preventDefault()} autoComplete="off">
          <div className="op-hmac__field">
            <span className="op-hmac__label">请求方法</span>
            <span className="op-hmac__fixed"><MethodBadge method="POST" /> 签名协议固定使用 POST</span>
          </div>
          {fields.map((field) => (
            <div className="op-hmac__field" key={field.key}>
              <label className="op-hmac__label" htmlFor={`${id}-${field.key}`}>{field.label}</label>
              <div className="op-hmac__control">
                <Input id={`${id}-${field.key}`} value={input[field.key] ?? ''} spellCheck={false} autoComplete="off" placeholder={field.hint}
                  className="op-hmac__mono" onChange={(event) => { if (field.key === 'path') setPathEdited(true); update(field.key, event.target.value); }} />
                {field.key === 'timestamp' && <Button htmlType="button" onClick={() => update('timestamp', nowSeconds())}>当前时间</Button>}
                {field.key === 'nonce' && <Button htmlType="button" onClick={() => update('nonce', randomNonce())}>重新生成</Button>}
              </div>
            </div>
          ))}
          <div className="op-hmac__field">
            <label className="op-hmac__label" htmlFor={`${id}-secret`}>SigningSecret（演示值）</label>
            <div className="op-hmac__control">
              <Input id={`${id}-secret`} type={showSecret ? 'text' : 'password'} value={input.signingSecret} spellCheck={false} autoComplete="off" className="op-hmac__mono"
                onChange={(event) => update('signingSecret', event.target.value)} />
              <Button htmlType="button" aria-pressed={showSecret} icon={showSecret ? <EyeInvisibleOutlined aria-hidden /> : <EyeOutlined aria-hidden />} onClick={() => setShowSecret(!showSecret)}>
                {showSecret ? '隐藏' : '显示'}
              </Button>
            </div>
          </div>
          <div className="op-hmac__field op-hmac__field--wide">
            <label className="op-hmac__label" htmlFor={`${id}-body`}>请求正文（原样 UTF-8，签名后不得改动）</label>
            <Input.TextArea id={`${id}-body`} value={input.body} spellCheck={false} autoSize={{ minRows: 3, maxRows: 8 }} className="op-hmac__mono" onChange={(event) => update('body', event.target.value)} />
          </div>
        </form>
        <div className="op-hmac__result" aria-live="polite">
          {problems.length > 0 && (
            <ul className="op-hmac__problems" aria-label="网关会拒绝的输入">
              {problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          )}
          {error && <p className="op-hmac__error" role="alert">{error}</p>}
          {result && (
            <>
              <dl className="op-hmac__values">
                <div><dt>正文 SHA-256</dt><dd>{result.bodyHash}</dd></div>
                <div><dt>签名（HMAC-SHA256）</dt><dd className="op-hmac__signature">{result.signature}</dd></div>
              </dl>
              <CodeBlock title="待签字符串（9 行，以 LF 连接，末尾无换行）" samples={[{ label: '待签字符串', language: 'text', code: result.canonical }]} />
              <CodeBlock title="签名后的请求" samples={requestSamples} />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
