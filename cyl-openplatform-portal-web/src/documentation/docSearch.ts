/**
 * API 文档搜索语法（115 用户故事 13）：精确筛选并入同一个搜索框。
 * - `service:orders`、`method:query`、`version:v1` 精确匹配对应字段；
 * - `orders.query` 是 `service:orders method:query` 的简写；
 * - 其余文字按名称 / 服务 / 操作模糊搜索。
 * 结果与地址参数 query / service / method / version 一一对应，链接可分享、可返回恢复。
 */
export interface DocumentFilters {
  query: string;
  service: string;
  method: string;
  version: string;
}

export const filterNames = ["query", "service", "method", "version"] as const;
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const shorthand = /^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.([A-Za-z0-9][A-Za-z0-9_.-]{0,63})$/;

export function parseSearch(text: string): DocumentFilters {
  const result: DocumentFilters = { query: "", service: "", method: "", version: "" };
  const words: string[] = [];
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    const field = /^(service|method|version):(.+)$/i.exec(token);
    const pair = shorthand.exec(token);
    if (field) result[field[1].toLowerCase() as "service" | "method" | "version"] = field[2];
    else if (pair && !result.service && !result.method) {
      result.service = pair[1];
      result.method = pair[2];
    } else words.push(token);
  }
  result.query = words.join(" ").slice(0, 100);
  return result;
}

export function formatSearch(filters: DocumentFilters): string {
  const parts: string[] = [];
  if (filters.service && filters.method && identifier.test(filters.service)) parts.push(`${filters.service}.${filters.method}`);
  else {
    if (filters.service) parts.push(`service:${filters.service}`);
    if (filters.method) parts.push(`method:${filters.method}`);
  }
  if (filters.version) parts.push(`version:${filters.version}`);
  if (filters.query) parts.push(filters.query);
  return parts.join(" ");
}

export function readFilters(params: URLSearchParams): DocumentFilters {
  return { query: params.get("query") || "", service: params.get("service") || "", method: params.get("method") || "", version: params.get("version") || "" };
}

/** 地址中的页码：非数字按第 1 页，上限与服务端分页一致。 */
export const pageNumber = (value: string | null) => (value && /^\d+$/.test(value) ? Math.min(5001, Math.max(1, Number(value))) : 1);

export const sameFilters = (left: DocumentFilters, right: DocumentFilters) => filterNames.every((name) => left[name] === right[name]);
