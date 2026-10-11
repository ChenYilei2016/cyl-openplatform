/**
 * 108 路径式地址：页面内部仍使用 AdminRoute（page/apiId/step…），
 * 只有地址形态改为可读路径；旧 `#/catalog?api=…&step=…` 等地址解析后由导航上下文替换为新地址。
 */

/** API 工作区页签 ↔ 路径段（通用配置、可选MCP配置、调试、发布、版本）。 */
const stepSegments = {
  outer: 'config',
  mcp: 'mcp',
  test: 'debug',
  pub: 'publish',
  history: 'versions',
} as const;
type Step = keyof typeof stepSegments;
const segmentSteps = Object.fromEntries(Object.entries(stepSegments).map(([step, segment]) => [segment, step])) as Record<string, string>;
/** 108 的旧分段：解析为旧步骤，配置页据此滚动到对应分区，地址规范为 config。 */
const legacySegments: Record<string, string> = { binding: 'inner', response: 'doc' };

/** 一级路径 → 内部页面键。 */
const pagePaths: Record<string, string> = {
  home: '/workbench',
  catalog: '/apis',
  imports: '/apis/import',
  publications: '/reviews',
  transfers: '/reviews/transfers',
  documents: '/docs',
  applications: '/credentials',
  scopes: '/scopes',
  tenantPermissions: '/tenant-permissions',
  mcp: '/mcp',
  connections: '/connections',
  operations: '/analytics',
  calls: '/logs',
  governance: '/traffic-rules',
  audits: '/audits',
  administrators: '/admins',
  sdk: '/sdk',
};

/** 旧地址的一级段（与新路径同名的 scopes/connections/audits/sdk 也在其中，含义一致）。 */
const legacyPages = new Set(Object.keys(pagePaths));
/** 113：Token 排障并入凭据抽屉 Token 页；旧地址替换为凭据列表，带 application 时打开该凭据的 Token 页签。 */
const tokenTroubleshooting = { page: 'applications', applicationTab: 'tokens', legacy: true } as const;

export interface ResolvedPath {
  page: string;
  /** 路径中携带的 API 工作区定位；旧地址时为 undefined，由查询参数决定。 */
  apiId?: string | null;
  step?: string;
  operationsView?: 'statistics' | 'alerts';
  /** 旧 Token 排障地址指向的凭据页签（仅在地址带 application 时生效）。 */
  applicationTab?: 'tokens';
  /** 地址为旧格式或无法识别，需要替换为规范的新地址。 */
  legacy: boolean;
}

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export function resolvePath(path: string): ResolvedPath {
  const segments = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const [first = '', second, third] = segments;
  switch (first) {
    case '':
      return { page: 'home', legacy: true };
    case 'workbench':
      return { page: 'home', legacy: false };
    case 'apis':
      if (!second) return { page: 'catalog', apiId: null, legacy: false };
      // 导入与维护页内嵌编辑器，api/step 仍由查询参数携带。
      if (second === 'import') return { page: 'imports', legacy: false };
      // 112b：维护与退役并入 API 工作区“版本与生命周期”，旧地址 /apis/lifecycle?api= 替换为 /apis/:id/history。
      if (second === 'lifecycle') return { page: 'catalog', step: 'history', legacy: true };
      // 110：新建只有一个地址，来源用 ?source= 区分；旧的 /apis/new/config 替换为 /apis/new。
      if (second === 'new') return { page: 'catalog', apiId: 'new', step: 'outer', legacy: Boolean(third) };
      return {
        page: 'catalog',
        apiId: decode(second),
        step: segmentSteps[third ?? ''] ?? legacySegments[third ?? ''] ?? 'outer',
        legacy: !third || !segmentSteps[third],
      };
    case 'reviews':
      return { page: second === 'transfers' ? 'transfers' : 'publications', legacy: false };
    case 'docs':
      return { page: 'documents', legacy: false };
    case 'credentials':
      return second === 'tokens' ? tokenTroubleshooting : { page: 'applications', legacy: false };
    case 'tokens':
      return tokenTroubleshooting;
    case 'analytics':
      return { page: 'operations', operationsView: 'statistics', legacy: false };
    case 'alerts':
      return { page: 'operations', operationsView: 'alerts', legacy: false };
    case 'logs':
      return { page: 'calls', legacy: false };
    case 'traffic-rules':
      return { page: 'governance', legacy: false };
    case 'admins':
      return { page: 'administrators', legacy: false };
    case 'tenant-permissions':
      return { page: 'tenantPermissions', legacy: false };
    case 'mcp':
      return { page: 'mcp', legacy: false };
    case 'scopes':
    case 'connections':
    case 'audits':
    case 'sdk':
      return { page: first, legacy: false };
    case 'lifecycle':
      // 112b：旧维护与退役页并入 API 工作区“版本与生命周期”（?api= 携带 API）。
      return { page: 'catalog', step: 'history', legacy: true };
    default:
      // 旧地址：页面键直接在一级段，API 定位与步骤在查询参数中。
      return legacyPages.has(first) ? { page: first, legacy: true } : { page: 'home', legacy: true };
  }
}

export function pathFor(route: { page: string; apiId: string | null; step: string; operationsView?: 'statistics' | 'alerts' }) {
  if (route.page === 'catalog' && route.apiId === 'new') return '/apis/new';
  if (route.page === 'catalog' && route.apiId)
    return `/apis/${encodeURIComponent(route.apiId)}/${stepSegments[route.step as Step] ?? 'config'}`;
  if (route.page === 'operations' && route.operationsView === 'alerts') return '/alerts';
  return pagePaths[route.page] ?? '/workbench';
}

/** 菜单、命令面板使用的页面目录（106 第 4 节）。 */
export interface PageEntry {
  page: string;
  path: string;
  title: string;
  group: string;
  keywords?: string;
  permissions: string[];
  superAdmin?: boolean;
  operationsView?: 'statistics' | 'alerts';
}

export const navigationGroups = ['工作台', 'API', '接入', '集成', '运行', '设置'] as const;

export const pageEntries: PageEntry[] = [
  { page: 'home', path: '/workbench', title: '工作台', group: '工作台', keywords: 'home 首页 待办', permissions: [] },
  { page: 'catalog', path: '/apis', title: 'API 列表', group: 'API', keywords: 'api 接口 目录 新建 导入', permissions: ['MANAGE_APIS'] },
  { page: 'publications', path: '/reviews', title: '审核中心', group: 'API', keywords: '审核 发布 待审 跨环境', permissions: ['MANAGE_APIS', 'PUBLISH_APIS', 'REVIEW_APIS'] },
  { page: 'documents', path: '/docs', title: '文档预览', group: 'API', keywords: '文档 doc', permissions: ['MANAGE_APIS', 'PUBLISH_APIS', 'REVIEW_APIS'] },
  { page: 'applications', path: '/credentials', title: '接入凭据', group: '接入', keywords: 'ak 应用 凭据 token 授权', permissions: ['MANAGE_APPLICATIONS'] },
  { page: 'scopes', path: '/scopes', title: '权限组', group: '接入', keywords: 'scope 权限', permissions: ['MANAGE_APPLICATIONS'] },
  { page: 'tenantPermissions', path: '/tenant-permissions', title: '租户权限', group: '接入', keywords: '租户 tenant 权限 scope 授予', permissions: ['MANAGE_APPLICATIONS'] },
  { page: 'mcp', path: '/mcp', title: 'MCP 接入', group: '接入', keywords: 'mcp 网关 ai 工具 开通 签名', permissions: ['MANAGE_APPLICATIONS'] },
  { page: 'connections', path: '/connections', title: 'Dubbo 服务连接', group: '集成', keywords: 'dubbo nacos 注册中心 连接', permissions: ['MANAGE_CONNECTIONS', 'MANAGE_APIS'] },
  { page: 'operations', path: '/analytics', title: '调用分析', group: '运行', keywords: '统计 分析 排行 成功率', permissions: ['VIEW_AUDIT'], operationsView: 'statistics' },
  { page: 'calls', path: '/logs', title: '调用日志', group: '运行', keywords: '日志 requestId 失败', permissions: ['VIEW_AUDIT'] },
  { page: 'operations', path: '/alerts', title: '告警', group: '运行', keywords: '告警 alert', permissions: ['VIEW_AUDIT'], operationsView: 'alerts' },
  { page: 'governance', path: '/traffic-rules', title: '限流与访问控制', group: '运行', keywords: '限流 配额 ip 治理 规则', permissions: ['MANAGE_APIS', 'MANAGE_APPLICATIONS'] },
  { page: 'administrators', path: '/admins', title: '管理员', group: '设置', keywords: '管理员 权限', permissions: ['VIEW_AUDIT'], superAdmin: true },
  { page: 'audits', path: '/audits', title: '管理审计', group: '设置', keywords: '审计 操作记录', permissions: ['VIEW_AUDIT'] },
  { page: 'sdk', path: '/sdk', title: 'Java SDK', group: '设置', keywords: 'sdk java 客户端', permissions: ['MANAGE_APIS', 'PUBLISH_APIS', 'REVIEW_APIS'] },
];

/** 不在菜单中、但仍可达的页面（由所在工作区进入），用于页面标题与“最近访问”。 */
const secondaryTitles: Record<string, string> = {
  imports: '接入 API',
  transfers: '跨环境发布',
};

export function canSee(entry: Pick<PageEntry, 'permissions' | 'superAdmin'>, session: { permissions: string[]; superAdministrator: boolean }) {
  if (!entry.permissions.length) return true;
  return (entry.superAdmin && session.superAdministrator) || entry.permissions.some((permission) => session.permissions.includes(permission));
}

export function titleFor(route: { page: string; apiId: string | null; operationsView?: 'statistics' | 'alerts' }) {
  if (route.page === 'catalog' && route.apiId) return route.apiId === 'new' ? '新建 API' : 'API 工作区';
  if (route.page === 'operations') return route.operationsView === 'alerts' ? '告警' : '调用分析';
  return pageEntries.find((entry) => entry.page === route.page)?.title ?? secondaryTitles[route.page] ?? '管理后台';
}

/** 当前路由属于哪个菜单项（子页面高亮其所属入口）。 */
export function activeEntryPath(route: { page: string; operationsView?: 'statistics' | 'alerts' }) {
  const owner: Record<string, string> = { imports: '/apis', transfers: '/reviews' };
  if (owner[route.page]) return owner[route.page];
  if (route.page === 'operations') return route.operationsView === 'alerts' ? '/alerts' : '/analytics';
  return pagePaths[route.page] ?? '/workbench';
}
