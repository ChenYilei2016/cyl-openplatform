import { looksLikeRawToken } from "../access/credentialModel";
import {
  ApiOutlined,
  AppstoreOutlined,
  ClockCircleOutlined,
  EnterOutlined,
  FileSearchOutlined,
  LoadingOutlined,
  SearchOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { EmptyState, middleEllipsis } from "@cyl/open-platform-web-shared/ui/components";
import { Input, Modal } from "antd";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import type { AdminApi } from "../access/api";
import type { AdminRoute } from "./AdminNavigation";
import { pathFor, titleFor, type PageEntry } from "./routes";

export interface RecentPage {
  path: string;
  title: string;
  detail?: string;
  at: number;
}

const RECENT_KEY = "op-admin-recent-pages";
const RECENT_LIMIT = 8;

export function readRecentPages(): RecentPage[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is RecentPage => typeof item?.path === "string" && typeof item?.title === "string").slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

/** 记录最近访问的页面（只存路径与标题，不含筛选值或秘密）。 */
export function useRecentPages(route: AdminRoute) {
  const [recent, setRecent] = useState(readRecentPages);
  const path = pathFor(route);
  useEffect(() => {
    if (path === "/workbench") return;
    const entry: RecentPage = {
      path,
      title: titleFor(route),
      detail: route.page === "catalog" && route.apiId && route.apiId !== "new" ? route.apiId : undefined,
      at: Date.now(),
    };
    setRecent((previous) => {
      const next = [entry, ...previous.filter((item) => item.path !== path)].slice(0, RECENT_LIMIT);
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* 本地存储不可用时只保留在内存。 */
      }
      return next;
    });
    // 只在路径变化时记录；标题由路径决定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return recent;
}

/** 114 B4 `GET /admin-api/search`：无权限的分组为 null，各组最多 5 条。 */
export interface GlobalSearchResult {
  apis: { id: string; name: string; service: string; version: string; method: string; internalClass?: string | null }[] | null;
  credentials: { id: string; name: string; appKey: string; status: "ENABLED" | "DISABLED" }[] | null;
  calls: { id: string; requestId: string; mode: string; service?: string | null; method?: string | null; outcome: string; httpStatus: number; occurredAt: string }[] | null;
  people: { id: string; tenantId: string; tenantName?: string | null; employeeId: string; employeeNo: string; displayName: string }[] | null;
}

const SEARCH_MIN = 2;
const SEARCH_MAX = 100;
const SEARCH_DELAY = 250;

/** 输入停顿后检索实体；新输入会取消上一请求，只展示与当前输入一致的结果。 */
function useEntitySearch(api: AdminApi | undefined, text: string) {
  const keyword = text.trim();
  // 完整 Token 明文不发请求（不进入地址），提示改用 Token 记录 ID。
  const rawToken = looksLikeRawToken(keyword);
  const enabled = Boolean(api) && !rawToken && keyword.length >= SEARCH_MIN && keyword.length <= SEARCH_MAX;
  const [state, setState] = useState<{ keyword: string; data: GlobalSearchResult | null; error: string }>({ keyword: "", data: null, error: "" });
  useEffect(() => {
    if (!api || !enabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<GlobalSearchResult>(`/search?q=${encodeURIComponent(keyword)}`, { signal: controller.signal })
        .then((data) => setState({ keyword, data, error: "" }))
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setState({ keyword, data: null, error: error instanceof Error ? error.message : "搜索失败" });
        });
    }, SEARCH_DELAY);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [api, enabled, keyword]);
  const current = enabled && state.keyword === keyword;
  return {
    data: current ? state.data : null,
    error: current ? state.error : "",
    notice: rawToken ? "搜索不接受完整 Token，请输入 Token 记录 ID（TOK_ 开头）。" : "",
    searching: enabled && !current,
  };
}

const timeText = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
};

/** 实体结果 → 列表项。人员：有调用日志权限（calls 分组存在）时打开该人员的调用日志，否则打开其租户的凭据列表。 */
function entityItems(result: GlobalSearchResult | null): Item[] {
  if (!result) return [];
  const items: Item[] = [];
  for (const hit of result.apis ?? [])
    items.push({ key: `api:${hit.id}`, section: "API", icon: <ApiOutlined />, path: `/apis/${encodeURIComponent(hit.id)}/config`,
      title: hit.name, hint: `${hit.service}.${hit.method} · ${hit.version}` });
  for (const hit of result.credentials ?? [])
    items.push({ key: `credential:${hit.id}`, section: "凭据", icon: <AppstoreOutlined />, path: `/credentials?${new URLSearchParams({ application: hit.id })}`,
      title: hit.name, hint: `AK ${middleEllipsis(hit.appKey, 20)}${hit.status === "DISABLED" ? " · 已停用" : ""}` });
  for (const hit of result.calls ?? [])
    items.push({ key: `call:${hit.id}`, section: "调用", icon: <FileSearchOutlined />,
      path: `/logs?${new URLSearchParams({ record: hit.id, recordAt: hit.occurredAt })}`,
      title: hit.requestId,
      hint: `${hit.service && hit.method ? `${hit.service}.${hit.method} · ` : ""}${hit.outcome === "SUCCESS" ? "成功" : "失败"} ${hit.httpStatus} · ${timeText(hit.occurredAt)}` });
  const canViewLogs = result.calls !== null;
  for (const hit of result.people ?? []) {
    const query = canViewLogs
      ? new URLSearchParams({ "filter.logs.tenantId": hit.tenantId, "filter.logs.employeeNo": hit.employeeNo })
      : new URLSearchParams({ "filter.credentials.tenantId": hit.tenantId });
    items.push({ key: `person:${hit.id}`, section: "人员", icon: <UserOutlined />, path: `${canViewLogs ? "/logs" : "/credentials"}?${query}`,
      title: hit.displayName, hint: `工号 ${hit.employeeNo} · ${hit.tenantName || hit.tenantId}` });
  }
  return items;
}

interface Item {
  key: string;
  section: string;
  path: string;
  title: string;
  hint: string;
  icon?: ReactNode;
}

/** ⌘K / Ctrl+K 命令面板：页面、最近访问，以及 API、凭据、requestId、人员的实体检索（114）。 */
export default function CommandPalette({ open, onClose, entries, recent, api }: { open: boolean; onClose: () => void; entries: PageEntry[]; recent: RecentPage[]; api?: AdminApi }) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (open) {
      setText("");
      setCursor(0);
    }
  }, [open]);
  const search = useEntitySearch(open ? api : undefined, text);
  const items = useMemo<Item[]>(() => {
    const keyword = text.trim().toLowerCase();
    const pages = entries
      .filter((entry) => !keyword || `${entry.title} ${entry.group} ${entry.keywords ?? ""} ${entry.path}`.toLowerCase().includes(keyword))
      .map((entry) => ({ key: `page:${entry.path}`, section: "页面", path: entry.path, title: entry.title, hint: entry.group }));
    const recents = recent
      .filter((item) => !keyword || `${item.title} ${item.detail ?? ""}`.toLowerCase().includes(keyword))
      .slice(0, 5)
      .map((item) => ({ key: `recent:${item.path}`, section: "最近访问", icon: <ClockCircleOutlined />, path: item.path, title: item.title, hint: item.detail ?? "最近访问" }));
    const shown = new Set(recents.map((item) => item.path));
    return [...recents, ...pages.filter((item) => !shown.has(item.path)), ...entityItems(search.data)];
  }, [entries, recent, text, search.data]);
  // 结果异步到达时光标保持在范围内。
  const active = Math.min(cursor, Math.max(items.length - 1, 0));
  const go = (item?: Item) => {
    if (!item) return;
    onClose();
    navigate(item.path);
  };
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  const status = search.searching ? (
    <p className="op-palette__status" role="status"><LoadingOutlined aria-hidden /> 正在搜索 API、凭据、调用与人员…</p>
  ) : search.notice ? (
    <p className="op-palette__status" role="status">{search.notice}</p>
  ) : search.error ? (
    <p className="op-palette__status op-palette__status--error" role="alert">实体搜索失败：{search.error}</p>
  ) : null;
  return (
    <Modal open={open} onCancel={onClose} footer={null} closable={false} width={600} className="op-palette" destroyOnHidden title={null} aria-label="搜索页面">
      <Input
        autoFocus
        size="large"
        variant="borderless"
        prefix={<SearchOutlined aria-hidden />}
        placeholder="搜索页面、API、凭据名称或 AK、requestId、人员姓名或工号"
        value={text}
        maxLength={SEARCH_MAX}
        aria-label="搜索页面"
        aria-controls="op-palette-list"
        aria-activedescendant={items[active] ? `op-palette-${active}` : undefined}
        onChange={(event) => {
          setText(event.target.value);
          setCursor(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setCursor(Math.min(active + 1, items.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setCursor(Math.max(active - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            go(items[active]);
          }
        }}
      />
      {items.length ? (
        <ul id="op-palette-list" ref={list} className="op-palette__list" role="listbox" aria-label="搜索结果">
          {items.map((item, index) => {
            const first = index === 0 || items[index - 1].section !== item.section;
            return (
              <li key={item.key} role="presentation">
                {first && <div className="op-palette__section" role="presentation">{item.section}</div>}
                <div
                  id={`op-palette-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === active}
                  className={`op-palette__item${index === active ? " is-active" : ""}`}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => go(item)}
                >
                  {item.icon && <span className="op-palette__icon" aria-hidden>{item.icon}</span>}
                  <span className="op-palette__title">{item.title}</span>
                  <span className="op-palette__hint">{item.hint}</span>
                  {index === active && <EnterOutlined className="op-palette__enter" aria-hidden />}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        !search.searching && (
          <EmptyState
            kind="noResult"
            description={!api ? "没有匹配的页面。" : text.trim().length >= SEARCH_MIN ? "没有匹配的页面、API、凭据、调用或人员。" : "输入至少 2 个字符搜索 API、凭据、requestId 与人员。"}
          />
        )
      )}
      {status}
    </Modal>
  );
}
