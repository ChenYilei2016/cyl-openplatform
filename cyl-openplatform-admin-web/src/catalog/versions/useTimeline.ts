import { useEffect, useRef, useState } from "react";
import type { AdminApi, Page } from "../../access/api";
import type { ReleaseSummary } from "../../publication/types";
import type { RevisionSummary } from "./types";

export type TimelineFilter = "all" | "revision" | "release";
export type TimelineEntry =
  | { kind: "revision"; key: string; at: number; revision: RevisionSummary }
  | { kind: "release"; key: string; at: number; release: ReleaseSummary };

interface Source<T> {
  items: T[];
  page: number;
  total: number | null;
  loading: boolean;
  error: string;
}

const PAGE_SIZE = 20;
const empty = <T,>(): Source<T> => ({ items: [], page: 0, total: null, loading: false, error: "" });
const hasMore = (source: Source<unknown>) => source.total === null || source.items.length < source.total;
const revisionEntry = (revision: RevisionSummary): TimelineEntry => ({ kind: "revision", key: `revision:${String(revision.revision)}`, at: Date.parse(revision.recordedAt), revision });
const releaseEntry = (release: ReleaseSummary): TimelineEntry => ({ kind: "release", key: `release:${release.id}`, at: Date.parse(release.submittedAt), release });

/**
 * 草稿修订与发布记录合并为一条倒序时间线：两个来源各自服务端分页，前端按时间归并。
 * 只展示不早于“仍有下一页的来源”已加载末项的记录，保证合并顺序正确；“加载更多”只读取卡住边界的那个来源。
 */
export function useTimeline(api: AdminApi, apiId: string, filter: TimelineFilter, reloadKey: unknown) {
  const [revisions, setRevisions] = useState<Source<RevisionSummary>>(empty);
  const [releases, setReleases] = useState<Source<ReleaseSummary>>(empty);
  const generation = useRef(0);
  const controllers = useRef<AbortController[]>([]);

  const load = (kind: "revision" | "release", page: number) => {
    const set = (kind === "revision" ? setRevisions : setReleases) as (update: (value: Source<unknown>) => Source<unknown>) => void;
    const path =
      kind === "revision"
        ? `/apis/${encodeURIComponent(apiId)}/revisions?page=${page}&pageSize=${PAGE_SIZE}`
        : `/publications/apis/${encodeURIComponent(apiId)}/releases?page=${page}&pageSize=${PAGE_SIZE}`;
    const current = generation.current;
    const controller = new AbortController();
    controllers.current.push(controller);
    set((value) => ({ ...value, loading: true, error: "" }));
    void api<Page<RevisionSummary & ReleaseSummary>>(path, { signal: controller.signal })
      .then((result) => {
        if (current !== generation.current) return;
        set((value) => ({
          items: page === 1 ? result.items : [...value.items, ...result.items],
          page,
          total: result.total,
          loading: false,
          error: "",
        }));
      })
      .catch((failure) => {
        if (current !== generation.current || controller.signal.aborted) return;
        set((value) => ({ ...value, loading: false, error: (failure as Error).message }));
      });
  };

  useEffect(() => {
    generation.current += 1;
    controllers.current.forEach((controller) => controller.abort());
    controllers.current = [];
    setRevisions(empty());
    setReleases(empty());
    load("revision", 1);
    load("release", 1);
    return () => controllers.current.forEach((controller) => controller.abort());
  }, [api, apiId, reloadKey]);

  const sources = [
    ...(filter !== "release" ? [{ kind: "revision" as const, source: revisions as Source<unknown>, entries: revisions.items.map(revisionEntry) }] : []),
    ...(filter !== "revision" ? [{ kind: "release" as const, source: releases as Source<unknown>, entries: releases.items.map(releaseEntry) }] : []),
  ];
  // 读取失败的来源不阻塞另一来源的展示，错误单独提示并可重试。
  const pending = sources.filter((item) => hasMore(item.source) && !item.source.error);
  // 仍有下一页的来源中，已加载末项最晚的那个决定可展示边界；尚未加载任何项时什么都不能确定。
  const boundaryOf = (item: (typeof sources)[number]) => (item.entries.length ? item.entries[item.entries.length - 1].at : Number.POSITIVE_INFINITY);
  const blocking = pending.reduce<(typeof sources)[number] | null>((best, item) => (!best || boundaryOf(item) > boundaryOf(best) ? item : best), null);
  const boundary = blocking ? boundaryOf(blocking) : Number.NEGATIVE_INFINITY;
  const entries = sources
    .flatMap((item) => item.entries)
    .filter((entry) => entry.at >= boundary)
    .sort((a, b) => b.at - a.at || (a.kind === b.kind ? 0 : a.kind === "release" ? -1 : 1));
  const loading = sources.some((item) => item.source.loading);
  return {
    entries,
    loading,
    errors: sources.filter((item) => item.source.error).map((item) => ({ kind: item.kind, message: item.source.error })),
    canLoadMore: !!blocking && !loading,
    loadMore: () => {
      if (!blocking || loading) return;
      load(blocking.kind, blocking.source.page + 1);
    },
    retry: (kind: "revision" | "release") => {
      const source = kind === "revision" ? revisions : releases;
      load(kind, source.page + 1 || 1);
    },
    releaseCount: releases.total,
    revisionCount: revisions.total,
  };
}
