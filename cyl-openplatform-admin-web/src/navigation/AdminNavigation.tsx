import { Router, createPath, type To, type Navigator } from 'react-router';
import { Alert, Button } from 'antd';
import { pathFor, resolvePath } from './routes';
import './shell.css';
import { createSources, type CreateSource } from '../catalog/create/quickCreateModel';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ApiProtocolFilter = 'HTTP' | 'DUBBO';
export type ApiPublicationFilter = 'PUBLISHED' | 'UNPUBLISHED';
export type ApiReviewFilter =
  | 'NOT_SUBMITTED'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'NOT_REQUIRED'
  | 'UNKNOWN';
export type ApiAccessFilter = 'ENABLED' | 'DISABLED';
export type ApiMcpToolFilter = 'ENABLED' | 'DISABLED';
export type ApiListSort = 'UPDATED_DESC' | 'UPDATED_ASC' | 'NAME_ASC' | 'NAME_DESC';
export interface AdminRoute {
  internalClass?: string;
  internalMatch?: "CONTAINS" | "EXACT";
  internalMethod?: string;
  ownerId?: string;
  sdkAssetId?: string | null;
  operationsView?: "statistics" | "alerts";
  observationId?: string | null;
  observationSource?: string | null;
  observationAt?: string | null;
  governanceRuleId?: string | null;
  administratorId?: string | null;
  /** 权限组抽屉：权限组 ID 或 'new'（新建）。 */
  scopeId?: string | null;
  scopeTab?: 'settings' | 'apis' | 'tenants';
  administratorView?: 'edit' | 'revoke' | 'audit';
  managementFilters?: Record<string, string[]>;
  applicationId?: string | null;
  tenantGrantId?: string | null;
  applicationTab?: 'grants' | 'audit' | 'tokens' | 'signature' | 'scopes';
  releaseId?: string | null;
  transferId?: string | null;
  releaseResult?: 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'FAILED' | 'NOT_REQUIRED';
  tenantId?: string;
  employeeNo?: string;
  page: string;
  apiId: string | null;
  step: string;
  query: string;
  pageNo: number;
  /** 列表每页条数（20/50/100），默认 20 不写入地址。 */
  pageSize?: number;
  /** API 列表排序，默认按更新时间倒序，不写入地址。 */
  sort?: ApiListSort;
  /** 110 新建来源：只在 /apis/new 与导入页有效。 */
  source?: CreateSource;
  category?: string;
  protocol?: ApiProtocolFilter[];
  publication?: ApiPublicationFilter[];
  review?: ApiReviewFilter[];
  access?: ApiAccessFilter[];
  mcpTool?: ApiMcpToolFilter[];
  connectionId?: string | null;
  connectionView?: 'detail' | 'edit' | 'copy';
  connectionRevision?: string;
}
type DraftGuard = (
  | { apiId: string; page?: 'catalog' | 'governance' | 'imports' }
  | { connectionId: string; connectionView?: 'edit' | 'copy' }
  | { applicationId: string; page?: 'applications' | 'tokens'; tenantGrantId?: string | null; protectTenantSwitch?: boolean }
  | { scopeId: string }
  | { governanceRuleId: string }
  | { operationsPolicy: true }
  | { sdkAssetId: () => string }
  | { environmentTransfer: true }
  | { mcpSecret: true }
  | { mcpToolSet: true }
  | { administratorId: string; administratorView?: string }
) & { dirty: () => boolean; busy: () => boolean; save: () => Promise<boolean>; leaveMessage?: string; canSave?: boolean };
const leavesDraft = (target: AdminRoute, draft: DraftGuard) =>
  'environmentTransfer' in draft ? target.page !== 'transfers' || target.transferId !== 'new' :
  'mcpSecret' in draft || 'mcpToolSet' in draft ? target.page !== 'mcp' :
  'sdkAssetId' in draft ? target.page !== 'sdk' || target.sdkAssetId !== draft.sdkAssetId() :
  'applicationId' in draft
    ? target.page !== (draft.page ?? 'applications') || target.applicationId !== draft.applicationId ||
      ((draft.busy() || draft.protectTenantSwitch) && (target.tenantGrantId ?? null) !== (draft.tenantGrantId ?? null))
    : 'administratorId' in draft ? target.page !== 'administrators' || target.administratorId !== draft.administratorId || target.administratorView !== draft.administratorView
    : 'operationsPolicy' in draft ? target.page !== 'operations' || target.operationsView !== 'alerts'
    : 'governanceRuleId' in draft ? target.page !== 'governance' || target.governanceRuleId !== draft.governanceRuleId
    : 'scopeId' in draft ? target.page !== 'scopes' || (target.scopeId ?? null) !== draft.scopeId
    : 'connectionId' in draft
    ? target.page !== 'connections' ||
      target.connectionId !== draft.connectionId ||
      target.connectionView !== (draft.connectionView || 'edit')
    : target.page !== (draft.page ?? 'catalog') || target.apiId !== draft.apiId;
const readMany = <T extends string>(
  parameters: URLSearchParams,
  key: string,
  allowed: readonly T[],
) =>
  [...new Set(parameters.getAll(key))].filter((value): value is T => allowed.includes(value as T));
/** 新建来源只属于新建页与导入页，切换到其他页面时不随路由残留。 */
const sourceScoped = (route: { page: string; apiId: string | null }) => (route.page === 'catalog' && route.apiId === 'new') || route.page === 'imports';
const readRoute = (hash = window.location.hash): AdminRoute => {
  const [path, query = ''] = hash.slice(1).split('?');
  const parameters = new URLSearchParams(query);
  const pageNo = Number(parameters.get('pageNo'));
  const resolved = resolvePath(path ?? '');
  const page = resolved.page;
  const apiId = resolved.apiId !== undefined ? resolved.apiId : parameters.get('api');
  // 旧维护页（/apis/lifecycle）只有带 ?api= 时才定位到“版本与生命周期”，否则回到 API 列表。
  const step = (resolved.page === 'catalog' && !apiId ? undefined : resolved.step) ?? (parameters.get('step') || 'outer');
  const connection = parameters.get('connection');
  const connectionView = parameters.get('view');
  const revision = parameters.get('revision') || '';
  const category = (parameters.get('category') || '').slice(0, 100);
  const locatorText = (key: string, limit: number) => { const value = parameters.get(key); return value && value.length <= limit ? value : undefined; };
  const protocol = readMany(parameters, 'protocol', ['HTTP', 'DUBBO']);
  const publication = readMany(parameters, 'publication', ['PUBLISHED', 'UNPUBLISHED']);
  const review = readMany(parameters, 'review', [
    'NOT_SUBMITTED',
    'PENDING_REVIEW',
    'APPROVED',
    'REJECTED',
    'NOT_REQUIRED',
    'UNKNOWN',
  ]);
  const access = readMany(parameters, 'access', ['ENABLED', 'DISABLED']);
  const mcpTool = readMany(parameters, 'mcpTool', ['ENABLED', 'DISABLED']);
  const applicationId = parameters.get('application');
  const tenantGrantId = parameters.get('tenantGrant');
  const applicationTab = parameters.get('tab') ?? (applicationId ? resolved.applicationTab : null);
  const releaseId = parameters.get('release');
  const transferId = parameters.get('transfer');
  const releaseResult = parameters.get('releaseResult');
  const enumValues: Record<string, readonly string[]> = {
    'sdk.kind': ['PLATFORM','LEGACY_API'],
    'sdk.status': ['DRAFT','PUBLISHED','WITHDRAWN'],
    'governance.type': ['APPLICATION', 'API'],
    'governanceRules.type': ['APPLICATION', 'API', 'TENANT', 'TENANT_API', 'APPLICATION_API'],
    'governanceRules.mode': ['OBSERVE', 'ENFORCE'],
    bucket: ['MINUTE', 'FIVE_MINUTES', 'HOUR'],
    'credentials.status': ['ENABLED', 'DISABLED'],
    relationStatus: ['ACTIVE', 'REVOKED'],
    'tokens.status': ['ACTIVE', 'EXPIRED', 'REVOKED', 'INVALIDATED'],
    subjectType: ['APPLICATION', 'USER'],
    enabled: ['true', 'false'],
    defaultForNewApplication: ['true', 'false'],
    outcome: ['SUCCESS', 'FAILURE'],
    mode: ['PRODUCTION', 'DRAFT_DEBUG'],
    source: ['ACCESS', 'TOKEN', 'CATALOG', 'PUBLICATION'],
  };
  // 列表条件：`filter.<命名空间>.<字段>`，任何页面可自定字段（113/114 useListQuery）；只做长度与字符清洗，已知枚举字段校验取值。
  const managementFilters: Record<string, string[]> = {};
  for (const name of new Set(parameters.keys())) {
    const key = name.startsWith('filter.') ? name.slice(7) : '';
    if (!/^[A-Za-z][A-Za-z0-9]{0,31}\.[A-Za-z][A-Za-z0-9.]{0,63}$/.test(key)) continue;
    const field = key.slice(key.indexOf('.') + 1);
    // 秘密类字段名一律不进入或留在地址中（密钥与完整 Token 不进 URL）。
    if (/secret|password|passwd|authorization|cookie|private|credentialvalue|^(access|refresh)?token$/i.test(field)) continue;
    const allowed = enumValues[key] ?? enumValues[field];
    const values = parameters
      .getAll(name)
      .slice(0, 20)
      .filter(
        (value) =>
          value.length <= 200 &&
          !/[\u0000-\u001f\u007f]/.test(value) &&
          (!allowed || value === '' || allowed.includes(value)) &&
          (field !== 'page' || (/^[1-9]\d{0,3}$/.test(value) && Number(value) <= 5001)),
      );
    if (values.length) managementFilters[key] = [...new Set(values)];
  }
  return {
    ...(Object.keys(managementFilters).length ? { managementFilters } : {}),
    sdkAssetId: parameters.get('sdkAsset')?.slice(0,36) || null,
    operationsView: resolved.operationsView ?? (parameters.get('operationsView') === 'alerts' ? 'alerts' : 'statistics'),
    observationId: parameters.get('record') && /^[A-Za-z0-9_-]{1,36}$/.test(parameters.get('record')!) ? parameters.get('record') : null,
    observationSource: ['ACCESS','TOKEN','CATALOG','PUBLICATION'].includes(parameters.get('recordSource') ?? '') ? parameters.get('recordSource') : null,
    observationAt: parameters.get('recordAt') && parameters.get('recordAt')!.length <= 40 && Number.isFinite(Date.parse(parameters.get('recordAt')!)) ? parameters.get('recordAt') : null,
    governanceRuleId: parameters.get('rule') && /^[A-Za-z0-9:_-]{1,240}$/.test(parameters.get('rule')!) ? parameters.get('rule') : null,
    administratorId: parameters.get('administrator') && parameters.get('administrator')!.length <= 36 ? parameters.get('administrator') : null,
    scopeTab: ["settings", "apis", "tenants"].includes(parameters.get("scopeTab") ?? "") ? parameters.get("scopeTab") as AdminRoute["scopeTab"] : undefined,
    scopeId: page === 'scopes' && parameters.get('scope') && parameters.get('scope')!.length <= 36 ? parameters.get('scope') : null,
    ...(['edit', 'revoke', 'audit'].includes(parameters.get('administratorView') ?? '') ? { administratorView: parameters.get('administratorView') as AdminRoute['administratorView'] } : {}),
    applicationId: applicationId && applicationId.length <= 36 ? applicationId : null,
    tenantGrantId: tenantGrantId && tenantGrantId.length <= 36 ? tenantGrantId : null,
    internalClass: locatorText("internalClass", 1024), internalMethod: locatorText("internalMethod", 128),
    ownerId: locatorText("ownerId", 36),
    internalMatch: parameters.get("internalMatch") === "EXACT" ? "EXACT" : undefined,
    ...(applicationTab &&
    ['grants', 'audit', 'tokens', 'signature', 'scopes'].includes(applicationTab)
      ? { applicationTab: applicationTab as AdminRoute['applicationTab'] }
      : {}),
    releaseId: releaseId && releaseId.length <= 36 ? releaseId : null,
    transferId: transferId && transferId.length <= 36 ? transferId : null,
    ...(releaseResult &&
    ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'FAILED', 'NOT_REQUIRED'].includes(releaseResult)
      ? { releaseResult: releaseResult as AdminRoute['releaseResult'] }
      : {}),
    ...(parameters.get('tenantId') ? { tenantId: parameters.get('tenantId')!.slice(0, 64) } : {}),
    ...(parameters.get('employeeNo')
      ? { employeeNo: parameters.get('employeeNo')!.slice(0, 64) }
      : {}),
    ...(page === 'connections'
      ? {
          connectionId: connection && connection.length <= 36 ? connection : null,
          connectionView: (connectionView === 'edit' || connectionView === 'copy'
            ? connectionView
            : 'detail') as 'detail' | 'edit' | 'copy',
          ...(/^[1-9]\d{0,18}$/.test(revision) ? { connectionRevision: revision } : {}),
        }
      : {}),
    page,
    apiId: apiId && apiId.length <= 36 ? apiId : null,
    step: ['outer', 'mcp', 'inner', 'test', 'doc', 'pub', 'history'].includes(step) ? step : 'outer',
    query: (parameters.get('query') || '').slice(0, 129),
    pageNo: Number.isInteger(pageNo) && pageNo > 0 && pageNo <= 5001 ? pageNo : 1,
    ...(['50', '100'].includes(parameters.get('pageSize') ?? '') ? { pageSize: Number(parameters.get('pageSize')) } : {}),
    ...(['UPDATED_ASC', 'NAME_ASC', 'NAME_DESC'].includes(parameters.get('sort') ?? '') ? { sort: parameters.get('sort') as ApiListSort } : {}),
    ...(sourceScoped({ page, apiId }) && createSources.includes(parameters.get('source') as CreateSource) ? { source: parameters.get('source') as CreateSource } : {}),
    ...(category ? { category } : {}),
    ...(protocol.length ? { protocol } : {}),
    ...(publication.length ? { publication } : {}),
    ...(review.length ? { review } : {}),
    ...(access.length ? { access } : {}),
    ...(mcpTool.length ? { mcpTool } : {}),
  };
};
const routeHash = (route: AdminRoute) => {
  const query = new URLSearchParams();
  for (const [key, values] of Object.entries(route.managementFilters ?? {}))
    for (const value of values) query.append(`filter.${key}`, value);
  if (route.sdkAssetId) query.set('sdkAsset',route.sdkAssetId);
  if (route.observationId) query.set('record',route.observationId);
  if (route.observationSource) query.set('recordSource',route.observationSource);
  if (route.observationAt) query.set('recordAt',route.observationAt);
  if (route.governanceRuleId) query.set('rule', route.governanceRuleId);
  if (route.applicationId) query.set('application', route.applicationId);
  if (route.administratorId) query.set('administrator', route.administratorId);
  if (route.scopeId && route.page === 'scopes') {
    query.set('scope', route.scopeId);
    if (route.scopeTab && route.scopeTab !== 'settings') query.set('scopeTab', route.scopeTab);
  }
  if (route.administratorView) query.set('administratorView', route.administratorView);
  if (route.tenantGrantId) query.set('tenantGrant', route.tenantGrantId);
  if (route.applicationTab) query.set('tab', route.applicationTab);
  if (route.releaseId) query.set('release', route.releaseId);
  if (route.transferId) query.set('transfer', route.transferId);
  if (route.releaseResult) query.set('releaseResult', route.releaseResult);
  if (route.tenantId) query.set('tenantId', route.tenantId);
  if (route.employeeNo) query.set('employeeNo', route.employeeNo);
  // 只有 API 工作区把 api/step 编码在路径中；其他页面（导入、审核、维护）仍用查询参数。
  if (route.apiId && !(route.page === 'catalog')) query.set('api', route.apiId);
  if (route.step && route.step !== 'outer' && !(route.page === 'catalog' && route.apiId)) query.set('step', route.step);
  if (route.page === 'connections' && route.connectionId) {
    query.set('connection', route.connectionId);
    if (route.connectionView) query.set('view', route.connectionView);
    if (route.connectionRevision) query.set('revision', route.connectionRevision);
  }
  if (route.query) query.set('query', route.query);
  if (route.category) query.set('category', route.category);
  for (const key of ["internalClass", "internalMethod", "ownerId", "internalMatch"] as const) if (route[key] && (key !== "internalMatch" || route.internalClass || route.internalMethod)) query.set(key, route[key]!);
  route.protocol?.forEach((value) => query.append('protocol', value));
  route.publication?.forEach((value) => query.append('publication', value));
  route.review?.forEach((value) => query.append('review', value));
  route.access?.forEach((value) => query.append('access', value));
  route.mcpTool?.forEach((value) => query.append('mcpTool', value));
  if (route.pageNo > 1) query.set('pageNo', String(route.pageNo));
  if (route.pageSize && route.pageSize !== 20) query.set('pageSize', String(route.pageSize));
  if (route.sort && route.sort !== 'UPDATED_DESC') query.set('sort', route.sort);
  if (route.source && sourceScoped(route)) query.set('source', route.source);
  return `#${pathFor(route)}${query.size ? `?${query}` : ''}`;
};
/** 旧格式地址（108 之前）需要替换为规范的新地址。 */
const isLegacyHash = (hash = window.location.hash) => resolvePath(hash.slice(1).split('?')[0] ?? '').legacy;
interface Navigation {
  route: AdminRoute;
  navigate: (route: AdminRoute, replace?: boolean) => void;
  registerDraft: (guard: DraftGuard) => () => void;
  reset: (page: string) => void;
}
const Context = createContext<Navigation | null>(null);
const savedActionCopy = {
  test: {
    title: '进入测试页前，选择使用的配置',
    message:
      '进入测试页不会调用接口，点击「执行测试」后才会发起业务请求。保存修改会更新完整草稿，但不会发布；使用已保存配置会保留未保存的输入，测试不使用这些输入。',
    save: '保存修改并进入测试',
    saved: '使用已保存配置进入测试',
  },
  pub: {
    title: '要发布哪份配置？',
    message:
      '保存并发布会先保存完整 API 草稿，再进入发布；仅发布上次保存配置会保留本次输入，本次发布不使用它。',
    save: '保存并发布本次修改',
    saved: '仅发布上次保存配置',
  },
};

export function AdminNavigationProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState(() => readRoute());
  const current = useRef(route);
  const guard = useRef<DraftGuard | null>(null);
  const [pending, setPending] = useState<{
    route: AdminRoute;
    mode: 'leave' | 'saved';
    apply: (target: AdminRoute) => void;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pending && dialog.current && !dialog.current.open) dialog.current.showModal();
    cancelButton.current?.focus();
  }, [pending]);
  const [saving, setSaving] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const index = useRef<number>(Number(window.history.state?.adminIndex) || 0);
  const restoring = useRef(false);
  const commit = useCallback((target: AdminRoute, replace = false) => {
    const parentChanged = target.applicationId !== current.current.applicationId;
    const relationChanged = target.tenantGrantId !== current.current.tenantGrantId;
    if (parentChanged || relationChanged) {
      target = { ...target,
        tenantGrantId: parentChanged ? null : target.tenantGrantId,
        managementFilters: Object.fromEntries(Object.entries(target.managementFilters ?? {}).filter(([key]) =>
          !key.startsWith('userDelegations.') && !(parentChanged && key.startsWith('tokens.')) && !(parentChanged && key.startsWith('tenantRelations.')))),
      };
    }
    if (!replace) index.current++;
    window.history[replace ? 'replaceState' : 'pushState'](
      { ...window.history.state, adminIndex: index.current },
      '',
      routeHash(target),
    );
    current.current = target;
    setRoute(target);
  }, []);
  const request = useCallback((target: AdminRoute, apply: (target: AdminRoute) => void) => {
    const draft = guard.current;
    const leave = draft ? leavesDraft(target, draft) : false;
    const savedStep =
      draft &&
      'apiId' in draft &&
      target.page === 'catalog' &&
      ['test', 'pub'].includes(target.step) &&
      target.step !== current.current.step;
    if (draft?.dirty() && (leave || savedStep)) {
      setSaveError('');
      setPending({ route: target, mode: leave ? 'leave' : 'saved', apply });
    } else {
      setPending(null);
      apply(target);
    }
  }, []);
  const navigate = useCallback(
    (target: AdminRoute, replace = false) =>
      request(target, (resolved) => commit(resolved, replace)),
    [commit, request],
  );
  // 新导航使用React Router；URL/未保存保护只由同一已提交route驱动，旧工作区沿用现有适配器。
  const routerNavigator = useMemo<Navigator>(() => {
    const path = (to: To) => typeof to === 'string' ? to : createPath(to);
    return {
      createHref: to => '#' + path(to),
      go: delta => window.history.go(delta),
      push: to => navigate(readRoute('#' + path(to))),
      replace: to => navigate(readRoute('#' + path(to)), true),
    };
  }, [navigate]);
  const registerDraft = useCallback((draft: DraftGuard) => {
    guard.current = draft;
    setDraftBusy(draft.busy());
    return () => {
      if (guard.current === draft) {
        guard.current = null;
        setDraftBusy(false);
      }
    };
  }, []);
  const reset = useCallback(
    (page: string) => {
      guard.current = null;
      setPending(null);
      commit({ page, apiId: null, step: 'outer', query: '', pageNo: 1 }, true);
    },
    [commit],
  );
  useEffect(() => {
    window.history.replaceState(
      { ...window.history.state, adminIndex: index.current },
      '',
      isLegacyHash() ? routeHash(current.current) : undefined,
    );
    const onPop = () => {
      if (restoring.current) {
        restoring.current = false;
        window.history.replaceState(
          { ...window.history.state, adminIndex: index.current },
          '',
          routeHash(current.current),
        );
        return;
      }
      const target = readRoute();
      const targetIndex = window.history.state?.adminIndex;
      const previousIndex = index.current;
      const draft = guard.current;
      const protectedMove =
        draft?.dirty() &&
        (leavesDraft(target, draft) ||
          ('apiId' in draft &&
            target.page === 'catalog' &&
            ['test', 'pub'].includes(target.step) &&
            target.step !== current.current.step));
      if (protectedMove) {
        if (typeof targetIndex === 'number' && targetIndex !== previousIndex) {
          restoring.current = true;
          window.history.go(previousIndex - targetIndex);
          request(target, (resolved) => {
            index.current = targetIndex;
            current.current = resolved;
            setRoute(resolved);
            restoring.current = true;
            window.history.go(targetIndex - previousIndex);
          });
        } else {
          window.history.replaceState(
            { ...window.history.state, adminIndex: previousIndex },
            '',
            routeHash(current.current),
          );
          request(target, (resolved) => commit(resolved));
        }
      } else {
        index.current = typeof targetIndex === 'number' ? targetIndex : previousIndex;
        current.current = target;
        setRoute(target);
        if (isLegacyHash())
          window.history.replaceState({ ...window.history.state, adminIndex: index.current }, '', routeHash(target));
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (guard.current?.dirty()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [commit, request]);
  const actionCopy =
    pending?.mode === 'saved'
      ? savedActionCopy[pending.route.step === 'test' ? 'test' : 'pub']
      : null;
  return (
    <Context.Provider value={{ route, navigate, registerDraft, reset }}>
      <Router location={routeHash(route).slice(1)} navigator={routerNavigator}>{children}</Router>
      {pending && (
        <dialog
          ref={dialog}
          className="op-leave-dialog"
          aria-labelledby="navigation-title"
          onCancel={(event) => {
            event.preventDefault();
            if (!saving && !draftBusy) setPending(null);
          }}
        >
          <h3 id="navigation-title">{actionCopy?.title ?? '离开前处理未保存更改'}</h3>
          <p>{actionCopy?.message ?? guard.current?.leaveMessage ?? '保存成功后离开，或明确放弃本地更改。'}</p>
          {saveError && <Alert type="error" showIcon title={saveError} />}
          <div className="op-leave-dialog__actions">
            {/* 导航层可能位于主题之外（单元测试、登录前），两字文案不插入空格以保持可访问名称稳定。 */}
            <Button ref={cancelButton} autoFocus autoInsertSpace={false} disabled={saving} onClick={() => setPending(null)}>
              {actionCopy ? '返回编辑' : '取消'}
            </Button>
            {(pending.mode === 'leave' || pending.route.apiId !== 'new') && (
              <Button
                danger={pending.mode === 'leave'}
                disabled={saving || draftBusy}
                onClick={() => {
                  if (pending.mode === 'leave') guard.current = null;
                  pending.apply(pending.route);
                  setPending(null);
                }}
              >
                {actionCopy?.saved ?? '放弃更改并离开'}
              </Button>
            )}
            {guard.current?.canSave !== false && (
              <Button
                type="primary"
                loading={saving}
                disabled={draftBusy}
                onClick={async () => {
                  setSaving(true);
                  setSaveError('');
                  try {
                    if (await guard.current?.save()) {
                      const target =
                        pending.mode === 'saved' && pending.route.apiId === 'new'
                          ? { ...pending.route, apiId: current.current.apiId }
                          : pending.route;
                      pending.apply(target);
                      setPending(null);
                    } else setSaveError('尚未保存，请返回编辑后检查表单错误。');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {actionCopy?.save ?? '保存后继续'}
              </Button>
            )}
          </div>
        </dialog>
      )}
    </Context.Provider>
  );
}
export function useAdminNavigation() {
  const navigation = useContext(Context);
  if (!navigation) throw new Error('后台页面缺少导航上下文');
  return navigation;
}
