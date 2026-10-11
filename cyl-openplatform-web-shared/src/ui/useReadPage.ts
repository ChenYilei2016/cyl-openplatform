import { QueryClient, useQuery, type QueryKey } from "@tanstack/react-query";
import type { ApiClient, Page } from "../http";

const reads = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 0,
      gcTime: 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      // 既有lossless JSON含原始数字对象，不能通过普通JSON结构共享改写。
      structuralSharing: false,
    },
    mutations: { retry: false },
  },
});
const identities = new WeakMap<ApiClient, number>();
let nextIdentity = 0;
function identity(api: ApiClient) {
  let key = identities.get(api);
  if (key === undefined) {
    key = ++nextIdentity;
    identities.set(api, key);
  }
  return key;
}
/** 会话/权限边界由调用方更换ApiClient；缓存键只存不透明编号，不存凭据。 */
export function useRead<T>(
  api: ApiClient,
  path: string,
  revision: string | number = 0,
  enabled = true,
  options: { keepPrevious?: boolean } = {},
) {
  const key = identity(api);
  const query = useQuery<T, Error, T, QueryKey>(
    {
      queryKey: [key, path, revision],
      queryFn: ({ signal }) => api<T>(path, { signal }),
      enabled,
      // 列表切换筛选时保留上一页数据直到新数据返回；仅限同一身份，不跨身份展示缓存。
      placeholderData: options.keepPrevious
        ? (previous, previousQuery) => (previousQuery?.queryKey[0] === key ? previous : undefined)
        : undefined,
    },
    reads,
  );
  return {
    data: query.isError ? null : (query.data ?? null),
    loading: query.isFetching,
    error:
      query.error instanceof Error
        ? query.error.message
        : query.error
          ? "加载失败"
          : "",
    reload: () => {
      void query.refetch();
    },
  };
}
export function useReadPage<T>(api: ApiClient, path: string, revision: string | number = 0, enabled = true, options: { keepPrevious?: boolean } = {}) {
  return useRead<Page<T>>(api, path, revision, enabled, options);
}
export function clearReadPages(api: ApiClient) {
  const key = identities.get(api);
  if (key === undefined) return;
  void reads.cancelQueries({ queryKey: [key] });
  reads.removeQueries({ queryKey: [key] });
}
