import { AppstoreOutlined, CloseCircleFilled, FolderOpenOutlined, FolderOutlined, RightOutlined, SearchOutlined } from "@ant-design/icons";
import { Pagination, usePage } from "@cyl/open-platform-web-shared/components";
import { usePortalDocumentClient } from "./PortalDocumentReader";
import type { DocumentCategory, DocumentSummary } from "@cyl/open-platform-web-shared/documentation/types";
import type { Page } from "@cyl/open-platform-web-shared/http";
import { Checkbox } from "antd";
import McpBadge from "./McpBadge";
import { useState } from "react";
import StatusPage from "../shell/StatusPage";

/** 分页读取状态：usePage 与 useReadPage 返回同一形状。 */
export interface PageState<T> {
  data: Page<T> | null;
  loading: boolean;
  error: string;
  reload: () => void;
}

const EXPANDED_KEY = "op-portal-doc-tree";
/** 记住的展开分类有上限：每个展开分类各读取一页 20 条，避免进入页面时请求数无界增长。 */
const MAX_EXPANDED = 8;
/** “全部 API”汇总入口在展开集合中的标识（真实分类名不会以 NUL 开头）。 */
export const ALL_GROUP = "\u0000all";

/** 展开状态只是本机阅读偏好（不含任何身份或凭据），存储不可用时只在本次页面生效。 */
export function useExpandedGroups() {
  // 本机偏好只记录用户亲手展开的分类；链接指定而自动展开的分类单独保存，不写入偏好。
  const [persisted, setPersisted] = useState<string[]>(() => {
    try {
      const value: unknown = JSON.parse(window.localStorage.getItem(EXPANDED_KEY) ?? "[]");
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, MAX_EXPANDED) : [];
    } catch {
      return [];
    }
  });
  const [revealed, setRevealed] = useState<string[]>([]);
  const expanded = [...persisted, ...revealed.filter((item) => !persisted.includes(item))].slice(-MAX_EXPANDED);
  const save = (next: string[]) => {
    const bounded = next.slice(-MAX_EXPANDED);
    setPersisted(bounded);
    try {
      window.localStorage.setItem(EXPANDED_KEY, JSON.stringify(bounded));
    } catch {
      /* 存储不可用时只在本次页面生效。 */
    }
  };
  return {
    expanded,
    toggle: (group: string) => {
      if (expanded.includes(group)) {
        setRevealed((current) => current.filter((item) => item !== group));
        save(persisted.filter((item) => item !== group));
      } else save([...persisted, group]);
    },
    /** 链接指定的分类自动展开，但不写入本机偏好。 */
    reveal: (group: string) => setRevealed((current) => (current.includes(group) ? current : [...current, group].slice(-MAX_EXPANDED))),
  };
}

export interface SelectedApi {
  service: string;
  version: string;
  method: string;
}

const isSelected = (item: DocumentSummary, selected: SelectedApi | null) => !!selected && item.service === selected.service && item.version === selected.version && item.method === selected.method;

export function ApiItems({ page, list, selected, label, onSelect, onPage }: { page: number; list: PageState<DocumentSummary>; selected: SelectedApi | null; label: string; onSelect: (item: DocumentSummary) => void; onPage: (page: number) => void }) {
  return (
    <nav className="op-tree__apis" aria-label={label}>
      {list.loading && <p className="op-tree__status" role="status">正在加载…</p>}
      {list.error && (
        <p className="op-tree__status op-tree__status--error" role="alert">
          {list.error}{" "}
          <button type="button" onClick={list.reload}>
            重新加载
          </button>
        </p>
      )}
      {list.data?.items.map((item) => (
        <button
          type="button"
          key={item.apiId}
          className="op-tree__api"
          title={`${item.name} · ${item.service}.${item.method} · ${item.version}`}
          aria-label={`${item.name}${item.mcpSupported ? "，支持 MCP" : ""}`}
          aria-describedby={`tree-meta-${item.apiId}`}
          aria-current={isSelected(item, selected) ? "page" : undefined}
          onClick={() => onSelect(item)}
        >
          <span className="op-tree__api-name">
            {item.name}
            {item.mcpSupported && <McpBadge />}
            {item.lifecycleStatus && item.lifecycleStatus !== "ACTIVE" && <span className="op-tree__api-flag">{item.lifecycleStatus === "RETIRED" ? "已退役" : "已废弃"}</span>}
          </span>
          <small id={`tree-meta-${item.apiId}`}>
            {item.service}.{item.method} · {item.version}
          </small>
        </button>
      ))}
      {list.data && !list.data.items.length && <p className="op-tree__status">没有匹配的公开接口。请清空关键词或改选分类后重试。</p>}
      {list.data && (list.data.total > 20 || page > 1) && <Pagination label={`${label}分页`} page={page} total={list.data.total} disabled={list.loading} onChange={onPage} />}
    </nav>
  );
}

function GroupApis({ category, page, revision, selected, label, onSelect, onPage }: { category: string; page: number; revision: number; selected: SelectedApi | null; label: string; onSelect: (item: DocumentSummary) => void; onPage: (page: number) => void }) {
  const client = usePortalDocumentClient();
  const query = new URLSearchParams(category ? { category } : {});
  query.set("page", String(page));
  query.set("pageSize", "20");
  const list = usePage<DocumentSummary>(client.read, `?${query}`, revision);
  return <ApiItems page={page} list={list} selected={selected} label={label} onSelect={onSelect} onPage={onPage} />;
}

/**
 * 左侧分类树（115 用户故事 7）：搜索框（即时生效 + 搜索语法提示）、图标化分类、展开状态记在本机。
 * 有搜索条件时显示扁平的搜索结果；否则按分类展开，每个分类按 20 条分页读取。
 */
export default function DocumentTree({
  mcpOnly,
  onMcpOnly,
  searchText,
  onSearchText,
  searching,
  results,
  resultPage,
  onResultPage,
  groups,
  groupsPage,
  onGroupsPage,
  expanded,
  onToggle,
  pageOf,
  onGroupPage,
  revision,
  selected,
  onSelect,
  focus,
}: {
  mcpOnly: boolean;
  onMcpOnly: (enabled: boolean) => void;
  searchText: string;
  onSearchText: (text: string) => void;
  searching: boolean;
  results: PageState<DocumentSummary>;
  resultPage: number;
  onResultPage: (page: number) => void;
  groups: PageState<DocumentCategory>;
  groupsPage: number;
  onGroupsPage: (page: number) => void;
  expanded: string[];
  onToggle: (group: string) => void;
  pageOf: (group: string) => number;
  onGroupPage: (group: string, page: number) => void;
  revision: number;
  selected: SelectedApi | null;
  onSelect: (item: DocumentSummary, category: string | null) => void;
  /** 链接或当前文档所在分类：不在本页分类列表中时也单独显示。 */
  focus: string;
}) {
  const renderGroup = (value: string, label: string, count?: number) => {
    const open = expanded.includes(value);
    const all = value === ALL_GROUP;
    const Icon = all ? AppstoreOutlined : open ? FolderOpenOutlined : FolderOutlined;
    return (
      <div className={`op-tree__group${all ? " op-tree__group--all" : ""}`} key={value}>
        <button type="button" className="op-tree__toggle" aria-expanded={open} onClick={() => onToggle(value)}>
          <RightOutlined className="op-tree__caret" aria-hidden />
          <Icon className="op-tree__icon" aria-hidden />
          <span className="op-tree__label">{label}</span>
          {count !== undefined && <span className="op-tree__count">{count}</span>}
        </button>
        {open && <GroupApis category={all ? "" : value} page={pageOf(value)} revision={revision} selected={selected} label={`${label} 接口`} onSelect={(item) => onSelect(item, all ? null : value)} onPage={(page) => onGroupPage(value, page)} />}
      </div>
    );
  };
  return (
    <div className="op-tree">
      <div className="op-tree__mcp-filter"><Checkbox checked={mcpOnly} onChange={event => onMcpOnly(event.target.checked)}>只看支持 MCP</Checkbox></div>
      <div className="op-tree__search">
        <label className="op-tree__input">
          <SearchOutlined aria-hidden />
          <input aria-label="搜索 API 文档" aria-describedby="doc-search-syntax" placeholder="搜索 API 名称、服务或操作" maxLength={200} value={searchText} onChange={(event) => onSearchText(event.target.value)} />
          {searchText && (
            <button type="button" className="op-tree__clear" aria-label="清空搜索" onClick={() => onSearchText("")}>
              <CloseCircleFilled aria-hidden />
            </button>
          )}
        </label>
        <p id="doc-search-syntax" className="op-tree__syntax">
          精确筛选：<code>orders.query</code> <code>service:orders</code> <code>version:v1</code>
        </p>
      </div>
      {searching ? (
        <section className="op-tree__results" aria-label="搜索结果">
          <p className="op-tree__heading">搜索结果{results.data ? ` · ${results.data.total}` : ""}</p>
          <ApiItems page={resultPage} list={results} selected={selected} label="搜索结果接口" onSelect={(item) => onSelect(item, null)} onPage={onResultPage} />
        </section>
      ) : (
        <section className="op-tree__groups" aria-label="文档分类">
          <p className="op-tree__heading">分类</p>
          {groups.error && <StatusPage kind="error" compact description={groups.error} actions={<button type="button" className="op-portal-link-button" onClick={groups.reload}>重新加载</button>} />}
          {groups.loading && <p className="op-tree__status" role="status">正在加载分类…</p>}
          {renderGroup(ALL_GROUP, "全部 API")}
          {groups.data?.items.filter((group) => group.category).map((group) => renderGroup(group.category, group.category, group.apiCount))}
          {focus && groups.data && !groups.data.items.some((group) => group.category === focus) && renderGroup(focus, focus)}
          {groups.data && (groups.data.total > 20 || groupsPage > 1) && <Pagination label="分类分页" page={groupsPage} total={groups.data.total} disabled={groups.loading} onChange={onGroupsPage} />}
        </section>
      )}
    </div>
  );
}
