import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Button, Form, Input, Select } from 'antd';
import { PlatformTheme } from '@cyl/open-platform-web-shared/ui/PlatformTheme';
import './styles.css';
import './navigation/auth.css';

function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const next = new URLSearchParams(location.search).get('next');
  async function submit(values: { username: string; password: string; destination: string }) {
    setBusy(true); setError('');
    try {
      const csrf = await fetch('/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
      if (!csrf.ok) throw new Error('暂时无法连接平台，请稍后重试。');
      const { data } = await csrf.json();
      const response = await fetch('/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': data.token }, body: JSON.stringify({ username: values.username, password: values.password }) });
      if (!response.ok) { const failure = await response.json(); throw new Error(failure.resultMsg || '登录失败，请重试。'); }
      location.assign(values.destination);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '暂时无法登录，请重试。'); }
    finally { setBusy(false); }
  }
  return <main id="main" className="op-auth"><section className="op-auth__card">
    <div className="op-auth__brand"><span className="op-auth__logo" aria-hidden><span /></span><span>CYL Open Platform<small>API 开放平台</small></span></div>
    <h1>登录开放平台</h1><p>使用平台账号进入管理后台或开发者门户。</p>
    {error && <Alert type="error" showIcon title={error} role="alert" />}
    <Form className="op-auth__form" layout="vertical" onFinish={submit} initialValues={{ destination: next === '/portal/' ? '/portal/' : '/admin/' }} requiredMark={false}>
      <Form.Item label="账号" name="username" rules={[{ required: true, message: '请输入账号' }]}><Input autoComplete="username" maxLength={64} autoFocus /></Form.Item>
      <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}><Input.Password autoComplete="current-password" maxLength={256} /></Form.Item>
      <Form.Item label="进入" name="destination"><Select options={[{ value: '/admin/', label: '管理后台' }, { value: '/portal/', label: '开发者门户' }]} /></Form.Item>
      <Button type="primary" htmlType="submit" size="large" block loading={busy}>登录</Button>
    </Form><a className="op-auth__portal op-auth__browse" href="/portal/">浏览公开 API 文档 →</a>
  </section></main>;
}
createRoot(document.getElementById('root')!).render(<PlatformTheme><Login /></PlatformTheme>);
