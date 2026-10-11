import { FolderOutlined, MenuOutlined } from "@ant-design/icons";
import { usePage } from "@cyl/open-platform-web-shared/components";
import { usePortalDocumentClient } from "./PortalDocumentReader";
import type { DocumentCategory, DocumentSummary } from "@cyl/open-platform-web-shared/documentation/types";
import { StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { useCallback, useEffect, useRef, useState } from "react";
import StatusPage from "../shell/StatusPage";
import type { PortalNavigate } from "./CustomerDocuments";
import { filterNames, formatSearch, pageNumber, parseSearch, readFilters, sameFilters } from "./docSearch";
import DocumentTree, { ALL_GROUP, useExpandedGroups, type SelectedApi } from "./DocumentTree";
import PublicDocumentDetail from "./PublicDocumentDetail";
import McpBadge from "./McpBadge";
import "./api-docs.css";

const SEARCH_DELAY = 300;

/**
 * API 文档页（115）：左分类树 280px / 中正文 / 右侧本页目录与在线调试 360px，窄屏依次折叠。
 * 地址参数即状态：category（聚焦分类）、query/service/method/version（搜索）、apiService/apiVersion/apiMethod（当前文档）。
 */
export default function PublicDocuments({ params, navigate: onNavigate, gatewayBaseUrl = "" }: { params: URLSearchParams; navigate: PortalNavigate; gatewayBaseUrl?: string }) {
  const navigate: PortalNavigate = (changes, reset, replace) => onNavigate({ section: "documents", ...changes }, reset, replace);
  const client = usePortalDocumentClient();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const filters = readFilters(params);
  const mcpOnly = params.get("mcpOnly") === "true";
  const searching = mcpOnly || filterNames.some((name) => filters[name]);
  const page = pageNumber(params.get("page"));
  const categoryPage = pageNumber(params.get("categoryPage"));
  const category = params.get("category") || "";
  const service = params.get("apiService") || "";
  const version = params.get("apiVersion") || "";
  const method = params.get("apiMethod") || "";
  const selected: SelectedApi | null = service && version && method ? { service, version, method } : null;

  // 搜索即时生效：输入防抖后写入地址（替换当前历史记录）；地址被返回键等外部改变时同步回输入框。
  const [searchText, setSearchText] = useState(() => formatSearch(filters));
  const urlSearch = formatSearch(filters);
  useEffect(() => {
    setSearchText((text) => (sameFilters(parseSearch(text), readFilters(params)) ? text : urlSearch));
  }, [urlSearch]);
  // 只响应用户输入：输入框文字仍等于地址条件的显示形式时不改写地址（旧链接 query=a.b 不会被重解释为精确筛选）。
  // 正在阅读的文档保持打开，直到精确条件真正命中另一个接口（见下方直达），避免输入到一半的 orders.q 关闭正文。
  useEffect(() => {
    const current = readFilters(new URLSearchParams(location.search));
    const parsed = parseSearch(searchText);
    if (searchText === formatSearch(current) || sameFilters(parsed, current)) return;
    const timer = window.setTimeout(() => navigate({ ...parsed, page: null, category: null }, false, true), SEARCH_DELAY);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const resultQuery = new URLSearchParams();
  for (const name of filterNames) if (filters[name]) resultQuery.set(name, filters[name]);
  if (mcpOnly) resultQuery.set("mcpOnly", "true");
  resultQuery.set("page", String(page));
  resultQuery.set("pageSize", "20");
  const results = useReadPage<DocumentSummary>(client.read, `?${resultQuery}`, revision, searching, { keepPrevious: true });
  const groups = usePage<DocumentCategory>(client.read, `/categories?page=${categoryPage}&pageSize=20${mcpOnly ? "&mcpOnly=true" : ""}`, revision);

  const tree = useExpandedGroups();
  useEffect(() => {
    if (category) tree.reveal(category);
  }, [category]);
  const [groupPages, setGroupPages] = useState<Record<string, number>>({});
  const [directoryOpen, setDirectoryOpen] = useState(false);

  const open = (item: DocumentSummary, itemCategory: string | null, replace = false) => {
    if (selected && item.service === service && item.version === version && item.method === method) document.querySelector<HTMLElement>(".op-doc h1")?.focus({ preventScroll: true });
    navigate({ category: itemCategory, apiService: item.service, apiVersion: item.version, apiMethod: item.method, versionPage: null }, false, replace);
    setDirectoryOpen(false);
  };

  // 故事 6：链接带 service、method（可带 version）时直接打开对应文档。唯一匹配即直达；未指定版本且有多个版本时，取唯一的正常服务版本，否则请用户选择。
  const exact = filters.service && filters.method ? filters : null;
  const candidates = exact && results.data && !results.loading ? results.data.items.filter((item) => item.service === exact.service && item.method === exact.method && (!exact.version || item.version === exact.version)) : null;
  const active = candidates?.filter((item) => item.lifecycleStatus === "ACTIVE") ?? [];
  const direct = candidates?.length === 1 ? candidates[0] : candidates && !exact?.version && active.length === 1 ? active[0] : undefined;
  // 每个命中只自动打开一次：之后用户在目录里改选其他接口，不会被拉回命中的文档。
  const autoOpened = useRef("");
  useEffect(() => {
    if (!direct || autoOpened.current === direct.apiId) return;
    autoOpened.current = direct.apiId;
    if (!(selected && direct.service === service && direct.version === version && direct.method === method)) open(direct, direct.category || null, true);
  }, [direct?.apiId]);

  const clearSearch = () => {
    setSearchText("");
    navigate({ query: null, service: null, method: null, version: null, mcpOnly: null, page: null, categoryPage: null }, false, true);
  };
  return (
    <div className={`op-docs${selected ? "" : " op-docs--no-rail"}`}>
      <button type="button" className="op-docs__directory-toggle" aria-expanded={directoryOpen} aria-controls="op-docs-tree" onClick={() => setDirectoryOpen((value) => !value)}>
        <MenuOutlined aria-hidden /> {directoryOpen ? "收起接口目录" : "展开接口目录"}
        <span>{category || (searching ? "搜索结果" : "全部分类")}</span>
      </button>
      <aside id="op-docs-tree" className={`op-docs__tree${directoryOpen ? " is-open" : ""}`} aria-label="文档分类与接口导航">
        <DocumentTree
          mcpOnly={mcpOnly}
          onMcpOnly={enabled => {
            setGroupPages({});
            navigate({ mcpOnly: enabled ? "true" : null, page: null, categoryPage: null, category: null, apiService: null, apiVersion: null, apiMethod: null }, false);
          }}
          searchText={searchText}
          onSearchText={setSearchText}
          searching={searching}
          results={results}
          resultPage={page}
          onResultPage={(value) => navigate({ page: String(value) })}
          groups={groups}
          groupsPage={categoryPage}
          onGroupsPage={(value) => navigate({ categoryPage: String(value) })}
          expanded={tree.expanded}
          onToggle={tree.toggle}
          pageOf={(group) => (group === category ? page : groupPages[group] ?? 1)}
          onGroupPage={(group, value) => (group === category ? navigate({ page: String(value) }) : setGroupPages((current) => ({ ...current, [group]: value })))}
          revision={revision}
          selected={selected}
          onSelect={(item, itemCategory) => open(item, itemCategory)}
          focus={category}
        />
      </aside>
      {selected ? (
        <PublicDocumentDetail key={`${service}:${version}:${method}`} revision={revision} service={service} version={version} method={method} params={params} navigate={navigate} refresh={refresh} gatewayBaseUrl={gatewayBaseUrl} />
      ) : (
        <div className="op-docs__main">
          {searching ? (
            <SearchResults
              mcpOnly={mcpOnly}
              exact={exact ? formatSearch({ ...exact, query: "" }) : ""}
              multiple={!!candidates && candidates.length > 1 && !direct}
              results={results.data?.items ?? null}
              total={results.data?.total ?? 0}
              loading={results.loading}
              error={results.error}
              retry={results.reload}
              onOpen={(item) => open(item, item.category || null)}
              onClear={clearSearch}
            />
          ) : (
            <Landing
              groups={groups.data?.items ?? null}
              error={groups.error}
              retry={groups.reload}
              onOpenCategory={(value) => {
                navigate({ category: value, page: null });
                setDirectoryOpen(true);
              }}
              onOpenAll={() => {
                if (!tree.expanded.includes(ALL_GROUP)) tree.toggle(ALL_GROUP);
                setDirectoryOpen(true);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Landing({ groups, error, retry, onOpenCategory, onOpenAll }: { groups: DocumentCategory[] | null; error: string; retry: () => void; onOpenCategory: (category: string) => void; onOpenAll: () => void }) {
  const named = groups?.filter((group) => group.category) ?? [];
  const total = named.reduce((sum, group) => sum + group.apiCount, 0);
  if (error) return <StatusPage kind="error" description={`API 分类读取失败：${error}`} actions={<button type="button" className="op-portal-link-button" onClick={retry}>重新加载</button>} />;
  if (groups && !named.length) return <StatusPage kind="empty" title="还没有公开的 API" description="平台发布公开文档后会出现在这里。可以先阅读接入指南准备凭据。" actions={<a className="op-portal-link-button" href="?section=guide">阅读接入指南</a>} />;
  return (
    <section className="op-docs-landing" aria-label="API 文档概览">
      <p className="op-docs-landing__eyebrow">API Reference</p>
      <h1>API 文档</h1>
      <p className="op-docs-landing__lead">
        选择左侧分类浏览，或直接搜索名称、服务标识；参数、调用示例与在线调试都在同一页。
        {groups && (
          <>
            {" "}
            共 <strong>{total}</strong> 个 API，<strong>{named.length}</strong> 个分类。
          </>
        )}
      </p>
      {!groups && <p role="status">正在加载分类…</p>}
      <div className="op-docs-landing__grid">
        {named.map((group) => (
          <button type="button" key={group.category} className="op-docs-landing__card" onClick={() => onOpenCategory(group.category)}>
            <FolderOutlined aria-hidden />
            <span>{group.category}</span>
            <small>{group.apiCount} 个 API</small>
          </button>
        ))}
        {groups && (
          <button type="button" className="op-docs-landing__card op-docs-landing__card--all" onClick={onOpenAll}>
            <FolderOutlined aria-hidden />
            <span>全部 API</span>
            <small>按名称浏览</small>
          </button>
        )}
      </div>
    </section>
  );
}

function SearchResults({ mcpOnly, exact, multiple, results, total, loading, error, retry, onOpen, onClear }: { mcpOnly: boolean; exact: string; multiple: boolean; results: DocumentSummary[] | null; total: number; loading: boolean; error: string; retry: () => void; onOpen: (item: DocumentSummary) => void; onClear: () => void }) {
  const clear = (
    <button type="button" className="op-portal-link-button op-portal-link-button--ghost" onClick={onClear}>
      {mcpOnly ? "清空筛选" : "清空搜索"}
    </button>
  );
  if (error) return <StatusPage kind="error" description={`搜索失败：${error}`} actions={<><button type="button" className="op-portal-link-button" onClick={retry}>重新搜索</button>{clear}</>} />;
  if (results && !results.length && !loading)
    return <StatusPage kind="empty" title={exact ? `没有找到 ${exact}` : "没有匹配的 API"} description={exact ? "链接或搜索指定的服务、操作或版本没有对应的公开 API，可能已下线或标识有误。" : "换个关键词，或用 service:标识、orders.query 等语法精确筛选。"} actions={clear} />;
  return (
    <section className="op-docs-results" aria-label="搜索结果列表">
      <h1>{multiple ? `${exact} 有多个版本` : mcpOnly ? "支持 MCP 的 API" : "搜索结果"}</h1>
      <p className="op-docs-landing__lead" role={multiple ? "status" : undefined}>
        {multiple ? "链接未指定版本，且有多个可用版本，请选择要查看的版本。" : results ? `共 ${total} 个匹配。` : "正在搜索…"}
      </p>
      <ul className="op-docs-results__list">
        {results?.map((item) => (
          <li key={item.apiId}>
            <button type="button" className="op-docs-results__item" onClick={() => onOpen(item)}>
              <span className="op-docs-results__name">{item.name}{item.mcpSupported && <McpBadge />}</span>
              <code>
                {item.service}.{item.method} · {item.version}
              </code>
              {item.category && <small>{item.category}</small>}
              {item.lifecycleStatus !== "ACTIVE" && <StatusBadge tone="warning">{item.lifecycleStatus === "RETIRED" ? "已退役" : "已废弃"}</StatusBadge>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
