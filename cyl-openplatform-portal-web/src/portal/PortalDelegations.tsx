import { useEffect, useRef, useState } from 'react';
import { Button, Input, Pagination } from 'antd';
import { StatusBadge } from '@cyl/open-platform-web-shared/ui/components';
import type { ApiClient } from '@cyl/open-platform-web-shared/http';
import { ErrorFeedback, usePage } from '@cyl/open-platform-web-shared/components';
import EmployeeProfileSearch, { type EmployeeProfileOption } from '@cyl/open-platform-web-shared/employees/EmployeeProfileSearch';
import { stringifyJson } from '@cyl/open-platform-web-shared/json';
import { PortalMutationError, type PortalApplication, type PortalSession } from './api';

interface Employee { tenantId: string; userId: string; employeeId: string; employeeNo: string; displayName: string; enabled: boolean }
interface UserGrant extends Employee { id: string; tenantGrantId: string; status: string; authorizationVersion: number }

/** 门户仅提交工号和已核验标识，租户与操作者始终由服务端会话确定。 */
export default function PortalDelegations({ api, application, session, onBusy, onToken }: {
  api: ApiClient; application: PortalApplication; session: PortalSession;
  onBusy: (value: boolean) => void; onToken: (employeeNo: string) => void;
}) {
  const base = `/bindings/${encodeURIComponent(application.id)}`;
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [applied, setApplied] = useState('');
  const query = `${base}/users?page=${page}&pageSize=20${applied ? `&employeeNo=${encodeURIComponent(applied)}` : ''}`;
  const list = usePage<UserGrant>(api, query);
  const [employeeNo, setEmployeeNo] = useState('');
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [directory, setDirectory] = useState(false);
  const [revoking, setRevoking] = useState<UserGrant | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const pendingEmployee = useRef<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = application.status === 'ACTIVE' && application.applicationStatus === 'ENABLED';
  const start = () => { pending.current = new AbortController(); inFlight.current = true; setBusy(true); onBusy(true); setError(''); setNotice(''); };
  const finish = () => { if (pending.current?.signal.aborted) return; inFlight.current = false; setBusy(false); onBusy(pendingEmployee.current !== null); };

  async function lookup(number: string, selected?: EmployeeProfileOption) {
    if (inFlight.current) return;
    start(); setEmployee(null); setEmployeeNo(number);
    try {
      const found = await api<Employee>(`${base}/employee-lookup`, { method: 'POST', body: { employeeNo: number.trim() }, signal: pending.current!.signal });
      if (pending.current?.signal.aborted) return;
      if (!found.enabled || found.tenantId !== session.tenantId || !found.userId || !found.employeeId
          || (selected && found.employeeId !== selected.employeeId)) throw new Error('该工号对应的人员已变化或不可委托，请重新核验。');
      setEmployee(found);
    } catch (failure) { if (pending.current?.signal.aborted) return; setError((failure as Error).message); }
    finally { finish(); }
  }

  async function mutate(path: string, body: unknown, affectedEmployeeNo: string, message: string) {
    if (inFlight.current || unknown) return;
    start();
    try {
      await api(path, { method: 'POST', body, signal: pending.current!.signal });
      if (pending.current?.signal.aborted) return;
      setNotice(message); setEmployee(null); setRevoking(null); list.reload();
    } catch (failure) { if (pending.current?.signal.aborted) return;
      setError((failure as Error).message);
      if (failure instanceof PortalMutationError && failure.outcome === 'UNKNOWN') {
        pendingEmployee.current = affectedEmployeeNo;
        setUnknown(true);
      }
      setEmployee(null);
    } finally { finish(); }
  }

  async function reconcile() {
    if (inFlight.current) return;
    start();
    try {
      // 只有一次成功的本租户读取才能解除结果未知状态；重试建立仍按相同人员幂等。
      const number = pendingEmployee.current;
      await api(`${base}/users?page=1&pageSize=20&employeeNo=${encodeURIComponent(number ?? '')}`, {signal: pending.current!.signal});
      if (pending.current?.signal.aborted) return;
      pendingEmployee.current = null; setFilter(number ?? ''); setApplied(number ?? ''); setPage(1);
      setUnknown(false); setRevoking(null); list.reload();
      setNotice('已重新读取本租户委托，请核对列表后再操作。');
    } catch (failure) { if (pending.current?.signal.aborted) return; setError((failure as Error).message); }
    finally { finish(); }
  }

  if (directory) return <div className="op-delegations">
    <Button onClick={() => setDirectory(false)}>返回工号核验</Button>
    <EmployeeProfileSearch api={api} path="/employee-profiles" tenantLabel="当前登录租户"
      onUseEmployeeNumber={() => setDirectory(false)} onSelect={profile => {
        setDirectory(false); void lookup(profile.employeeNo, profile);
      }} />
  </div>;

  return <div className="op-delegations">
    <p className="op-access-help">由你（{session.displayName} · {session.employeeNo}）为本租户员工代办，不代表目标本人确认。委托仅适用于此凭据，不增加接口权限；未登记员工也可按工号核验，不限制岗位或上下级，无需目标本人审批。</p>
    {!active && <p role="status" className="op-access-notice op-access-notice--warning">凭据已停用或本租户已解绑：可以查看与撤销已有委托，恢复有效关联后才能新增。</p>}
    <section className="op-delegations__create" aria-label="建立人员委托">
      <h3>建立人员委托</h3>
      <form className="op-delegations__toolbar" onSubmit={event => { event.preventDefault(); void lookup(employeeNo); }}>
        <label className="op-access-field"><span>调用员工工号</span><Input value={employeeNo} maxLength={64} placeholder="输入完整工号" disabled={busy || !active || unknown} autoComplete="off"
          onChange={event => { setEmployeeNo(event.target.value); setEmployee(null); setError(''); }} /></label>
        <Button type="primary" htmlType="submit" disabled={busy || !active || unknown || !employeeNo.trim()}>核验员工</Button>
        <Button disabled={busy || !active || unknown} onClick={() => setDirectory(true)}>按姓名选择</Button>
      </form>
      {employee && <div className="op-delegations__confirm" role="status">
        <strong>已核验：{employee.displayName} · 工号 {employee.employeeNo}</strong>
        <p>确认后，此凭据可申请代表该员工的人员 Token。已有租户级 Token 不会自动切换身份。</p>
        <Button type="primary" disabled={busy || unknown} onClick={() => void mutate(`${base}/users`, {
          employeeNo: employee.employeeNo, expectedUserId: employee.userId, expectedEmployeeId: employee.employeeId,
        }, employee.employeeNo, '委托已建立，可获取人员 Token；重复建立不会增加版本。')}>确认建立委托</Button>
      </div>}
    </section>
    <ErrorFeedback error={error} />
    {unknown && <p role="status" className="op-access-notice op-access-notice--warning">操作结果尚未确认，先核对最新委托，再决定下一步。<Button size="small" disabled={busy} onClick={() => void reconcile()}>核对最新委托</Button></p>}
    {notice && <p role="status" className="op-access-notice">{notice}</p>}
    <section className="op-delegations__existing" aria-label="已有人员委托">
      <div className="op-delegations__heading"><h3>已有人员委托</h3><Button size="small" disabled={busy} onClick={() => unknown ? void reconcile() : list.reload()}>刷新委托</Button></div>
      <form className="op-delegations__toolbar" onSubmit={event => { event.preventDefault(); setApplied(filter.trim()); setPage(1); }}>
        <Input aria-label="筛选工号（精确）" placeholder="筛选工号（精确）" value={filter} maxLength={64} onChange={event => setFilter(event.target.value)} />
        <Button htmlType="submit" disabled={busy || list.loading}>查询</Button>
        <Button disabled={busy} onClick={() => { setFilter(''); setApplied(''); setPage(1); }}>重置</Button>
      </form>
      {list.loading && <p role="status" className="op-access-help">正在读取委托…</p>}
      {list.error && <div className="op-access-inline-error"><ErrorFeedback error={list.error} /><Button size="small" onClick={list.reload}>重新加载</Button></div>}
      {list.data && <>
        {!list.data.items.length && <p className="op-access-empty">{active ? '暂无匹配的人员委托。未登记员工也可直接按工号核验。' : '暂无匹配的人员委托。恢复有效凭据和租户关联后才能新增。'}</p>}
        <ul className="op-delegations__list">{list.data.items.map(grant => <li key={grant.id}>
          <div className="op-delegations__person"><strong>{grant.displayName}</strong><span>工号 {grant.employeeNo}</span></div>
          <StatusBadge tone={grant.status === 'ACTIVE' ? 'success' : 'neutral'}>{grant.status === 'ACTIVE' ? '有效委托' : '已撤销'}</StatusBadge>
          <div className="op-delegations__actions"><Button size="small" disabled={busy || unknown || !active || grant.status !== 'ACTIVE'} onClick={() => onToken(grant.employeeNo)}>获取人员 Token</Button>
            <Button size="small" danger disabled={busy || unknown || grant.status !== 'ACTIVE'} onClick={() => { setRevoking(grant); setError(''); }}>撤销委托</Button></div>
          {revoking?.id === grant.id && <div className="op-delegations__confirm" role="group" aria-label={`撤销 ${grant.displayName} 的委托`}>
            <p>撤销 {grant.displayName}（{grant.employeeNo}）后，该人员旧 Token 的后续调用会被拒绝；其他人员、租户及租户级调用不受影响。</p>
            <Button size="small" disabled={busy} onClick={() => setRevoking(null)}>取消</Button>
            <Button size="small" danger type="primary" disabled={busy || unknown || stringifyJson(revoking.authorizationVersion) !== stringifyJson(grant.authorizationVersion)} onClick={() => void mutate(`${base}/users/${encodeURIComponent(grant.id)}/revoke`, { expectedAuthorizationVersion: grant.authorizationVersion }, grant.employeeNo, '该人员委托已撤销，旧人员 Token 后续调用将被拒绝。')}>确认撤销此员工</Button>
          </div>}
        </li>)}</ul>
        <nav aria-label="人员委托分页" className="op-access-pagination">
          <Pagination size="small" current={page} total={list.data.total} pageSize={20} showSizeChanger={false} hideOnSinglePage onChange={setPage} disabled={busy || list.loading} />
        </nav>
      </>}
    </section>
  </div>;
}
