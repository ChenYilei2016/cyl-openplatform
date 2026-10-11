import { Button } from 'antd';
import { useRead } from '@cyl/open-platform-web-shared/ui/useReadPage';
import type { AdminApi } from '../access/api';
import { useAdminNavigation } from '../navigation/AdminNavigation';

export const associationHelp = '与此对象直接关联且你有权查看的规则，包含草稿、停用及观察规则。点击查看生效状态和阈值；实际调用还可能受其他维度规则约束。';

/** 只查询当前页ID，最多一次批量读取；不为每行读取完整规则。 */
export function useRuleAssociations(api: AdminApi, targetType: 'API' | 'APPLICATION' | 'TENANT', ids: string[], revision: string | number = 0) {
  const parameters = new URLSearchParams({ targetType });
  ids.forEach(id => parameters.append('targetId', id));
  return useRead<Record<string, number>>(api, `/governance-rules/association-counts?${parameters}`, revision, ids.length > 0);
}

export function RuleAssociationLink({ count, loading, apiId, appKey, tenantId }: { count: number | null; loading: boolean; apiId?: string; appKey?: string; tenantId?: string }) {
  const navigation = useAdminNavigation();
  if (count === null && loading) return <span className="op-muted" aria-label="关联规则数加载中">…</span>;
  if (count === 0) return <span className="op-muted">0</span>;
  const open = () => {
    // 清掉规则页遗留筛选，其他列表的检索条件仍保留，浏览器返回可恢复来源页。
    const managementFilters = Object.fromEntries(Object.entries(navigation.route.managementFilters ?? {})
      .filter(([key]) => !key.startsWith('governanceRules.')));
    if (apiId) managementFilters['governanceRules.apiId'] = [apiId];
    if (appKey) managementFilters['governanceRules.appKey'] = [appKey];
    if (tenantId) managementFilters['governanceRules.tenantId'] = [tenantId];
    navigation.navigate({ ...navigation.route, page: 'governance', apiId: null, applicationId: null, tenantId: undefined, governanceRuleId: null, managementFilters });
  };
  return <Button type="link" size="small" onClick={open} aria-label={count === null ? '查看关联规则' : `查看 ${count} 条关联规则`}>
    {count === null ? '查看规则' : `${count} 条`}
  </Button>;
}
