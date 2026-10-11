import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Checkbox, Input, Pagination, Segmented, Skeleton } from 'antd';
import { CloseOutlined, LinkOutlined, PlusOutlined, ReloadOutlined, TeamOutlined } from '@ant-design/icons';
import type { ApiClient } from '@cyl/open-platform-web-shared/http';
import { ErrorFeedback, usePage } from '@cyl/open-platform-web-shared/components';
import { EmptyState, FieldHelp, IdText, TenantTag } from '@cyl/open-platform-web-shared/ui/components';
import EmployeeProfileSearch from '@cyl/open-platform-web-shared/employees/EmployeeProfileSearch';
import StatusPage from '../shell/StatusPage';
import { PortalMutationError, type PortalApplication, type PortalSession } from './api';
import CredentialRow, { credentialStatus, relationStatus } from './CredentialRow';
import CredentialDrawer, { readCredentialTab, type CredentialTab } from './CredentialDrawer';
import SecretDelivery from './SecretDelivery';

type Modal =
  | { kind: 'profiles' }
  | { kind: 'create' }
  | { kind: 'bind'; appKey: string }
  | { kind: 'revoke' | 'note'; application: PortalApplication }
  | { kind: 'credentials'; appKey: string; appSecret: string };
type RelationFilter = 'ACTIVE' | 'REVOKED' | 'ALL';
// 仅记录可能已提交的事实；凭据、备注和 Token 始终不进入存储。
const pendingCreations = new Map<string, number>();
let markerStorageAvailable = true;

function creationMarker(key: string, timestamp?: number | null): number | null {
  try {
    if (timestamp === null) {
      sessionStorage.removeItem(key);
      pendingCreations.delete(key);
    } else if (timestamp !== undefined) {
      // 写入成功后才允许发送创建请求，防止刷新丢失在途状态。
      sessionStorage.setItem(key, String(timestamp));
      pendingCreations.set(key, timestamp);
    } else {
      const saved = Number(sessionStorage.getItem(key));
      if (saved > 0) pendingCreations.set(key, saved);
    }
    markerStorageAvailable = true;
  } catch {
    markerStorageAvailable = false;
  }
  return pendingCreations.get(key) ?? null;
}

function readFilters() {
  const params = new URLSearchParams(location.search);
  const page = Number(params.get('credentialPage'));
  const relation = params.get('relation');
  return {
    appKey: params.get('credentialKey') || '',
    name: params.get('name') || '',
    status: (relation === 'ALL' || relation === 'REVOKED' ? relation : 'ACTIVE') as RelationFilter,
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 5001) : 1,
  };
}

const dialogTitles: Record<Modal['kind'], string> = {
  profiles: '本租户已登记人员',
  note: '编辑本租户备注',
  create: '生成新 AK',
  bind: '绑定现有 AK',
  revoke: '解除本租户关联',
  credentials: '请保存本次 Secret',
};

/** “我的接入”：本租户凭据列表 + 详情抽屉；短任务（生成、绑定、备注、解绑、Secret 交付）使用原生模态窗口。 */
export default function PortalApplications({ session, api }: { session: PortalSession; api: ApiClient }) {
  const markerKey = `portal.pending-create:${encodeURIComponent(session.tenantId)}:${encodeURIComponent(session.employeeNo)}`;
  const [unknown, setUnknown] = useState(() => creationMarker(markerKey));
  const [reviewed, setReviewed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const reviewRequested = useRef(false);
  const [filters, setFilters] = useState(readFilters);
  const [draft, setDraft] = useState(filters);
  useEffect(() => setDraft(filters), [filters]);
  const readApi: ApiClient = useCallback(
    async <T,>(path: string, options: Parameters<ApiClient>[1]) => {
      const result = await api<T>(path, options);
      if (!options?.signal?.aborted && reviewRequested.current) {
        reviewRequested.current = false;
        setReviewed(true);
      }
      return result;
    },
    [api],
  );
  const listParams = new URLSearchParams({ page: String(filters.page), pageSize: '20' });
  if (filters.appKey) listParams.set('appKey', filters.appKey);
  if (filters.name) listParams.set('name', filters.name);
  if (filters.status !== 'ALL') listParams.set('status', filters.status);
  const list = usePage<PortalApplication>(readApi, `/applications?${listParams}`);
  const [modal, setModal] = useState<Modal | null>(null);
  const [selected, setSelected] = useState<PortalApplication | null>(null);
  const [workspaceId, setWorkspaceId] = useState(() => new URLSearchParams(location.search).get('credential') || '');
  const [tab, setTab] = useState<CredentialTab>(() => readCredentialTab(new URLSearchParams(location.search).get('accessTab')));
  const [selectedEmployeeNo, setSelectedEmployeeNo] = useState<string | undefined>(
    () => new URLSearchParams(location.search).get('employee') || undefined,
  );
  const [handoffSecret, setHandoffSecret] = useState('');
  const clearSecret = useCallback(() => setHandoffSecret(''), []);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceAttempt, setWorkspaceAttempt] = useState(0);
  const [availability, setAvailability] = useState<{ available: boolean; defaultScopeCount: number; reason: string } | null>(null);
  const [availabilityError, setAvailabilityError] = useState('');
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [unknownBinding, setUnknownBinding] = useState('');
  const [delegationBusy, setDelegationBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [secretSaved, setSecretSaved] = useState(false);
  const [bindSecret, setBindSecret] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const noteLength = Array.from(noteInput.trim()).length;
  const [noteNeedsCheck, setNoteNeedsCheck] = useState(false);
  const [noteChecked, setNoteChecked] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const secretPending = modal?.kind === 'credentials' && !secretSaved;
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    const currentUrl = location.href;
    const dirty =
      modal?.kind === 'credentials' || !!handoffSecret || (modal?.kind === 'note' && noteInput !== (modal.application.note || ''));
    const canLeave = () =>
      !(busy || delegationBusy || unknownBinding) &&
      (!dirty || window.confirm('离开将清除未保存的输入或本页 Secret，确认已保存后再离开。'));
    const restore = (event: PopStateEvent) => {
      const params = new URLSearchParams(location.search);
      const nextId = params.get('credential') || '';
      const leaves = nextId !== workspaceId || params.get('section') !== 'settings';
      if ((leaves && !canLeave()) || (!leaves && (busy || delegationBusy))) {
        event.stopImmediatePropagation();
        history.pushState(null, '', currentUrl);
        return;
      }
      if (leaves) {
        setSelected(null);
        setHandoffSecret('');
        setDelegationBusy(false);
        setModal(null);
      }
      setWorkspaceId(nextId);
      setTab(readCredentialTab(params.get('accessTab')));
      setSelectedEmployeeNo(params.get('employee') || undefined);
      setFilters(readFilters());
    };
    const guardLink = (event: MouseEvent) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest('a');
      const exits = target?.closest('button')?.textContent === '退出门户';
      if ((exits || (link && link.target !== '_blank' && new URL(link.href).searchParams.get('section') !== 'settings')) && !canLeave()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('popstate', restore, true);
    document.addEventListener('click', guardLink, true);
    return () => {
      window.removeEventListener('popstate', restore, true);
      document.removeEventListener('click', guardLink, true);
    };
  }, [workspaceId, tab, selectedEmployeeNo, busy, delegationBusy, unknownBinding, handoffSecret, modal, noteInput]);
  useEffect(() => {
    if (modal && !dialog.current?.open) dialog.current?.showModal();
  }, [modal]);
  useEffect(() => {
    if (!workspaceId) return;
    const abort = new AbortController();
    setWorkspaceLoading(true);
    setWorkspaceError('');
    api<PortalApplication>(`/applications/${encodeURIComponent(workspaceId)}`, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setSelected(value);
      })
      .catch((reason) => {
        if (!abort.signal.aborted) {
          setSelected(null);
          setHandoffSecret('');
          setWorkspaceError(reason.message);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setWorkspaceLoading(false);
      });
    return () => abort.abort();
  }, [api, workspaceId, workspaceAttempt]);
  useEffect(() => {
    if (modal?.kind !== 'create') return;
    const abort = new AbortController();
    setAvailability(null);
    setAvailabilityError('');
    api<{ available: boolean; defaultScopeCount: number; reason: string }>('/creation-availability', { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setAvailability(value);
      })
      .catch((reason) => {
        if (!abort.signal.aborted) setAvailabilityError(reason.message);
      });
    return () => abort.abort();
  }, [api, modal?.kind, availabilityAttempt]);
  useEffect(() => {
    if (!(modal?.kind === 'credentials' || handoffSecret || (modal?.kind === 'note' && noteInput !== modal.application.note))) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [modal, handoffSecret, noteInput]);
  const showWorkspace = (item: PortalApplication, nextTab: CredentialTab = 'overview', employeeNo?: string, secret?: string) => {
    const params = new URLSearchParams(location.search);
    params.set('credential', item.id);
    params.set('accessTab', nextTab);
    if (employeeNo) params.set('employee', employeeNo);
    else params.delete('employee');
    history.pushState(null, '', `${location.pathname}?${params}`);
    if (selected?.id !== item.id) setHandoffSecret(secret || '');
    else if (secret) setHandoffSecret(secret);
    setWorkspaceId(item.id);
    setSelected(item);
    setTab(nextTab);
    setSelectedEmployeeNo(employeeNo);
    setNotice('');
  };
  const closeWorkspace = () => {
    if (busy || delegationBusy) return;
    if (handoffSecret && !window.confirm('关闭将清除本页 Secret，请确认已保存。')) return;
    const params = new URLSearchParams(location.search);
    ['credential', 'accessTab', 'employee'].forEach((key) => params.delete(key));
    history.pushState(null, '', `${location.pathname}?${params}`);
    setWorkspaceId('');
    setSelected(null);
    setHandoffSecret('');
    setWorkspaceError('');
    // 写入操作已各自刷新列表；只读关闭保留原行，供抽屉恢复键盘焦点。
  };
  const findBinding = async (appKey: string, signal: AbortSignal) => {
    const result = await api<{ items: PortalApplication[] }>(`/applications?page=1&pageSize=1&appKey=${encodeURIComponent(appKey)}`, { signal });
    return result.items.find((item) => item.appKey === appKey && item.status === 'ACTIVE');
  };
  const continueCreated = async () => {
    if (modal?.kind !== 'credentials' || !secretSaved || pending.current) return;
    const current = modal;
    const abort = new AbortController();
    pending.current = abort;
    setBusy(true);
    setError('');
    try {
      const item = await findBinding(current.appKey, abort.signal);
      if (!abort.signal.aborted) {
        if (!item) throw new Error('暂未读取到本租户关联，请重试读取；本次 Secret 仍保留在这里。');
        dialog.current?.close();
        setModal(null);
        setSecretSaved(false);
        showWorkspace(item, 'token', undefined, current.appSecret);
      }
    } catch (reason) {
      if (!abort.signal.aborted) setError((reason as Error).message);
    } finally {
      if (!abort.signal.aborted) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  const reconcileBinding = async () => {
    if (!unknownBinding || pending.current) return;
    const abort = new AbortController();
    pending.current = abort;
    setBusy(true);
    setError('');
    try {
      const item = await findBinding(unknownBinding, abort.signal);
      if (abort.signal.aborted) return;
      setUnknownBinding('');
      if (item) {
        dialog.current?.close();
        setModal(null);
        showWorkspace(item, 'token');
        list.reload();
        setNotice('已确认绑定成功，可继续接入。');
      } else setError('已读取当前状态，尚无有效关联。请重新填写 Secret 后显式绑定。');
    } catch (reason) {
      if (!abort.signal.aborted) setError((reason as Error).message);
    } finally {
      if (!abort.signal.aborted) {
        pending.current = null;
        setBusy(false);
      }
    }
  };

  const navigate = (next: typeof filters) => {
    setSelected(null);
    const params = new URLSearchParams({ section: 'settings' });
    if (next.appKey) params.set('credentialKey', next.appKey);
    if (next.name) params.set('name', next.name);
    if (next.status !== 'ACTIVE') params.set('relation', next.status);
    if (next.page > 1) params.set('credentialPage', String(next.page));
    history.pushState(null, '', `${location.pathname}?${params}`);
    setFilters(next);
  };
  const open = (next: Modal) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setUnknownBinding('');
    setError('');
    setBindSecret('');
    if (next.kind === 'note') {
      setNoteInput(next.application.note || '');
      setNoteNeedsCheck(false);
      setNoteChecked(false);
    }
    setModal(next);
  };
  // Secret 交付未确认保存时不能关闭；其余窗口在提交中或结果未知时保持打开。
  const close = () => {
    if (busy || unknownBinding || secretPending) return;
    dialog.current?.close();
    setModal(null);
    setError('');
    setSecretSaved(false);
    opener.current?.focus();
  };
  const refresh = () => {
    if (unknown) {
      reviewRequested.current = true;
      setReviewed(false);
      setAcknowledged(false);
    }
    list.reload();
  };
  const mutate = async (path: string, body: unknown, creating = false) => {
    if (pending.current || (creating && (unknown || !availability?.available)) || unknownBinding) return;
    setError('');
    setNotice('');
    if (creating) {
      creationMarker(markerKey, Date.now());
      if (!markerStorageAvailable) {
        setError('无法保存提交状态，尚未发送生成请求；请允许会话存储后重试。');
        return;
      }
    }
    const abort = new AbortController();
    pending.current = abort;
    setBusy(true);
    try {
      const result = await api<{ id: string; application: { appKey: string }; appSecret: string }>(path, { method: 'POST', body, signal: abort.signal });
      if (abort.signal.aborted) return;
      if (creating) {
        if (!result || !/^[a-f0-9]{32}$/.test(result.application?.appKey ?? '') || typeof result.appSecret !== 'string' || !result.appSecret || result.appSecret.length > 128)
          throw new Error('未收到可信的完整凭据。');
        creationMarker(markerKey, null);
        setSecretSaved(false);
        setModal({ kind: 'credentials', appKey: result.application.appKey, appSecret: result.appSecret });
      } else {
        dialog.current?.close();
        setModal(null);
        opener.current?.focus();
        if (path === '/bindings') {
          const input = body as { appKey: string; appSecret: string };
          setHandoffSecret(input.appSecret);
          setWorkspaceId(result.id);
          setSelected(null);
          // 抽屉内重新绑定可能沿用同一关系ID，显式重读以免停在空白加载态。
          setWorkspaceAttempt((value) => value + 1);
          const params = new URLSearchParams(location.search);
          params.set('credential', result.id);
          params.set('accessTab', 'token');
          params.delete('employee');
          history.pushState(null, '', `${location.pathname}?${params}`);
          setTab('token');
          setSelectedEmployeeNo(undefined);
        } else {
          setWorkspaceAttempt((value) => value + 1);
          setHandoffSecret('');
        }
      }
      list.reload();
      setNotice(
        creating
          ? 'AK 已生成并绑定本租户，请立即保存本次 Secret。'
          : path.endsWith('/revoke')
            ? '本租户已解绑，旧 Token 已失效；其他租户不受影响。'
            : '已绑定本租户。请重新获取本租户 Token，旧 Token 不会恢复。',
      );
    } catch (reason) {
      if (abort.signal.aborted) return;
      if (creating && !(reason instanceof PortalMutationError && reason.outcome === 'REJECTED')) {
        setUnknown(creationMarker(markerKey));
        setReviewed(false);
        setAcknowledged(false);
        reviewRequested.current = false;
        dialog.current?.close();
        setModal(null);
        opener.current?.focus();
        setNotice(`${reason instanceof Error ? reason.message : '请求未取得可信结果。'} 生成结果未知，服务端可能已创建凭据。请先刷新核对列表；不会自动重试。`);
      } else {
        if (path === '/bindings' && reason instanceof PortalMutationError && reason.outcome === 'UNKNOWN') setUnknownBinding((body as { appKey: string }).appKey);
        if (creating) creationMarker(markerKey, null);
        setError(reason instanceof Error ? reason.message : '操作失败，请核对后重试。');
      }
    } finally {
      if (!abort.signal.aborted) {
        pending.current = null;
        setBusy(false);
        setBindSecret('');
      }
    }
  };
  const saveNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (modal?.kind !== 'note' || pending.current || noteNeedsCheck || noteLength > 100) return;
    const abort = new AbortController();
    pending.current = abort;
    setBusy(true);
    setError('');
    try {
      await api(`/bindings/${encodeURIComponent(modal.application.id)}/note`, {
        method: 'PUT',
        body: { note: noteInput.trim(), expectedRevision: modal.application.noteRevision },
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      dialog.current?.close();
      setModal(null);
      opener.current?.focus();
      list.reload();
      setWorkspaceAttempt((value) => value + 1);
      setNotice('本租户备注已保存，不影响其他租户或已有 Token。');
    } catch (reason) {
      if (!abort.signal.aborted) {
        setError(reason instanceof Error ? reason.message : '备注保存失败，请重新核对。');
        setNoteNeedsCheck(true);
        setNoteChecked(false);
      }
    } finally {
      if (!abort.signal.aborted) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  const checkNote = async () => {
    if (modal?.kind !== 'note' || pending.current) return;
    const abort = new AbortController();
    pending.current = abort;
    setBusy(true);
    setError('');
    try {
      const latest = await api<Pick<PortalApplication, 'note' | 'noteRevision' | 'status'>>(`/bindings/${encodeURIComponent(modal.application.id)}`, { signal: abort.signal });
      if (abort.signal.aborted) return;
      setModal({ ...modal, application: { ...modal.application, ...latest } });
      setNoteChecked(true);
      setNoteNeedsCheck(false);
    } catch (reason) {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : '核对失败，请重试。');
    } finally {
      if (!abort.signal.aborted) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  const filtered = !!(filters.appKey || filters.name);
  return (
    <>
      <section className="op-access-list" aria-label="本租户接入凭据">
        <div className="op-access-list__head">
          <h2>
            接入凭据
            {list.data && <span className="op-access-count" aria-label={`共 ${list.data.total} 项`}>{list.data.total}</span>}
            <FieldHelp label="凭据与身份">AK 是接入编号，Secret 用于换取业务 Token。平台登录用于管理本租户接入，不会自动获得业务调用权限。</FieldHelp>
          </h2>
          <div className="op-access-actions">
            <Button icon={<ReloadOutlined aria-hidden />} onClick={refresh} disabled={list.loading}>刷新核对列表</Button>
            <Button icon={<TeamOutlined aria-hidden />} disabled={busy} onClick={() => open({ kind: 'profiles' })}>已登记人员</Button>
            <Button icon={<LinkOutlined aria-hidden />} onClick={() => open({ kind: 'bind', appKey: '' })}>绑定现有 AK</Button>
            <Button type="primary" icon={<PlusOutlined aria-hidden />} disabled={!!unknown || busy} onClick={() => open({ kind: 'create' })}>生成新 AK</Button>
          </div>
        </div>
        <form
          className="op-access-filters"
          onSubmit={(event) => {
            event.preventDefault();
            navigate({ ...draft, appKey: draft.appKey.trim(), name: draft.name.trim(), page: 1 });
          }}
        >
          <Input aria-label="AK（精确匹配）" className="op-access-filters__key" maxLength={32} value={draft.appKey} placeholder="输入完整 AK（精确匹配）" autoComplete="off" onChange={(event) => setDraft({ ...draft, appKey: event.target.value })} />
          <Input aria-label="用途备注（包含）" maxLength={100} value={draft.name} placeholder="用途备注，例如：仓储" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <Segmented<RelationFilter>
            aria-label="本租户关联"
            value={filters.status}
            options={[{ label: '已绑定', value: 'ACTIVE' }, { label: '已解绑', value: 'REVOKED' }, { label: '全部关联', value: 'ALL' }]}
            onChange={(status) => navigate({ ...filters, status, page: 1 })}
          />
          <Button htmlType="submit">查询</Button>
          <Button onClick={() => navigate({ appKey: '', name: '', status: 'ACTIVE', page: 1 })}>重置</Button>
        </form>
        {notice && !workspaceId && <p role="status" className="op-access-notice">{notice}</p>}
        {unknown && (
          <section className="op-access-callout" aria-label="核对未知生成结果">
            <h2>上次生成结果需要核对</h2>
            <p>
              提交时间：{new Date(unknown).toLocaleString('zh-CN')}
              。请刷新并检查各页记录；空列表或搜索无结果不能证明未创建。已创建凭据的 Secret 无法从列表找回，可联系平台维护者核对。
            </p>
            {!markerStorageAvailable && <p>浏览器存储不可用，核对标记仅保留在当前页面；离开前请完成核对，刷新后不要直接重复生成。</p>}
            <Checkbox checked={acknowledged} disabled={!reviewed || list.loading} onChange={(event) => setAcknowledged(event.target.checked)}>
              我已核对刷新后的列表，理解原 Secret 无法找回，继续会生成另一套凭据。
            </Checkbox>
            <div>
              <Button
                disabled={!reviewed || !acknowledged || list.loading}
                onClick={() => {
                  creationMarker(markerKey, null);
                  setUnknown(null);
                  setAcknowledged(false);
                  setReviewed(false);
                  setNotice('已确认重新生成的影响。需要新凭据时，请点击“生成新 AK”。');
                }}
              >
                确认后允许生成另一套凭据
              </Button>
            </div>
          </section>
        )}
        {list.loading && (
          <div className="op-credential-loading" role="status" aria-label="正在加载凭据"><Skeleton active title={false} paragraph={{ rows: 4 }} /></div>
        )}
        {list.error && !list.loading && (
          <StatusPage kind="error" compact title="暂时无法读取凭据" description={list.error} actions={<Button type="primary" onClick={refresh}>重新加载</Button>} />
        )}
        {list.data && (
          <>
            {list.data.items.length ? (
              <div className="op-credential-list">
                <div className="op-credential-list__head" aria-hidden><span>本租户备注 / AK</span><span>已授权权限组</span><span>状态</span><span>操作</span></div>
                <div role="list" aria-label="本租户接入凭据">
                  {list.data.items.map((item) => <CredentialRow key={item.id} application={item} onOpen={() => showWorkspace(item)} />)}
                </div>
              </div>
            ) : (
              <EmptyState
                kind={filtered ? 'noResult' : 'empty'}
                title={filtered ? '没有匹配的凭据' : '还没有接入凭据'}
                description={filtered ? '没有匹配的本租户凭据，请调整筛选或重置后核对。' : '暂无本租户凭据关联。首次接入可生成新 AK，团队已有凭据可直接绑定。'}
              />
            )}
            <nav aria-label="凭据分页" className="op-access-pagination">
              <Pagination
                current={filters.page}
                total={list.data.total}
                pageSize={20}
                showSizeChanger={false}
                hideOnSinglePage
                disabled={list.loading}
                showTotal={(total) => `共 ${total} 项`}
                onChange={(page) => navigate({ ...filters, page })}
              />
            </nav>
          </>
        )}
      </section>
      {workspaceId && (
        <CredentialDrawer
          application={selected}
          session={session}
          api={api}
          loading={workspaceLoading}
          error={workspaceError}
          onRetry={() => setWorkspaceAttempt((value) => value + 1)}
          tab={tab}
          onTabChange={(next) => selected && showWorkspace(selected, next, selectedEmployeeNo)}
          onClose={closeWorkspace}
          locked={busy || delegationBusy}
          delegationBusy={delegationBusy}
          refreshing={workspaceLoading}
          notice={notice}
          employeeNo={selectedEmployeeNo}
          handoffSecret={handoffSecret}
          onClearSecret={clearSecret}
          onEditNote={() => selected && open({ kind: 'note', application: selected })}
          onRevoke={() => selected && open({ kind: 'revoke', application: selected })}
          onRebind={() => selected && open({ kind: 'bind', appKey: selected.appKey })}
          onDelegationBusy={setDelegationBusy}
          onToken={(employeeNo) => selected && showWorkspace(selected, 'token', employeeNo)}
        />
      )}
      {modal && (
        <dialog
          ref={dialog}
          className={`op-access-dialog${modal.kind === 'credentials' ? ' op-access-dialog--secret' : ''}`}
          aria-labelledby="settings-dialog-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <header className="op-access-dialog__head">
            <h2 id="settings-dialog-title">{dialogTitles[modal.kind]}</h2>
            <button type="button" className="op-access-dialog__close" disabled={busy || !!unknownBinding || secretPending} onClick={close} aria-label="关闭弹窗">
              <CloseOutlined aria-hidden />
            </button>
          </header>
          {modal.kind === 'profiles' ? (
            <>
              <div className="op-access-dialog__body">
                <EmployeeProfileSearch api={api} path="/employee-profiles" tenantLabel="当前登录租户" />
              </div>
              <footer className="op-access-dialog__foot">
                <Button onClick={close}>关闭</Button>
              </footer>
            </>
          ) : modal.kind === 'note' ? (
            <form onSubmit={saveNote}>
              <div className="op-access-dialog__body">
                <p className="op-access-dialog__subject">
                  <strong>{modal.application.note || modal.application.appKey}</strong>
                  <IdText value={modal.application.appKey} label="AK" maxChars={40} />
                </p>
                <p className="op-access-help">仅本租户可见；清空后显示凭据的默认名称。不会改变权限或已有 Token。</p>
                <label className="op-access-field">
                  <span>本租户备注</span>
                  <Input
                    name="note"
                    aria-invalid={noteLength > 100}
                    aria-describedby={noteLength > 100 ? 'portal-note-limit portal-note-error' : 'portal-note-limit'}
                    autoFocus
                    value={noteInput}
                    disabled={busy || modal.application.status !== 'ACTIVE'}
                    onChange={(event) => setNoteInput(event.target.value)}
                    placeholder="例如：仓储系统对接"
                  />
                </label>
                <small id="portal-note-limit" className="op-access-help">{noteLength} / 100 字</small>
                {noteLength > 100 && <p id="portal-note-error" role="alert" className="op-access-field-error">本租户备注最多100字，请缩短后保存。</p>}
                {noteChecked && (
                  <p role="status" className="op-access-notice">
                    服务器最新备注：{modal.application.note || '未设置'}。你的输入已保留，请核对后保存。
                  </p>
                )}
                {modal.application.status !== 'ACTIVE' && <p role="alert" className="op-access-field-error">此租户关联已解绑，备注只读。</p>}
                <ErrorFeedback error={error} />
                {noteNeedsCheck && <Button disabled={busy} onClick={() => void checkNote()}>核对最新备注，保留输入</Button>}
              </div>
              <footer className="op-access-dialog__foot">
                <Button onClick={close} disabled={busy}>取消</Button>
                <Button type="primary" htmlType="submit" disabled={busy || noteNeedsCheck || modal.application.status !== 'ACTIVE' || noteLength > 100}>
                  {busy ? '正在处理…' : noteChecked ? '按核对结果保存备注' : '保存备注'}
                </Button>
              </footer>
            </form>
          ) : modal.kind === 'create' || modal.kind === 'bind' ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                if (modal.kind === 'create') {
                  const note = String(data.get('note') || '').trim();
                  void mutate('/applications', note ? { note } : {}, true);
                } else {
                  void mutate('/bindings', { appKey: String(data.get('appKey') || '').trim(), appSecret: bindSecret });
                }
              }}
            >
              <div className="op-access-dialog__body">
                {modal.kind === 'create' ? (
                  <>
                    <p>将为当前租户 <TenantTag name={session.tenantName} id={session.tenantId} /> 生成一套新的接入凭据，并自动绑定本租户。</p>
                    <label className="op-access-field">
                      <span>本租户备注（可选）</span>
                      <Input name="note" maxLength={100} autoFocus placeholder="例如：仓储系统对接" disabled={busy} />
                    </label>
                    <p className="op-access-help">备注仅用于当前租户识别此凭据，可稍后修改；留空显示“未设置本租户备注”。</p>
                    {availability ? (
                      <p role="status" className={`op-access-notice${availability.available ? '' : ' op-access-notice--warning'}`}>
                        {availability.available ? `已就绪：创建时自动分配 ${availability.defaultScopeCount} 个默认权限组。` : availability.reason}
                      </p>
                    ) : (
                      <p role="status" className="op-access-help">{availabilityError || '正在核对可用默认权限…'}</p>
                    )}
                    {availabilityError && <Button onClick={() => setAvailabilityAttempt((value) => value + 1)}>重新核对可用权限</Button>}
                    <details className="op-access-details">
                      <summary>默认权限如何分配？</summary>
                      <p>仅复制创建时启用的默认权限；之后的默认权限调整不会回填已有凭据。</p>
                    </details>
                  </>
                ) : (
                  <>
                    <p>
                      准备团队提供的 AK 和配套 Secret，绑定到当前租户 <TenantTag name={session.tenantName} id={session.tenantId} />
                      。绑定复用原凭据权限，不重新分配默认权限，也不修改其他租户关联。
                    </p>
                    <label className="op-access-field op-access-field--required">
                      <span>绑定用 AppKey</span>
                      <Input
                        name="appKey"
                        required
                        pattern="[a-f0-9]{32}"
                        maxLength={32}
                        defaultValue={modal.appKey}
                        autoComplete="off"
                        autoFocus
                        disabled={busy || !!unknownBinding}
                        title="请输入完整的32位小写十六进制 AK"
                      />
                    </label>
                    <label className="op-access-field op-access-field--required">
                      <span>绑定用 AppSecret</span>
                      <Input.Password
                        name="appSecret"
                        required
                        maxLength={128}
                        autoComplete="off"
                        value={bindSecret}
                        onChange={(event) => setBindSecret(event.target.value)}
                        disabled={busy || !!unknownBinding}
                      />
                    </label>
                    <p className="op-access-help">AK 为 32 位小写十六进制；Secret 最多 128 个字符。校验失败会清除 Secret，请重新填写配套密钥。</p>
                  </>
                )}
                <ErrorFeedback error={error} />
                {unknownBinding && (
                  <p role="status" className="op-access-notice op-access-notice--warning">
                    绑定结果未知，先核对本租户关联，避免重复提交。
                    <Button size="small" disabled={busy} onClick={() => void reconcileBinding()}>核对绑定结果</Button>
                  </p>
                )}
              </div>
              <footer className="op-access-dialog__foot">
                <Button disabled={busy || !!unknownBinding} onClick={close}>取消</Button>
                <Button type="primary" htmlType="submit" disabled={busy || !!unknownBinding || (modal.kind === 'create' && (!!unknown || !availability?.available))}>
                  {busy ? '正在提交…' : modal.kind === 'create' ? '生成并绑定本租户' : '校验并绑定本租户'}
                </Button>
              </footer>
            </form>
          ) : modal.kind === 'credentials' ? (
            <>
              <div className="op-access-dialog__body">
                <SecretDelivery session={session} appKey={modal.appKey} appSecret={modal.appSecret} saved={secretSaved} onSavedChange={setSecretSaved} />
                <ErrorFeedback error={error} />
              </div>
              <footer className="op-access-dialog__foot">
                <Button disabled={!secretSaved || busy} onClick={close}>已保存，清除 Secret</Button>
                <Button type="primary" disabled={!secretSaved || busy} onClick={() => void continueCreated()}>我已保存，继续接入</Button>
              </footer>
            </>
          ) : (
            <>
              <div className="op-access-dialog__body">
                <dl className="op-access-facts op-access-facts--compact">
                  <div><dt>AK</dt><dd><IdText value={modal.application.appKey} label="AK" maxChars={40} /></dd></div>
                  <div><dt>备注</dt><dd>{modal.application.note || <span className="op-muted">未设置</span>}</dd></div>
                  <div><dt>当前租户</dt><dd><TenantTag name={session.tenantName} id={session.tenantId} /></dd></div>
                  <div><dt>凭据状态</dt><dd><credentialStatus.Badge value={modal.application.applicationStatus} /></dd></div>
                  <div><dt>本租户关联</dt><dd><relationStatus.Badge value={modal.application.status} /></dd></div>
                </dl>
                <p className="op-access-notice op-access-notice--danger">
                  将解除以上凭据与本租户的关联。此租户关系及其人员授权派生的已有 Token 将失效；其他租户不受影响。
                </p>
                <p className="op-access-help">重新绑定不会恢复已撤销的旧 Token。其他租户关系不在门户返回或展示。</p>
                <ErrorFeedback error={error} />
              </div>
              <footer className="op-access-dialog__foot">
                <Button autoFocus disabled={busy || !!unknownBinding} onClick={close}>取消</Button>
                <Button type="primary" danger disabled={busy} onClick={() => void mutate(`/bindings/${encodeURIComponent(modal.application.id)}/revoke`, {})}>
                  {busy ? '正在解绑…' : '确认解绑本租户'}
                </Button>
              </footer>
            </>
          )}
        </dialog>
      )}
    </>
  );
}
