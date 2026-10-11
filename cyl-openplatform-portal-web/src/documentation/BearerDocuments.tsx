import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyOutlined } from '@ant-design/icons';
import { Alert, Button, Input } from 'antd';
import { createDocumentClient } from '@cyl/open-platform-web-shared/documentation/api';
import DocumentExplorer from '@cyl/open-platform-web-shared/documentation/DocumentExplorer';
import CustomerSdkAssets from '../sdk/CustomerSdkAssets';
import '../shell/shell.css';
import './bearer-documents.css';

/** 旧 /docs 入口只使用业务 Token，不依赖平台会话；Token 只在当前页面内存中。 */
export default function BearerDocuments() {
  const [session, setSession] = useState<{ token: string } | null>(null);
  const activeSession = useRef<typeof session>(null);
  // 输入框随表单重建而清空：antd 输入框内部受控，重置 DOM 不能清掉已输入的 Token。
  const [formKey, setFormKey] = useState(0);
  const [notice, setNotice] = useState('');
  const clear = useCallback(() => {
    activeSession.current = null;
    setFormKey((value) => value + 1);
    setSession(null);
    setNotice('');
  }, []);
  useEffect(() => {
    window.addEventListener('pagehide', clear);
    return () => {
      window.removeEventListener('pagehide', clear);
      activeSession.current = null;
    };
  }, [clear]);
  const identity = useMemo(() => {
    const onUnauthorized = () => {
      if (!session || activeSession.current !== session) return;
      clear();
      setNotice('业务 Token 已失效，授权文档与身份已清除。请重新获取 Token；公开文档与平台 SDK 不受影响。');
    };
    return session ? { client: createDocumentClient({ token: session.token, onUnauthorized }), onUnauthorized } : null;
  }, [session, clear]);
  return (
    <div className="op-portal op-bearer">
      <a className="op-portal__skip" href="#main">跳至主要内容</a>
      <header className="op-portal-header">
        <a className="op-portal-brand" href="/docs/">
          <span className="op-portal-brand__mark" aria-hidden><span /></span>
          <span className="op-portal-brand__name">CYL Open Platform<small>授权文档</small></span>
        </a>
        <nav className="op-portal-nav" aria-label="文档导航">
          <a href="/portal/">公开文档与平台 SDK</a>
        </nav>
      </header>
      <main id="main" className="op-portal-main op-bearer__main">
        <header className="op-bearer__heading">
          <h1>使用业务 Token 阅读授权文档</h1>
          <p>无需平台登录。此入口保留已授权接口的文档、导出及历史接口 SDK；公开内容也可直接前往开发者门户阅读。</p>
        </header>
        {notice && <Alert className="op-bearer__notice" type="warning" showIcon role="status" title={notice} />}
        {!identity || !session ? (
          <form
            key={formKey}
            className="op-bearer__form"
            onSubmit={(event) => {
              event.preventDefault();
              const token = String(new FormData(event.currentTarget).get('token') ?? '').trim();
              if (!token) return;
              const next = { token };
              activeSession.current = next;
              setFormKey((value) => value + 1);
              setSession(next);
              setNotice('');
            }}
          >
            <label className="op-bearer__field">
              业务 Token
              <Input name="token" type="password" autoComplete="off" required maxLength={8192} prefix={<KeyOutlined aria-hidden />} />
            </label>
            <p>请使用现有接入流程获取的有效 Token。Token 仅保存在当前页面内存；失效时会清除，请重新获取后再读取。</p>
            <Button type="primary" htmlType="submit">读取授权文档</Button>
          </form>
        ) : (
          <>
            <div className="op-bearer__session" role="group" aria-label="当前身份">
              <span><KeyOutlined aria-hidden className="op-bearer__key" /> 正在使用业务 Token 读取授权文档。</span>
              <Button size="small" onClick={clear}>清除 Token</Button>
            </div>
            <DocumentExplorer client={identity.client} renderInvocation={view => <CustomerSdkAssets key={view.releaseId} operation={view} token={session.token} onUnauthorized={identity.onUnauthorized} />} />
          </>
        )}
      </main>
    </div>
  );
}
