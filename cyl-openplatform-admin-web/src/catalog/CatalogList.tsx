import PortalVisibilitySwitch from "./PortalVisibilitySwitch";
import { EllipsisOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { stringifyJson } from '@cyl/open-platform-web-shared/json';
import { ClassRef, EmptyState, FieldLabel, IdText, PageHeader, PersonTag, StatusBadge, type StatusTone } from '@cyl/open-platform-web-shared/ui/components';
import { DataTable, FilterBar, QuickSelect, useDebouncedCallback, type DataTableColumn, type FilterChip } from '@cyl/open-platform-web-shared/ui/list';
import { useRead, useReadPage } from '@cyl/open-platform-web-shared/ui/useReadPage';
import { AutoComplete, Button, Checkbox, Drawer, Dropdown, Input, Segmented, Select, Tag, Tooltip } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { AdminApi } from '../access/api';
import {
  useAdminNavigation,
  type AdminRoute,
  type ApiAccessFilter,
  type ApiListSort,
  type ApiMcpToolFilter,
  type ApiProtocolFilter,
  type ApiPublicationFilter,
  type ApiReviewFilter,
} from '../navigation/AdminNavigation';
import { OwnerPicker } from './CatalogReferenceFields';
import CategoryManagement from './CategoryManagement';
import type { ApiSummary as BaseApiSummary } from './CatalogPanel';
import './CatalogList.css';
import { associationHelp, RuleAssociationLink, useRuleAssociations } from '../governance/RuleAssociationLink';

type ApiSummary = BaseApiSummary & {
  latestReviewStatus?: ApiReviewFilter;
  latestReviewDraftRevision?: number | null;
  updatedAt?: string | null;
};

const publicationNames: Record<ApiPublicationFilter, string> = { PUBLISHED: '已发布', UNPUBLISHED: '未发布' };
const reviewNames: Record<ApiReviewFilter, string> = {
  NOT_SUBMITTED: '无提交记录',
  PENDING_REVIEW: '待审核',
  APPROVED: '审核通过',
  REJECTED: '已驳回',
  NOT_REQUIRED: '免审生效',
  UNKNOWN: '结果未知',
};
const accessNames: Record<ApiAccessFilter, string> = { ENABLED: '访问开启', DISABLED: '访问关闭' };
const mcpToolNames: Record<ApiMcpToolFilter, string> = { ENABLED: '可作为 MCP 工具', DISABLED: '未开放 MCP' };
const sortFields: Record<string, [ApiListSort, ApiListSort]> = { updated: ['UPDATED_DESC', 'UPDATED_ASC'], name: ['NAME_DESC', 'NAME_ASC'] };

/** 列表状态列：一个主状态 + 必要时一行补充，取代原来分散的三列。 */
export function apiStatus(item: ApiSummary): { tone: StatusTone; label: string; detail?: string; note?: string } {
  const draft = `草稿 r${stringifyJson(item.draftRevision)}`;
  const pending = item.pendingReleaseId != null || item.latestReviewStatus === 'PENDING_REVIEW';
  const review = item.latestReviewDraftRevision != null ? `提交 r${stringifyJson(item.latestReviewDraftRevision)}` : undefined;
  if (item.liveDraftRevision == null) {
    if (pending) return { tone: 'info', label: '待审核', detail: review, note: '尚未发布，暂不可调用' };
    if (item.latestReviewStatus === 'REJECTED') return { tone: 'error', label: '已驳回', detail: review, note: '尚未发布，暂不可调用' };
    return { tone: 'neutral', label: '未发布', detail: draft, note: '尚未发布，暂不可调用' };
  }
  const live = `生效 r${stringifyJson(item.liveDraftRevision)}`;
  const note = pending ? `待审核 ${review ?? ''}`.trim() : item.hasUnpublishedChanges ? `${draft} 有未发布修改` : undefined;
  return item.enabled ? { tone: 'success', label: '已发布', detail: live, note } : { tone: 'warning', label: '已暂停', detail: live, note };
}

const formatTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleString('zh-CN', { ...(sameYear ? {} : { year: 'numeric' }), month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
};

/** 输入像类名/方法时，建议改为内部定位搜索。 */
const looksLikeClass = (text: string) => text.includes('#') || /(?:^|\.)[A-Z][A-Za-z0-9]*$/.test(text);

function SmartSearch({ value, onQuery, onInternal }: { value: string; onQuery: (text: string) => void; onInternal: (kind: 'class' | 'method', text: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const debounced = useDebouncedCallback((next: string) => onQuery(next.trim()));
  const keyword = text.trim();
  const [classPart, methodPart] = keyword.split('#');
  const options = keyword
    ? [
        ...(looksLikeClass(keyword) ? [] : [{ value: `name:${keyword}`, label: <span>按名称或标识搜索 <b>{keyword}</b></span> }]),
        { value: `class:${classPart}${methodPart ? `#${methodPart}` : ''}`, label: <span>按内部类搜索 <b>{keyword}</b></span> },
        ...(keyword.includes('#') ? [] : [{ value: `method:${keyword}`, label: <span>按内部方法搜索 <b>{keyword}</b></span> }]),
        ...(looksLikeClass(keyword) ? [{ value: `name:${keyword}`, label: <span>按名称或标识搜索 <b>{keyword}</b></span> }] : []),
      ]
    : [];
  return (
    <AutoComplete
      value={text}
      options={options}
      onChange={(next: string) => {
        if (next.includes(':') && options.some((option) => option.value === next)) return;
        setText(next);
        debounced.run(next);
      }}
      onSelect={(selected: string) => {
        const [kind, ...rest] = selected.split(':');
        const raw = rest.join(':');
        debounced.cancel();
        if (kind === 'name') {
          setText(raw);
          onQuery(raw);
        } else {
          setText('');
          onInternal(kind === 'class' ? 'class' : 'method', raw);
        }
      }}
      popupMatchSelectWidth
    >
      <Input
        allowClear
        aria-label="搜索 API"
        prefix={<SearchOutlined aria-hidden />}
        placeholder="搜索名称、service.method 或内部类"
        maxLength={129}
        onPressEnter={(event) => {
          if (!(event.nativeEvent as KeyboardEvent).isComposing) debounced.flush(text);
        }}
      />
    </AutoComplete>
  );
}

function CategorySelect({ api, value, onChange }: { api: AdminApi; value: string; onChange: (value: string) => void }) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedCallback(setQuery);
  const categories = useReadPage<string>(api, `/apis/categories?page=1&pageSize=50&query=${encodeURIComponent(query)}`);
  const items = (categories.data?.items ?? []).filter((item) => typeof item === 'string' && item.trim());
  return (
    <Select
      aria-label="展示分类"
      showSearch
      allowClear
      value={value || undefined}
      placeholder="不限分类"
      filterOption={false}
      onSearch={debounced.run}
      loading={categories.loading}
      notFoundContent={categories.error ? categories.error : categories.loading ? '正在加载…' : '没有匹配的分类'}
      options={[...new Set([...(value ? [value] : []), ...items])].map((item) => ({ value: item, label: item }))}
      onChange={(next) => onChange(next ?? '')}
      style={{ width: '100%' }}
    />
  );
}

interface OwnerProfile {
  id: string;
  displayName?: string;
  employeeNo?: string;
}

export default function CatalogList({
  api,
  onSelect,
  onCopy,
  accessKey = '',
  canPublish = false,
  onPublicationAction,
}: {
  api: AdminApi;
  accessKey?: string;
  canPublish?: boolean;
  onPublicationAction?: (id: string, action: "status" | "transfer") => void;
  onSelect: (id: string, step?: string) => void;
  onCopy: (source: BaseApiSummary) => void;
}) {
  const [managingCategories, setManagingCategories] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const navigation = useAdminNavigation();
  const route = navigation.route;
  const sort: ApiListSort = route.sort ?? 'UPDATED_DESC';
  const pageSize = route.pageSize ?? 20;
  const current = useRead<OwnerProfile>(api, '/apis/owners/current');
  const me = current.data?.id;

  const parameters = new URLSearchParams({ page: String(route.pageNo), pageSize: String(pageSize), sort });
  for (const key of ['internalClass', 'internalMethod', 'ownerId'] as const) if (route[key]) parameters.set(key, route[key]!);
  if (route.internalClass || route.internalMethod) parameters.set('internalMatch', route.internalMatch ?? 'CONTAINS');
  if (route.query) parameters.set('query', route.query);
  if (route.category) parameters.set('category', route.category);
  route.protocol?.forEach((value) => parameters.append('protocol', value));
  route.publication?.forEach((value) => parameters.append('publication', value));
  route.review?.forEach((value) => parameters.append('review', value));
  route.access?.forEach((value) => parameters.append('access', value));
  route.mcpTool?.forEach((value) => parameters.append('mcpTool', value));
  const list = useReadPage<ApiSummary>(api, `/apis?${parameters}`, accessKey, true, { keepPrevious: true });
  const items: ApiSummary[] = list.data && Array.isArray(list.data.items) ? list.data.items : [];
  const associations = useRuleAssociations(api, 'API', items.map(item => item.id), accessKey);

  /** 任一条件变化立即生效并回到第 1 页。 */
  const update = (changes: Partial<AdminRoute>) => navigation.navigate({ ...route, page: 'catalog', apiId: null, step: 'outer', pageNo: 1, ...changes });
  const clearAll = () =>
    update({ query: '', category: undefined, protocol: [], publication: [], review: [], access: [], mcpTool: [], internalClass: undefined, internalMethod: undefined, internalMatch: undefined, ownerId: undefined });

  const ownerLabel = route.ownerId === me ? '我负责的' : items.find((item) => item.owner === route.ownerId)?.ownerName || '选定人员';
  const chips: FilterChip[] = [];
  const chip = (key: string, text: string, onRemove: () => void) => chips.push({ key, text, label: text, onRemove });
  if (route.query) chip('query', `关键词：${route.query}`, () => update({ query: '' }));
  if (route.internalClass) chip('internalClass', `内部类${route.internalMatch === 'EXACT' ? '（精确）' : ''}：${route.internalClass}`, () => update({ internalClass: undefined }));
  if (route.internalMethod) chip('internalMethod', `内部方法${route.internalMatch === 'EXACT' ? '（精确）' : ''}：${route.internalMethod}`, () => update({ internalMethod: undefined }));
  for (const value of route.protocol ?? []) chip(`protocol:${value}`, `协议：${value === 'DUBBO' ? 'Dubbo' : value}`, () => update({ protocol: route.protocol?.filter((item) => item !== value) }));
  for (const value of route.publication ?? []) chip(`publication:${value}`, `发布：${publicationNames[value]}`, () => update({ publication: route.publication?.filter((item) => item !== value) }));
  for (const value of route.review ?? []) chip(`review:${value}`, `审核：${reviewNames[value]}`, () => update({ review: route.review?.filter((item) => item !== value) }));
  for (const value of route.access ?? []) chip(`access:${value}`, `访问：${accessNames[value]}`, () => update({ access: route.access?.filter((item) => item !== value) }));
  for (const value of route.mcpTool ?? []) chip(`mcpTool:${value}`, `MCP 工具：${mcpToolNames[value]}`, () => update({ mcpTool: route.mcpTool?.filter((item) => item !== value) }));
  if (route.category) chip('category', `分类：${route.category}`, () => update({ category: undefined }));
  if (route.ownerId) chip('ownerId', `负责人：${ownerLabel}`, () => update({ ownerId: undefined }));

  const moreCount =
    (route.category ? 1 : 0) +
    (route.access?.length ?? 0) +
    (route.mcpTool?.length ?? 0) +
    (route.review?.filter((value) => !['PENDING_REVIEW', 'REJECTED'].includes(value)).length ?? 0) +
    (route.internalClass ? 1 : 0) +
    (route.internalMethod ? 1 : 0) +
    (route.ownerId && route.ownerId !== me ? 1 : 0);

  const statusValues = [
    ...(route.publication ?? []).map((value) => `publication:${value}`),
    ...(route.review ?? []).filter((value) => ['PENDING_REVIEW', 'REJECTED'].includes(value)).map((value) => `review:${value}`),
  ];
  const setStatus = (values: string[]) => {
    const pick = (prefix: string) => values.filter((value) => value.startsWith(`${prefix}:`)).map((value) => value.slice(prefix.length + 1));
    const keepReview = (route.review ?? []).filter((value) => !['PENDING_REVIEW', 'REJECTED'].includes(value));
    update({ publication: pick('publication') as ApiPublicationFilter[], review: [...keepReview, ...(pick('review') as ApiReviewFilter[])] });
  };

  const columns: DataTableColumn<ApiSummary>[] = useMemo(
    () => [
      {
        key: 'api',
        title: '接口',
        hideable: false,
        render: (item) => (
          <div className="op-cell-main">
            <span className="api-directory__title-row">
              <Tooltip title={item.name} trigger={['hover', 'focus']} placement="topLeft">
                <button type="button" className="op-cell-main__title is-link" onClick={() => onSelect(item.id, 'outer')}>
                  {item.name}
                </button>
              </Tooltip>
              {item.mcpToolEnabled && (
                <Tooltip title="当前草稿已打开“可作为 MCP 工具”，发布后对网关生效">
                  <Tag className="api-directory__mcp" bordered={false} color="processing">MCP</Tag>
                </Tooltip>
              )}
            </span>
            <IdText value={`${item.service}.${item.method}`} label="service.method" maxChars={44} />
          </div>
        ),
      },
      { key: 'category', title: '分类', width: '10%', render: (item) => <span className="op-cell-ellipsis" title={item.category}>{item.category || <span className="op-muted">未分类</span>}</span> },
      {
        key: 'protocol',
        title: '协议 · 版本',
        label: '协议与版本',
        width: 104,
        render: (item) => <span className="op-code">{item.protocol === 'DUBBO' ? 'Dubbo' : item.protocol} · {item.version}</span>,
      },
      {
        key: 'status',
        title: '状态',
        width: 160,
        render: (item) => {
          const status = apiStatus(item);
          return (
            <div className="op-cell-main">
              <StatusBadge tone={status.tone} detail={status.detail}>{status.label}</StatusBadge>
              {status.note && <span className={`op-cell-sub${status.note.includes('有未发布修改') || status.note.startsWith('待审核') ? ' op-cell-sub--warning' : ''}`}>{status.note}</span>}
            </div>
          );
        },
      },
      {
        key: 'owner',
        title: '负责人',
        width: 112,
        render: (item) =>
          item.ownerProfileLinked ? (
            <PersonTag stacked name={item.ownerName || item.owner} employeeNo={item.ownerEmployeeNo} tenantName={item.ownerTenantName} id={item.ownerTenantId ? `租户 ID ${item.ownerTenantId}` : undefined} />
          ) : (
            <Tooltip title="负责人只有名称记录，尚未关联员工档案；在 API 配置中重新选择人员即可关联。">
              <span className="op-person op-person--stacked">
                <span>{item.owner || '未填写'}</span>
                {item.owner && <span className="op-person__sub">{item.ownerProfileLinked === false ? '未关联档案' : '来源待确认'}</span>}
              </span>
            </Tooltip>
          ),
      },
      {
        key: 'internal',
        title: '内部定位',
        width: '14%',
        defaultHidden: true,
        render: (item) =>
          item.internalClass ? <ClassRef className={item.internalClass} method={item.internalMethod} /> : item.internalMethod ? <span className="op-code">#{item.internalMethod}</span> : <span className="op-muted">—</span>,
      },
      { key: 'portal', title: '门户展示', label: '门户展示', width: 90, render: (item) => <PortalVisibilitySwitch api={api} apiId={item.id} initial={item.portalVisible ?? true} /> },
      { key: 'governance', title: <FieldLabel label="限流规则" help={associationHelp} />, label: '限流规则', width: 88, align: 'right', render: (item) => <RuleAssociationLink apiId={item.id} count={associations.data ? associations.data[item.id] ?? 0 : null} loading={associations.loading} /> },
      { key: 'updated', title: '更新时间', width: 104, sortField: 'updated', render: (item) => <span className="op-cell-sub" title={item.updatedAt ?? undefined}>{formatTime(item.updatedAt)}</span> },
      {
        key: 'actions',
        title: '操作',
        width: 124,
        hideable: false,
        render: (item) => (
          <div className="op-row-actions">
            <Button type="link" size="small" onClick={() => onSelect(item.id, 'outer')}>编辑</Button>
            <Button type="link" size="small" onClick={() => onSelect(item.id, 'test')}>调试</Button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'doc', label: '返回与文档' },
                  { key: 'pub', label: '发布' },
                  ...(canPublish && onPublicationAction ? [
                    { key: 'transfer', label: '发布到其他环境', disabled: item.liveDraftRevision == null },
                    { key: 'status', label: item.enabled ? '停用当前环境 API' : '启用当前环境 API', danger: item.enabled, disabled: item.liveDraftRevision == null },
                  ] : []),
                  { key: 'history', label: '版本记录' },
                  { type: 'divider' },
                  { key: 'copy', label: '复制为新 API' },
                ],
                onClick: ({ key }) => {
                  if (key === 'copy') onCopy(item);
                  else if (key === 'status' || key === 'transfer') onPublicationAction?.(item.id, key);
                  else onSelect(item.id, key);
                },
              }}
            >
              <Button type="text" size="small" icon={<EllipsisOutlined />} aria-label={`${item.name}更多操作`} />
            </Dropdown>
          </div>
        ),
      },
    ],
    [onCopy, onSelect, canPublish, onPublicationAction, associations.data, associations.loading],
  );

  const sortState = (() => {
    const entry = Object.entries(sortFields).find(([, values]) => values.includes(sort));
    return entry ? { field: entry[0], order: entry[1][0] === sort ? ('descend' as const) : ('ascend' as const) } : null;
  })();
  const filtered = chips.length > 0;
  return (
    <section className="api-directory op-list-page" aria-labelledby="catalog-title">
      <PageHeader
        title={<span id="catalog-title">API 列表</span>}
        count={list.data?.total}
        secondaryActions={
          <Tooltip title="刷新">
            <Button icon={<ReloadOutlined />} aria-label="刷新API列表" onClick={() => { list.reload(); if (items.length) associations.reload(); }} />
          </Tooltip>
        }
        primaryAction={<Button type="primary" icon={<PlusOutlined />} onClick={() => onSelect('new')}>新建 API</Button>}
        moreActions={[{ key: 'categories', label: '分类管理' }]}
        onMoreAction={(key) => key === 'categories' && setManagingCategories(true)}
      />
      <div className="op-list-surface">
        <FilterBar
          search={
            <SmartSearch
              value={route.query}
              onQuery={(query) => query !== route.query && update({ query })}
              onInternal={(kind, text) => {
                if (kind === 'class') {
                  const [className, method] = text.split('#');
                  update({ internalClass: className || undefined, internalMethod: method || route.internalMethod, internalMatch: route.internalMatch ?? 'CONTAINS', query: '' });
                } else update({ internalMethod: text, internalMatch: route.internalMatch ?? 'CONTAINS', query: '' });
              }}
            />
          }
          quick={
            <>
              <QuickSelect
                label="协议"
                value={route.protocol?.length === 1 ? route.protocol[0] : undefined}
                allowClear
                onChange={(value) => update({ protocol: value ? [value as ApiProtocolFilter] : [] })}
                options={[{ value: 'HTTP', label: 'HTTP' }, { value: 'DUBBO', label: 'Dubbo' }]}
                style={{ width: 150 }}
              />
              <QuickSelect
                label="状态"
                mode="multiple"
                value={statusValues}
                onChange={(values: string[]) => setStatus(values)}
                options={[
                  { label: '发布', options: [{ value: 'publication:PUBLISHED', label: '已发布' }, { value: 'publication:UNPUBLISHED', label: '未发布' }] },
                  { label: '审核', options: [{ value: 'review:PENDING_REVIEW', label: '待审核' }, { value: 'review:REJECTED', label: '已驳回' }] },
                ]}
                style={{ width: 210 }}
              />
              <QuickSelect
                label="负责人"
                value={route.ownerId ? (route.ownerId === me ? 'me' : 'other') : undefined}
                allowClear
                onChange={(value) => (value === 'other' ? setMoreOpen(true) : update({ ownerId: value === 'me' ? me : undefined }))}
                options={[
                  ...(me ? [{ value: 'me', label: '我负责的' }] : []),
                  { value: 'other', label: route.ownerId && route.ownerId !== me ? ownerLabel : '选择人员…' },
                ]}
                style={{ width: 170 }}
              />
            </>
          }
          moreCount={moreCount}
          onMore={() => setMoreOpen(true)}
          chips={chips}
          onClearAll={clearAll}
        />
        <DataTable<ApiSummary>
          caption="API 列表"
          rowKey={(item) => item.id}
          columns={columns}
          data={list.error ? [] : items}
          loading={list.loading}
          settingsKey="apis"
          forceVisible={route.internalClass || route.internalMethod ? ['internal'] : []}
          summary={list.data ? (filtered ? `筛选出 ${list.data.total} 个 API` : `共 ${list.data.total} 个 API`) : undefined}
          sort={sortState}
          onSortChange={(next) => update({ sort: next ? sortFields[next.field][next.order === 'descend' ? 0 : 1] : 'UPDATED_DESC' })}
          pagination={list.data ? { page: route.pageNo, pageSize, total: list.data.total, onChange: (pageNo, size) => navigation.navigate({ ...route, pageNo: size !== pageSize ? 1 : pageNo, pageSize: size }) } : undefined}
          empty={
            list.error ? (
              <EmptyState kind="error" title="API 列表加载失败" description={list.error} action={<Button onClick={() => { list.reload(); if (items.length) associations.reload(); }}>重新加载</Button>} />
            ) : filtered ? (
              <EmptyState kind="noResult" title="没有符合条件的 API" description="试试减少筛选条件。" action={<Button onClick={clearAll}>清除筛选</Button>} />
            ) : (
              <EmptyState title="还没有 API" description="从 cURL、OpenAPI、Dubbo 签名或空白开始，新建第一个 API。" action={<Button type="primary" icon={<PlusOutlined />} onClick={() => onSelect('new')}>新建 API</Button>} />
            )
          }
        />
      </div>
      <Drawer
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="更多筛选"
        size={400}
        destroyOnHidden
        footer={
          <div className="op-drawer-footer">
            <Button onClick={() => update({ category: undefined, access: [], mcpTool: [], review: (route.review ?? []).filter((value) => ['PENDING_REVIEW', 'REJECTED'].includes(value)), internalClass: undefined, internalMethod: undefined, internalMatch: undefined, ownerId: undefined })}>清除这些条件</Button>
            <Button type="primary" onClick={() => setMoreOpen(false)}>完成</Button>
          </div>
        }
      >
        <div className="op-more-filters">
          <div>
            <FieldLabel label="展示分类" />
            <CategorySelect api={api} value={route.category ?? ''} onChange={(category) => update({ category: category || undefined })} />
          </div>
          <div>
            <FieldLabel label="最近审核 / 提交状态" help="同一项内满足任一选项；不同筛选项同时满足。" />
            <Checkbox.Group
              aria-label="最近审核 / 提交状态"
              value={route.review ?? []}
              onChange={(values) => update({ review: values as ApiReviewFilter[] })}
              options={(Object.keys(reviewNames) as ApiReviewFilter[]).map((value) => ({ value, label: reviewNames[value] }))}
              className="op-checkbox-grid"
            />
          </div>
          <div>
            <FieldLabel label="访问开关" help="已发布后是否允许调用；未发布的 API 始终不可调用。" />
            <Checkbox.Group aria-label="访问开关" value={route.access ?? []} onChange={(values) => update({ access: values as ApiAccessFilter[] })} options={(Object.keys(accessNames) as ApiAccessFilter[]).map((value) => ({ value, label: accessNames[value] }))} />
          </div>
          <div>
            <FieldLabel label="MCP 工具" help="按当前草稿是否打开“可作为 MCP 工具”筛选；发布后才对网关生效。" />
            <Checkbox.Group aria-label="MCP 工具" value={route.mcpTool ?? []} onChange={(values) => update({ mcpTool: values as ApiMcpToolFilter[] })} options={(Object.keys(mcpToolNames) as ApiMcpToolFilter[]).map((value) => ({ value, label: mcpToolNames[value] }))} />
          </div>
          <InternalFilters route={route} update={update} />
          <div>
            <OwnerPicker api={api} value={route.ownerId ?? ''} purpose="filter" label="负责人" onChange={(ownerId) => update({ ownerId: ownerId || undefined })} />
          </div>
        </div>
      </Drawer>
      {managingCategories && <CategoryManagement api={api} onClose={() => setManagingCategories(false)} onChanged={list.reload} />}
    </section>
  );
}

function InternalFilters({ route, update }: { route: AdminRoute; update: (changes: Partial<AdminRoute>) => void }) {
  const [className, setClassName] = useState(route.internalClass ?? '');
  const [method, setMethod] = useState(route.internalMethod ?? '');
  useEffect(() => setClassName(route.internalClass ?? ''), [route.internalClass]);
  useEffect(() => setMethod(route.internalMethod ?? ''), [route.internalMethod]);
  const commitClass = useDebouncedCallback((value: string) => update({ internalClass: value.trim() || undefined }));
  const commitMethod = useDebouncedCallback((value: string) => update({ internalMethod: value.trim() || undefined }));
  return (
    <div className="op-more-filters__group" role="group" aria-label="内部定位">
      <FieldLabel label="内部定位" help="按已登记的 Dubbo 接口类 / Feign 契约类与方法查找。包含匹配按字面处理 % 与 _；精确匹配要求完整类名或简单类名相同。" />
      <Input aria-label="内部类" placeholder="如 OrderQueryFacade 或 com.company…" value={className} maxLength={1024} onChange={(event) => { setClassName(event.target.value); commitClass.run(event.target.value); }} />
      <Input aria-label="内部方法" placeholder="如 lookupByPath" value={method} maxLength={128} onChange={(event) => { setMethod(event.target.value); commitMethod.run(event.target.value); }} />
      <Segmented
        aria-label="内部定位匹配方式"
        value={route.internalMatch ?? 'CONTAINS'}
        options={[{ value: 'CONTAINS', label: '包含' }, { value: 'EXACT', label: '精确' }]}
        onChange={(value) => update({ internalMatch: value as 'CONTAINS' | 'EXACT' })}
      />
    </div>
  );
}
