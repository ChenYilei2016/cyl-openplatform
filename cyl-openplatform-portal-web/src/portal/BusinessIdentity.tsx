import { Button, Input, Radio } from 'antd';
import { ErrorFeedback } from '@cyl/open-platform-web-shared/components';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { businessRequest, type TokenContext, type TokenResponse } from './api';
import './invocation.css';

export interface BusinessIdentityProps {
  employeeRequired?: boolean;
  initialTenantId?: string;
  initialSecret?: string;
  initialMode?: 'token' | 'ak';
  onClearSecret?: () => void;
  constraint?: { tenantId: string; applicationId: string; appKey: string; employeeNo?: string };
  renderAuthenticated?: (token: string, onUnauthorized: () => void) => ReactNode;
}

/**
 * 公开调试与凭据工作区复用真实Token核验；凭据只在当前组件内存中。
 * 输入框不进 React 状态：提交时从表单读取。antd 输入框内部受控，改写 DOM 无法清除，
 * 因此用重建清空：提交后重建秘密输入框（Token / AppSecret），清除身份时重建整个表单。
 */
export default function BusinessIdentity({
  employeeRequired = false,
  initialSecret,
  initialMode,
  onClearSecret,
  initialTenantId,
  constraint,
  renderAuthenticated,
}: BusinessIdentityProps) {
  const [mode, setMode] = useState<'token' | 'ak'>(initialMode ?? (constraint?.employeeNo ? 'ak' : 'token'));
  const [identity, setIdentity] = useState<{
    token: string;
    context: TokenContext;
  } | null>(null);
  const activeIdentity = useRef<typeof identity>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const modeLabel = useId();
  const [formKey, setFormKey] = useState(0);
  const [secretKey, setSecretKey] = useState(0);
  // 预填 Secret 只用于首次输入；提交或清除后重建的输入框不再带回它。
  const initialSecretUsable = useRef(true);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) feedback.current?.scrollIntoView?.({ block: 'nearest' }); }, [error]);
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
      activeIdentity.current = null;
    },
    [],
  );
  const clear = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    activeIdentity.current = null;
    initialSecretUsable.current = false;
    setFormKey((value) => value + 1);
    onClearSecret?.();
    setIdentity(null);
    setBusy(false);
    setError('');
    setNotice('');
  }, [onClearSecret]);
  useEffect(() => {
    window.addEventListener('pagehide', clear);
    return () => window.removeEventListener('pagehide', clear);
  }, [clear]);
  const unauthorized = useCallback(() => {
    if (!identity || activeIdentity.current !== identity) return;
    clear();
    setNotice('业务 Token 已失效，调用身份与结果已清除。公开文档和 SDK 仍可阅读。');
  }, [clear, identity]);

  return (
    <div className="public-debug-workspace">
      <details className="identity-help"><summary>Token 与调用身份说明</summary><p className="help-text">
        凭据仅在当前工作区使用，离开后清除。认证方法见 <a href="?section=guide">接入说明</a>，示例见{' '}
        <a href="?section=guide#sdk-java">Java 接入示例</a>。
      </p></details>
      {employeeRequired && !identity && !constraint?.employeeNo && <p className="help-text">当前流程需要调用员工，请准备已获有效委托的人员 Token，或先按工号获取人员 Token。</p>}
      <div className="op-identity__mode">
        <span id={modeLabel}>调试凭据方式</span>
        <Radio.Group
          size="small"
          optionType="button"
          aria-labelledby={modeLabel}
          value={mode}
          onChange={(event) => {
            clear();
            setMode(event.target.value as 'token' | 'ak');
          }}
          options={[
            { value: 'token', label: '使用已有 Token（推荐）' },
            { value: 'ak', label: '用 AK / Secret 获取 Token' },
          ]}
        />
      </div>
      {!identity && (
        <form
          key={`${mode}:${formKey}`}
          className="debug-credential-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const rawToken = String(data.get('token') || '').trim();
            const appSecret = String(data.get('appSecret') || '');
            const tenantId = String(data.get('tenantId') || '').trim();
            const appKey = String(data.get('appKey') || '').trim();
            const employeeNo = String(data.get('employeeNo') || '').trim();
            initialSecretUsable.current = false;
            setSecretKey((value) => value + 1);
            onClearSecret?.();
            pending.current?.abort();
            const abort = new AbortController();
            pending.current = abort;
            setBusy(true);
            setError('');
            setNotice('');
            void (async () => {
              let token: string;
              let context: TokenContext;
              if (mode === 'token') {
                if (!rawToken) throw new Error('请提供已有业务 Token。');
                const response = await businessRequest<TokenContext>('/api/token/introspect', { token: rawToken, signal: abort.signal });
                token = rawToken;
                context = response.data;
              } else {
                if (!tenantId || !/^[a-f0-9]{32}$/.test(appKey) || !appSecret)
                  throw new Error('请核对租户 ID、32 位 AppKey 和 AppSecret。');
                if (employeeRequired && !employeeNo) throw new Error('此 API 必须指定调用员工，请先建立人员委托并填写工号。');
                const response = await businessRequest<TokenResponse>('/api/token', {
                  body: {
                    tenantId,
                    appKey,
                    appSecret,
                    ...(employeeNo ? { employeeNo } : {}),
                  },
                  signal: abort.signal,
                });
                token = response.data.accessToken;
                context = response.data.context;
                if (!context || context.tenantId !== tenantId || context.appKey !== appKey || (context.employeeNo || '') !== employeeNo)
                  throw new Error('签发返回的租户、AppKey 或人员身份与请求不一致，请核对后重试。');
              }
              if (abort.signal.aborted) return;
              if (
                !token ||
                typeof token !== 'string' ||
                !context ||
                ![context.tenantId, context.applicationId, context.appKey, context.expiresAt].every(
                  (value) => typeof value === 'string' && value.length > 0,
                )
              )
                throw new Error('业务身份响应不完整，请核对后重试。');
              if (
                constraint &&
                (context.tenantId !== constraint.tenantId ||
                  context.applicationId !== constraint.applicationId ||
                  context.appKey !== constraint.appKey)
              )
                throw new Error('Token 不属于当前租户或所选应用。');
              if (employeeRequired && !context.employeeNo)
                throw new Error('此 API 必须使用人员 Token，当前 Token 为租户级身份。请建立委托并重新申请人员 Token。');
              if (constraint?.employeeNo && context.employeeNo !== constraint.employeeNo)
                throw new Error('Token 的员工身份与所选委托不一致。');
              activeIdentity.current = { token, context };
              setIdentity(activeIdentity.current);
            })()
              .catch((reason) => {
                if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : '业务身份验证失败。');
              })
              .finally(() => {
                if (!abort.signal.aborted) setBusy(false);
              });
          }}
        >
          <fieldset disabled={busy}>
            {mode === 'token' ? (
              <label>
                业务 Token
                <Input key={secretKey} name="token" type="password" required maxLength={8192} autoComplete="off" />
              </label>
            ) : (
              <>
                <label>
                  调用租户 ID
                  <Input
                    name="tenantId"
                    defaultValue={constraint?.tenantId || initialTenantId || ''}
                    readOnly={!!constraint}
                    required
                    maxLength={64}
                    autoComplete="off"
                  />
                </label>
                <label>
                  AppKey
                  <Input
                    name="appKey"
                    defaultValue={constraint?.appKey || ''}
                    readOnly={!!constraint}
                    required
                    pattern="[a-f0-9]{32}"
                    maxLength={32}
                    autoComplete="off"
                  />
                </label>
                <label>
                  AppSecret
                  <Input key={secretKey} name="appSecret" defaultValue={initialSecretUsable.current ? initialSecret : undefined} type="password" required maxLength={128} autoComplete="off" />
                </label>
                <details className="debug-person" open={!!employeeRequired || !!constraint?.employeeNo}>
                  <summary>需要以已获委托的人员身份调用</summary>
                  <label>
                    已获委托的员工号（
                    {employeeRequired ? '必填' : '可选'}）
                    <Input
                      name="employeeNo"
                      defaultValue={constraint?.employeeNo ?? ''}
                      required={!!employeeRequired}
                      readOnly={!!constraint?.employeeNo}
                      maxLength={64}
                      autoComplete="off"
                    />
                  </label>
                  <p className="help-text">
                    {employeeRequired ? '正在为所选员工准备调用身份。' : '留空使用租户级身份。'}
                    员工必须已有委托，签发时由服务端核验；填写员工号不会新增委托。
                  </p>
                </details>
              </>
            )}
            <Button className="op-identity__submit" type="primary" htmlType="submit" loading={busy}>
              {mode === 'token' ? '验证并使用 Token' : '获取并使用 Token'}
            </Button>
          </fieldset>
        </form>
      )}
      {busy && <p role="status">正在处理…</p>}
      {(identity || busy) && (
        <div className="form-actions op-identity__actions">
          <Button size="small" onClick={clear}>
            清除调试身份
          </Button>
          {identity && (
            <Button
              size="small"
              danger
              disabled={busy}
              onClick={() => {
                onClearSecret?.();
                pending.current?.abort();
                const abort = new AbortController();
                pending.current = abort;
                setBusy(true);
                setError('');
                setNotice('');
                void businessRequest('/api/token/revoke', {
                  token: identity.token,
                  signal: abort.signal,
                  onUnauthorized: unauthorized,
                })
                  .then(() => {
                    if (!abort.signal.aborted) {
                      clear();
                      setNotice('当前业务 Token 已撤销。');
                    }
                  })
                  .catch((reason) => {
                    if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : '撤销结果未知，请先核对 Token 状态。');
                  })
                  .finally(() => {
                    if (!abort.signal.aborted) setBusy(false);
                  });
              }}
            >
              撤销当前 Token
            </Button>
          )}
        </div>
      )}
      {error && <div ref={feedback}><ErrorFeedback error={error} /></div>}
      {notice && <p role="status">{notice}</p>}
      {identity && (
        <section className="debug-identity" aria-label="已验证的调用身份">
          <h3>已验证的调用身份</h3>
          <dl>
            <div>
              <dt>租户 ID</dt>
              <dd>{identity.context.tenantId}</dd>
            </div>
            <div>
              <dt>AppKey</dt>
              <dd>{identity.context.appKey}</dd>
            </div>
            <div>
              <dt>调用身份</dt>
              <dd>{identity.context.employeeNo ? `员工 ${identity.context.employeeNo}` : '应用身份'}</dd>
            </div>
            <div>
              <dt>有效期至</dt>
              <dd>{identity.context.expiresAt}</dd>
            </div>
          </dl>
        </section>
      )}
      {identity && !busy && (
        <>
          <Button
            className="op-identity__copy"
            onClick={() => {
              void navigator.clipboard.writeText(identity.token).then(
                () => setNotice('业务 Token 已复制。'),
                () => setError('复制失败，请重新尝试复制Token。'),
              );
            }}
          >
            复制业务 Token
          </Button>
          {renderAuthenticated?.(identity.token, unauthorized)}
        </>
      )}
    </div>
  );
}
