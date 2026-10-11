/** 注销服务端会话，成功后清空页面内存中的身份和业务凭据。 */
export async function signOut(): Promise<void> {
  const csrf = await fetch('/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
  if (!csrf.ok) throw new Error('无法退出登录，请稍后重试。');
  const { data } = await csrf.json();
  const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': data.token } });
  if (!response.ok) throw new Error('无法退出登录，请刷新页面后重试。');
  location.assign('/admin/login.html');
}
