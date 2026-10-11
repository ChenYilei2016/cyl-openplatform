import { signOut } from '@cyl/open-platform-web-shared/session/signOut';
import { message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from 'antd';
import { LogoutOutlined } from '@ant-design/icons';
import { parseJson } from '@cyl/open-platform-web-shared/json';
import { PersonTag, TenantTag } from '@cyl/open-platform-web-shared/ui/components';
import StatusPage from '../shell/StatusPage';
import { createPortalApi, type PortalSession, type PortalSessionLoss } from './api';
import McpActivationCard from './McpActivationCard';
import PortalApplications from './PortalApplications';
import './portal-settings.css';

type SessionState =
  | { status: 'loading' | 'unauthorized' | 'forbidden' | 'error' | 'closed' | PortalSessionLoss }
  | { status: 'authenticated'; session: PortalSession; csrfToken: string | null };

/** 未登录、无资格、登录失效、读取失败、已退出：说明原因并给出下一步，凭据数据随状态切换一并卸载。 */
const signedOutCopy = {
  unauthorized: {
    kind: 'signedOut',
    title: '请使用平台账号登录',
    description: '“我的接入”使用现有本地账号身份，有效登录员工均可为本租户生成或绑定 AK。只阅读 API 文档无需登录。',
  },
  expired: {
    kind: 'signedOut',
    title: '登录已失效',
    description: '平台登录已过期，本页 Secret、业务 Token 与调用结果已清除。重新登录后回到这里继续，凭据本身不受影响。',
  },
  forbidden: {
    kind: 'signedOut',
    title: '暂无客户门户资格',
    description: '请确认登录账号、所属租户和员工有效状态后重新登录；仍被拒绝时请联系平台维护者核对身份及接口权限。',
  },
  error: {
    kind: 'error',
    title: '暂时无法验证登录',
    description: '登录状态读取失败，可能是网络或服务暂时不可用。稍后重新验证即可，凭据与 Secret 不会因此丢失。',
  },
  closed: {
    kind: 'signedOut',
    title: '已退出门户工作区',
    description: '本页凭据、Secret 与调用结果已清除。平台登录状态由统一身份系统管理，可随时重新进入。',
  },
} as const;

export default function Portal({ embedded = false }: { embedded?: boolean }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const expire = useCallback((reason: PortalSessionLoss) => setState({ status: reason }), []);
  const csrf = state.status === 'authenticated' ? state.csrfToken : null;
  const api = useMemo(() => createPortalApi(csrf, expire), [csrf, expire]);
  useEffect(() => {
    const abort = new AbortController(); setState({ status: 'loading' });
    void (async () => {
      const [response, info] = await Promise.all([
        fetch('/portal-api/session', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]) }),
        fetch('/platform-info', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]) }),
      ]);
      if (abort.signal.aborted) return;
      if (info.ok) {
        const platform = parseJson<{ data?: { adminLoginUrl?: string } }>(await info.text());
        const url = platform.data?.adminLoginUrl ? new URL(platform.data.adminLoginUrl, location.origin) : null;
        if (url && ['http:', 'https:'].includes(url.protocol)) setLoginUrl(url.href);
      }
      if (abort.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { setState({ status: response.status === 401 ? 'unauthorized' : 'forbidden' }); return; }
      const result = parseJson<{ code: number; data: PortalSession }>(await response.text());
      if (!response.ok || result.code !== 200 || !result.data || ![result.data.tenantId, result.data.userId, result.data.employeeNo].every(value => typeof value === 'string' && value.length > 0) || typeof result.data.displayName !== 'string') throw new Error('会话不可用');
      const tenantName = typeof result.data.tenantName === 'string' && result.data.tenantName.trim() ? result.data.tenantName : null;
      if (!abort.signal.aborted) setState({ status: 'authenticated', session: { ...result.data, tenantName }, csrfToken: response.headers.get('X-CSRF-Token') });
    })().catch(() => { if (!abort.signal.aborted) setState({ status: 'error' }); });
    return () => abort.abort();
  }, [attempt]);
  const Root = embedded ? 'section' : 'main';
  return (
    <Root id={embedded ? undefined : 'main'} aria-label="我的接入" className="op-access">
      <header className="op-access__header">
        <div className="op-access__heading">
          <h1>我的接入</h1>
          <p>管理本租户的接入：开通 MCP、生成或绑定 AK、准备调用 Token、配置可代表的员工。</p>
        </div>
        {state.status === 'authenticated' && (
          <div className="op-access__session" aria-label="当前登录身份">
            <span className="op-access__avatar" aria-hidden>{Array.from(state.session.displayName.trim())[0] ?? '我'}</span>
            <div className="op-access__identity">
              <PersonTag name={state.session.displayName} employeeNo={state.session.employeeNo} id={state.session.userId} />
              <span className="op-access__tenant"><span>当前租户</span> <TenantTag name={state.session.tenantName} id={state.session.tenantId} /></span>
            </div>
            <Button icon={<LogoutOutlined aria-hidden />} onClick={() => setState({ status: 'closed' })}>退出门户</Button>
            <Button onClick={() => void signOut().catch(error => message.error(error.message))}>退出登录</Button>
          </div>
        )}
      </header>
      {state.status === 'authenticated' ? (
        <>
          <McpActivationCard key={`mcp:${state.session.tenantId}:${state.session.employeeNo}:${attempt}`} api={api} />
          <PortalApplications key={`${state.session.tenantId}:${state.session.employeeNo}:${attempt}`} session={state.session} api={api} />
        </>
      ) : state.status === 'loading' ? (
        <p role="status" className="op-portal-loading">正在验证平台登录…</p>
      ) : (
        <StatusPage
          kind={signedOutCopy[state.status].kind}
          title={signedOutCopy[state.status].title}
          description={signedOutCopy[state.status].description}
          actions={
            <>
              {loginUrl && ['unauthorized', 'expired', 'closed'].includes(state.status) && (
                <a className="op-portal-link-button" href={loginUrl === '/admin/login.html' ? `${loginUrl}?next=/portal/` : loginUrl}>{state.status === 'expired' ? '重新登录' : '使用平台账号登录'}</a>
              )}
              <Button type={loginUrl && state.status !== 'forbidden' && state.status !== 'error' ? 'default' : 'primary'} onClick={() => setAttempt(value => value + 1)}>
                {state.status === 'closed' ? '重新进入我的接入' : '重新验证登录与资格'}
              </Button>
              <a className="op-portal-link-button op-portal-link-button--ghost" href="?section=documents">返回 API 文档</a>
            </>
          }
        />
      )}
    </Root>
  );
}
