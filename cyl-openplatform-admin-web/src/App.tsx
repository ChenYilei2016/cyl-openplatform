import { clearReadPages } from '@cyl/open-platform-web-shared/ui/useReadPage';
import { PlatformTheme } from '@cyl/open-platform-web-shared/ui/PlatformTheme';
import AdminShell from './navigation/AdminShell';
import AuthScreen from './navigation/AuthScreen';
import Workbench from './workbench/Workbench';
import { Alert, Button } from 'antd';
import WorkspaceBoundary from './navigation/WorkspaceBoundary';
import { AdminNavigationProvider, useAdminNavigation } from './navigation/AdminNavigation';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAdminApi, type AdminApi } from './access/api';










import { createDocumentClient } from '@cyl/open-platform-web-shared/documentation/api';





import { permissionNames } from './administration/types';
import type { PublicationSubmission } from './publication/types';

const ApplicationsPanel = lazy(() => import('./access/ApplicationsPanel'));
const ScopesPanel = lazy(() => import('./access/ScopesPanel'));
const TenantPermissionsPanel = lazy(() => import('./access/TenantPermissionsPanel'));
const McpPanel = lazy(() => import('./mcp/McpPanel'));
const CatalogPanel = lazy(() => import('./catalog/CatalogPanel'));
const PublicationPanel = lazy(() => import('./publication/PublicationPanel'));
const GovernancePanel = lazy(() => import('./governance/GovernanceWorkspace'));
const OperationsPanel = lazy(() => import('./operations/OperationsPanel'));
const ObservabilityPanel = lazy(() => import('./observability/ObservabilityPanel'));
const DocumentExplorer = lazy(() => import('@cyl/open-platform-web-shared/documentation/DocumentExplorer'));
const SdkAssetsPanel = lazy(() => import('./sdk/SdkAssetsPanel'));
const DubboConnections = lazy(() => import('./connections/DubboConnections'));
const ApiOnboarding = lazy(() => import('./importing/ApiOnboarding'));
const EnvironmentReleaseRecords = lazy(() => import('./environmentrelease/EnvironmentReleaseRecords'));
const AdministratorsPanel = lazy(() => import('./administration/AdministratorsPanel'));

interface ApiResponse<T> {
  code: number;
  resultMsg: string;
  data: T;
  requestId: string;
}

interface PlatformInfo {
  name: string;
  adminLoginUrl: string | null;
  environmentId?: string;
}

interface AdminSession {
  administratorId: string;
  employeeId: string;
  superAdministrator: boolean;
  tenantId: string;
  userId: string;
  employeeNo: string;
  displayName: string;
  permissions: string[];
}

function validSession(session: AdminSession | null): session is AdminSession {
  return Boolean(
    session &&
    [
      session.administratorId,
      session.employeeId,
      session.tenantId,
      session.userId,
      session.employeeNo,
    ].every((value) => typeof value === 'string' && value.length > 0) &&
    typeof session.superAdministrator === 'boolean' &&
    typeof session.displayName === 'string' &&
    Array.isArray(session.permissions) &&
    session.permissions.every((value) => typeof value === 'string'),
  );
}

type SessionState =
  | { status: 'loading' | 'unauthorized' | 'forbidden' | 'error' }
  | { status: 'authenticated'; session: AdminSession; csrfToken: string | null };

export default function App() {
  return (
    <PlatformTheme><AdminNavigationProvider>
      <AdminConsole />
    </AdminNavigationProvider></PlatformTheme>
  );
}

function AdminConsole() {
  const navigation = useAdminNavigation();
  const page = navigation.route.page;
  const setPage = (page: string) =>
    navigation.navigate({ page, apiId: null, step: 'outer', query: '', pageNo: 1 });
  const [platform, setPlatform] = useState<PlatformInfo>({
    name: 'CYL · 开放平台',
    adminLoginUrl: null,
  });
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const sessionState = useRef(state);
  sessionState.current = state;
  const expireSession = useCallback(() => {
    setState({ status: 'unauthorized' });
    navigation.reset('home');
  }, [navigation.reset]);
  const [permissionNotice, setPermissionNotice] = useState('');
  const refreshing = useRef(false);
  const refreshSession = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const response = await fetch('/admin-api/session', {
        credentials: 'same-origin',
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 401) {
        expireSession();
        return;
      }
      if (response.status === 403) {
        setState((current) =>
          current.status === 'authenticated'
            ? {
                ...current,
                session: { ...current.session, permissions: [], superAdministrator: false },
              }
            : current,
        );
        setPermissionNotice('当前管理资格已被撤销，请联系总管理员。已保留当前页面的未保存输入。');
        return;
      }
      if (!response.ok) throw new Error('会话权限暂时无法刷新，请稍后重试。');
      const result: ApiResponse<AdminSession> = await response.json();
      if (result.code !== 200 || !validSession(result.data))
        throw new Error('会话权限暂时无法刷新，请稍后重试。');
      setState((current) =>
        current.status === 'authenticated'
          ? {
              ...current,
              session: result.data,
              csrfToken: response.headers.get('X-CSRF-Token') ?? current.csrfToken,
            }
          : current,
      );
      const previous = sessionState.current;
      const changed = previous.status === 'authenticated' &&
        (previous.session.superAdministrator !== result.data.superAdministrator ||
         [...previous.session.permissions].sort().join() !== [...result.data.permissions].sort().join());
      setPermissionNotice(changed ? '管理权限已更新，当前未保存输入保留；操作权限以服务端核验为准。' : '');
    } catch (error) {
      setPermissionNotice((error as Error).message);
    } finally {
      refreshing.current = false;
    }
  }, [expireSession]);
  const identityKey = state.status === 'authenticated'
    ? JSON.stringify([state.session.tenantId, state.session.userId, state.session.employeeId]) : state.status;
  const csrfToken = state.status === 'authenticated' ? state.csrfToken : null;
  // 保留页面以便复制未保存输入，但已撤销页面资格时不能再次发起写请求。
  const currentPageDenied = useRef(false);
  const api = useMemo(() => {
    const request = createAdminApi(csrfToken, expireSession, refreshSession);
    const guarded: AdminApi = (path, options = {}) => {
      if (currentPageDenied.current && (options.method ?? 'GET') !== 'GET')
        return Promise.reject(new Error('当前已无此页面的操作权限，请联系总管理员。输入已保留，本次未提交。'));
      return request(path, options);
    };
    return guarded;
  }, [csrfToken, expireSession, refreshSession, identityKey]);
  useEffect(() => () => clearReadPages(api), [api]);
  const documents = useMemo(
    () => createDocumentClient({ adminApi: api, onUnauthorized: expireSession }),
    [api, expireSession],
  );
  const pendingEnvironmentTransfers = useMemo(() => new Map<string, string>(), [identityKey]);
  const publicationNotes = useMemo(() => new Map<string,string>(), [identityKey]);
  const pendingSubmissions = useMemo(() => new Map<string, PublicationSubmission>(), [identityKey]);
  useEffect(() => {
    const protectPublicationInputs = (event: BeforeUnloadEvent) => {
      if (!publicationNotes.size && !pendingSubmissions.size && !pendingEnvironmentTransfers.size) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectPublicationInputs);
    return () => window.removeEventListener('beforeunload', protectPublicationInputs);
  }, [publicationNotes, pendingSubmissions, pendingEnvironmentTransfers]);
  const [attempt, setAttempt] = useState(0);


  const requirements: Record<string, string[]> = {
    calls: ['VIEW_AUDIT'],
    audits: ['VIEW_AUDIT'],
    imports: ['MANAGE_APIS'],
    transfers: ['MANAGE_APIS', 'PUBLISH_APIS', 'REVIEW_APIS'],
    catalog: ['MANAGE_APIS'],
    applications: ['MANAGE_APPLICATIONS'],
    scopes: ['MANAGE_APPLICATIONS'],
    tenantPermissions: ['MANAGE_APPLICATIONS'],
    mcp: ['MANAGE_APPLICATIONS'],
    publications: ['MANAGE_APIS', 'PUBLISH_APIS', 'REVIEW_APIS'],
    documents: ['MANAGE_APIS', 'PUBLISH_APIS', 'REVIEW_APIS'],
    sdk: ['MANAGE_APIS', 'PUBLISH_APIS', 'REVIEW_APIS'],
    connections: ['MANAGE_CONNECTIONS', 'MANAGE_APIS'],
    governance: ['MANAGE_APIS', 'MANAGE_APPLICATIONS'],
    operations: ['VIEW_AUDIT'],
  };
  const pageDenied =
    state.status === 'authenticated' &&
    (page === 'administrators'
      ? !state.session.superAdministrator && !state.session.permissions.includes('VIEW_AUDIT')
      : Boolean(
          requirements[page] &&
          !requirements[page].some((permission) => state.session.permissions.includes(permission)),
        ));
  currentPageDenied.current = pageDenied;
  // 权限刷新更新入口和操作权限，保留当前已打开页面，避免丢失非秘密草稿。
  const retainedPage = useRef<{ page: string; session: AdminSession } | null>(null);
  if (state.status === 'authenticated' && retainedPage.current?.page !== page)
    retainedPage.current = { page, session: state.session };
  if (state.status === 'authenticated' && retainedPage.current) {
    retainedPage.current.session = {
      ...state.session,
      permissions: [
        ...new Set([...retainedPage.current.session.permissions, ...state.session.permissions]),
      ],
      superAdministrator:
        retainedPage.current.session.superAdministrator || state.session.superAdministrator,
    };
  }
  if (state.status === 'unauthorized') retainedPage.current = null;
  const pagePermissions =
    retainedPage.current?.page === page ? retainedPage.current.session.permissions : [];
  const pageCanReadPublications = pagePermissions.some((permission) =>
    ['MANAGE_APIS', 'PUBLISH_APIS', 'REVIEW_APIS'].includes(permission),
  );

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    setState({ status: 'loading' });
    void (async () => {
      const [infoResponse, sessionResponse] = await Promise.all([
        fetch('/platform-info', { credentials: 'same-origin', signal }),
        fetch('/admin-api/session', { credentials: 'same-origin', signal }),
      ]);
      if (!infoResponse.ok) throw new Error('平台信息不可用');
      const info: ApiResponse<PlatformInfo> = await infoResponse.json();
      if (info.code !== 200 || !info.data || typeof info.data.name !== 'string')
        throw new Error('平台信息不可用');
      if (info.data.adminLoginUrl) {
        const loginUrl = new URL(info.data.adminLoginUrl, window.location.origin);
        if (!['http:', 'https:'].includes(loginUrl.protocol)) throw new Error('登录入口不可用');
      }
      if (controller.signal.aborted) return;
      setPlatform(info.data);
      if (sessionResponse.status === 401) {
        setState({ status: 'unauthorized' });
        return;
      }
      if (sessionResponse.status === 403) {
        setState({ status: 'forbidden' });
        return;
      }
      if (!sessionResponse.ok) throw new Error('会话不可用');
      const response: ApiResponse<AdminSession> = await sessionResponse.json();
      const session = response.data;
      if (response.code !== 200 || !validSession(session)) {
        throw new Error('会话信息不完整');
      }
      if (!controller.signal.aborted) {
        setState({
          status: 'authenticated',
          session,
          csrfToken: sessionResponse.headers.get('X-CSRF-Token'),
        });
        if (window.location.hash === '' || window.location.hash === '#/home')
          navigation.reset('home');
      }
    })().catch(() => {
      if (!controller.signal.aborted) setState({ status: 'error' });
    });
    return () => controller.abort();
  }, [attempt]);

  if (state.status !== 'authenticated')
    return <AuthScreen name={platform.name} status={state.status} loginUrl={platform.adminLoginUrl} onRetry={() => setAttempt((value) => value + 1)} />;
  return (
    <AdminShell name={platform.name} environmentId={platform.environmentId} session={state.session} api={api}>
      <main id="main" tabIndex={-1} className="op-shell__main">
        <div className="admin-content">
          {page !== 'home' && <h1 className="sr-only">管理后台</h1>}
          <WorkspaceBoundary key={page}><Suspense fallback={<p role="status">正在加载工作区…</p>}>
          {state.status === 'authenticated' && permissionNotice && (
            <Alert
              type="info"
              showIcon
              role="status"
              className="op-shell__notice"
              title={permissionNotice}
              closable={{ 'aria-label': '关闭权限提示' }}
              onClose={() => setPermissionNotice('')}
            />
          )}
          {pageDenied && (
            <section className="op-shell__denied" role="alert">
              <h2>暂无此页面的操作权限</h2>
              <p>
                {page === 'administrators'
                  ? '查看管理员需要总管理员身份或审计查询权限；分配权限仅限总管理员。'
                  : `需要${requirements[page].map((code) => permissionNames[code] ?? code).join('或')}权限。`}{' '}
                请联系总管理员；当前页面不会自动跳转。
              </p>
              <Button onClick={() => void refreshSession()}>重新检查权限</Button>
            </section>
          )}
          {page === 'home' && <Workbench api={api} session={state.session} />}
          {page === 'administrators' &&
            state.status === 'authenticated' &&
            (retainedPage.current?.session.superAdministrator ||
              pagePermissions.includes('VIEW_AUDIT')) && (
              <AdministratorsPanel
                api={api}
                currentTenantId={state.session.tenantId}
                canManage={Boolean(state.session.superAdministrator)}
                canRead={Boolean(
                  state.session.superAdministrator ||
                  state.session.permissions.includes('VIEW_AUDIT'),
                )}
                onChanged={() => void refreshSession()}
              />
            )}
          {page === 'applications' &&
            state.status === 'authenticated' &&
            pagePermissions.includes('MANAGE_APPLICATIONS') && (
              <ApplicationsPanel
                key={identityKey}
                api={api}
                canReadCalls={state.session.permissions.includes('VIEW_AUDIT')}
                applicationId={navigation.route.applicationId}
                tab={navigation.route.applicationTab}
                onSelect={(applicationId, applicationTab) =>
                  navigation.navigate({ ...navigation.route, applicationId, applicationTab })
                }
                onBack={() =>
                  navigation.navigate({
                    ...navigation.route,
                    applicationId: null,
                    applicationTab: undefined,
                    tenantId: undefined,
                    employeeNo: undefined,
                  })
                }
              />
            )}
          {page === 'scopes' &&
            state.status === 'authenticated' &&
            pagePermissions.includes('MANAGE_APPLICATIONS') && (
              <ScopesPanel api={api} canEditApis={state.session.permissions.includes('MANAGE_APIS')} />
            )}
          {page === 'tenantPermissions' && state.status === 'authenticated' && pagePermissions.includes('MANAGE_APPLICATIONS') && <TenantPermissionsPanel key={identityKey} api={api} />}
          {page === 'mcp' &&
            state.status === 'authenticated' &&
            pagePermissions.includes('MANAGE_APPLICATIONS') && <McpPanel key={identityKey} api={api} />}
          {page === 'catalog' &&
            state.status === 'authenticated' &&
            pagePermissions.includes('MANAGE_APIS') && (
              <CatalogPanel
                key={JSON.stringify([state.session.tenantId, state.session.employeeNo])}
                api={api}
                operatorKey={JSON.stringify([state.session.tenantId, state.session.employeeNo])}
                permissions={state.session.permissions}
                publicationNotes={publicationNotes}
                pendingSubmissions={pendingSubmissions}
              />
            )}
          {page === 'publications' &&
            state.status === 'authenticated' &&
            pageCanReadPublications && (
              <PublicationPanel
                api={api}
                permissions={state.session.permissions}
                publicationNotes={publicationNotes}
                pendingSubmissions={pendingSubmissions}
              />
            )}
          {page === 'governance' &&
            state.status === 'authenticated' &&
            pagePermissions.some((permission) =>
              ['MANAGE_APPLICATIONS', 'MANAGE_APIS'].includes(permission),
            ) && <GovernancePanel key={identityKey} api={api} permissions={state.session.permissions} />}
          {['calls', 'audits'].includes(page) &&
            state.status === 'authenticated' &&
            pagePermissions.includes('VIEW_AUDIT') && (
              <ObservabilityPanel
                key={`${identityKey}:${page}`}
                api={api}
                initialView={page === 'audits' ? 'audits' : 'calls'}
                permissions={state.session.permissions}
                initialFilters={{
                  applicationId: navigation.route.applicationId ?? '',
                  tenantId: navigation.route.tenantId ?? '',
                  employeeNo: navigation.route.employeeNo ?? '',
                }}
                onOpenCredential={
                  state.session.permissions.includes('MANAGE_APPLICATIONS')
                    ? (applicationId) =>
                        navigation.navigate({
                          page: 'applications',
                          apiId: null,
                          step: 'outer',
                          query: '',
                          pageNo: 1,
                          applicationId,
                        })
                    : undefined
                }
              />
            )}
          {page === 'imports' &&
            state.status === 'authenticated' &&
            pagePermissions.includes('MANAGE_APIS') && (
              <ApiOnboarding key={identityKey} api={api} initialKind={navigation.route.source === 'json' ? 'PLATFORM' : navigation.route.source === 'curl' ? 'HTTP' : 'OPENAPI'} operatorKey={JSON.stringify([state.session.tenantId, state.session.employeeNo])}
                onReturn={()=>navigation.navigate({...navigation.route,page:'catalog',apiId:null,step:'outer'})}
                onManual={()=>navigation.navigate({...navigation.route,page:'catalog',apiId:'new',step:'outer'})}
                onOpen={id=>navigation.navigate({...navigation.route,page:'catalog',apiId:id,step:'test'})}/>

            )}
          {page === 'transfers' && state.status === 'authenticated' && pageCanReadPublications && (
            <EnvironmentReleaseRecords
              key={identityKey}
              api={api}
              permissions={state.session.permissions}
              pendingTransfers={pendingEnvironmentTransfers}
            />
          )}
          {page === 'operations' &&
            state.status === 'authenticated' &&
            pagePermissions.includes('VIEW_AUDIT') && (
              <OperationsPanel key={identityKey} api={api} permissions={state.session.permissions} />
            )}
          {page === 'documents' && state.status === 'authenticated' && pageCanReadPublications && (
            <DocumentExplorer client={documents} showRawSchema title="文档预览" />
          )}
          {page === 'connections' &&
            state.status === 'authenticated' &&
            pagePermissions.some((permission) =>
              ['MANAGE_CONNECTIONS', 'MANAGE_APIS'].includes(permission),
            ) && (
              <DubboConnections
                key={identityKey}
                api={api}
                canManage={state.session.permissions.includes('MANAGE_CONNECTIONS')}
              />
            )}
          {page === 'sdk' && state.status === 'authenticated' && pageCanReadPublications && (
            <SdkAssetsPanel
              key={identityKey}
              api={api}
              csrfToken={csrfToken}
              onUnauthorized={expireSession}
              permissions={state.session.permissions}
            />
          )}
          </Suspense></WorkspaceBoundary>
        </div>
      </main>
    </AdminShell>
  );
}
