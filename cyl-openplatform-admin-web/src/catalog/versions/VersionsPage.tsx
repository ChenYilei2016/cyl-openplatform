import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { EmptyState } from "@cyl/open-platform-web-shared/ui/components";
import { Alert, Button, Modal, Segmented, Skeleton } from "antd";
import { useEffect, useState } from "react";
import ApiTransfers from "../../environmentrelease/ApiTransfers";
import SubmissionNotice from "../../publication/SubmissionNotice";
import type { PublicationSubmission } from "../../publication/types";
import { usePublicationSubmission } from "../../publication/usePublicationSubmission";
import type { ApiDefinition, ApiWorkspace } from "../CatalogPanel";
import type { ApiDraft } from "../workspace/useApiDraft";
import CompareDrawer, { type CompareTarget } from "./CompareDrawer";
import LifecycleCard from "./LifecycleCard";
import RestoreDrawer from "./RestoreDrawer";
import RollbackDrawer from "./RollbackDrawer";
import VersionTimeline from "./VersionTimeline";
import { useTimeline, type TimelineEntry, type TimelineFilter } from "./useTimeline";
import "./versions.css";

const targetOf = (entry: TimelineEntry): CompareTarget =>
  entry.kind === "revision" ? { kind: "revision", revision: stringifyJson(entry.revision.revision) } : { kind: "release", releaseId: entry.release.id };
const labelOf = (entry: TimelineEntry) =>
  entry.kind === "revision" ? `草稿 r${stringifyJson(entry.revision.revision)}` : `发布 r${stringifyJson(entry.release.draftRevision)}`;

/**
 * 版本与生命周期（112b）：维护声明、草稿修订与发布记录合并的时间线（筛选、两项比较、恢复、回滚）、发往其他环境的记录。
 */
export default function VersionsPage({
  draft,
  workspace,
  canManage,
  canPublish,
  canReadAffected,
  pendingSubmissions,
  publicationNotes,
  onChanged,
  onReview,
  onRestored,
  onOpenTransfer,
  onGoPublish,
}: {
  draft: ApiDraft;
  workspace: ApiWorkspace | null;
  canManage: boolean;
  canPublish: boolean;
  canReadAffected: boolean;
  pendingSubmissions: Map<string, PublicationSubmission>;
  publicationNotes?: Map<string, string>;
  onChanged: () => void;
  onReview: (releaseId: string) => void;
  onRestored: (value: ApiDefinition, changed: boolean) => void;
  onOpenTransfer: (transferId: string) => void;
  onGoPublish: () => void;
}) {
  const { api, definition } = draft;
  const currentDraft = stringifyJson(definition.draftRevision);
  const liveReleaseId = workspace?.publication.liveReleaseId ?? null;
  const pendingReleaseId = workspace?.publication.pendingReleaseId ?? null;
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [reloadKey, setReloadKey] = useState(0);
  const timeline = useTimeline(api, definition.id, filter, `${currentDraft}:${liveReleaseId}:${pendingReleaseId}:${reloadKey}`);
  const [selected, setSelected] = useState<TimelineEntry[]>([]);
  const [compare, setCompare] = useState<[CompareTarget, CompareTarget] | null>(null);
  const [restore, setRestore] = useState<string | null>(null);
  const [rollback, setRollback] = useState<string | null>(null);
  const [provenance, setProvenance] = useState<string | null>(null);
  const submission = usePublicationSubmission({
    api,
    apiId: definition.id,
    pendingSubmissions,
    publicationNotes,
    onAccepted: () => {
      setReloadKey((value) => value + 1);
      onChanged();
    },
  });
  useEffect(() => setSelected([]), [definition.id]);

  const toggle = (entry: TimelineEntry) =>
    setSelected((current) => (current.some((item) => item.key === entry.key) ? current.filter((item) => item.key !== entry.key) : current.length >= 2 ? current : [...current, entry]));
  const compareSelected = () => {
    if (selected.length !== 2) return;
    const [older, newer] = [...selected].sort((a, b) => a.at - b.at);
    setCompare([targetOf(older), targetOf(newer)]);
  };
  const rollbackBlocked = submission.submission
    ? "有结果未知的提交，请先查询原提交"
    : pendingReleaseId
      ? "已有待审核提交，处理后才能回滚"
      : "";

  return (
    <div className="op-versions">
      <SubmissionNotice state={submission} canPublish={canPublish} onReview={onReview} />
      <LifecycleCard draft={draft} liveReleaseId={liveReleaseId} canReadAffected={canReadAffected} onGoPublish={onGoPublish} />

      <section className="op-versions__card" aria-label="版本记录">
        <header className="op-versions__card-head">
          <div className="op-versions__card-title">
            <h2>版本记录</h2>
            <Segmented<TimelineFilter>
              size="small"
              aria-label="记录类型"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "全部" },
                { value: "revision", label: `草稿修订${timeline.revisionCount != null ? ` ${timeline.revisionCount}` : ""}` },
                { value: "release", label: `发布${timeline.releaseCount != null ? ` ${timeline.releaseCount}` : ""}` },
              ]}
            />
          </div>
          <div className="op-versions__selection" aria-live="polite">
            {selected.length === 0 ? (
              <span className="op-muted">勾选任意两项可比较</span>
            ) : (
              <>
                <span className="op-muted">已选 {selected.map(labelOf).join("、")}</span>
                <Button size="small" type="link" onClick={() => setSelected([])}>
                  清除
                </Button>
              </>
            )}
            <Button size="small" type="primary" disabled={selected.length !== 2} onClick={compareSelected}>
              比较所选
            </Button>
          </div>
        </header>
        {draft.hasUnsavedChanges() && <p className="op-muted op-versions__card-note">比较只使用已保存的内容，配置页未保存的修改不参与。</p>}
        {timeline.errors.map((item) => (
          <Alert
            key={item.kind}
            type="error"
            showIcon
            title={`${item.kind === "revision" ? "草稿修订" : "发布记录"}读取失败：${item.message}`}
            action={
              <Button size="small" onClick={() => timeline.retry(item.kind)}>
                重试
              </Button>
            }
          />
        ))}
        {!timeline.entries.length && timeline.loading && <Skeleton active paragraph={{ rows: 5 }} />}
        {!timeline.entries.length && !timeline.loading && !timeline.errors.length && <EmptyState title="暂无记录" />}
        {!!timeline.entries.length && (
          <VersionTimeline
            entries={timeline.entries}
            selected={selected.map((item) => item.key)}
            onToggle={toggle}
            actions={{
              currentDraft,
              liveReleaseId,
              canRestore: canManage,
              canRollback: canPublish,
              rollbackBlocked,
              onCompareCurrent: (revision) => setCompare([{ kind: "revision", revision }, { kind: "revision", revision: currentDraft }]),
              onRestore: setRestore,
              onProvenance: setProvenance,
              onReview,
              onRollback: setRollback,
            }}
          />
        )}
        {(timeline.canLoadMore || (timeline.loading && !!timeline.entries.length)) && (
          <Button className="op-versions__more" block type="text" loading={timeline.loading} onClick={timeline.loadMore}>
            加载更早的记录
          </Button>
        )}
      </section>

      <section className="op-versions__card" aria-label="发往其他环境">
        <header className="op-versions__card-head">
          <div className="op-versions__card-title">
            <h2>发往其他环境</h2>
          </div>
        </header>
        <ApiTransfers api={api} apiId={definition.id} onOpen={onOpenTransfer} />
      </section>

      <CompareDrawer api={api} apiId={definition.id} targets={compare} onClose={() => setCompare(null)} />
      <RestoreDrawer
        api={api}
        apiId={definition.id}
        revision={restore}
        canManage={canManage}
        hasUnsavedChanges={draft.hasUnsavedChanges}
        onClose={() => setRestore(null)}
        onRestored={(value, changed) => {
          setRestore(null);
          onRestored(value, changed);
        }}
      />
      <RollbackDrawer
        api={api}
        apiId={definition.id}
        releaseId={rollback}
        canPublish={canPublish}
        blocked={!!submission.submission}
        publicationNotes={publicationNotes}
        onSubmit={submission.submit}
        onClose={() => setRollback(null)}
      />
      <ProvenanceModal api={api} apiId={definition.id} revision={provenance} onClose={() => setProvenance(null)} />
    </div>
  );
}

/** 导入修订的来源摘要：只保留资料类型与摘要，不保留原始文档与认证信息。 */
function ProvenanceModal({ api, apiId, revision, onClose }: { api: ApiDraft["api"]; apiId: string; revision: string | null; onClose: () => void }) {
  const [info, setInfo] = useState<{ sourceLabel: string; sourceDigest: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setInfo(null);
    setError("");
    if (!revision) return;
    const controller = new AbortController();
    void api<{ sourceLabel: string; sourceDigest: string }>(`/api-imports/provenance/${encodeURIComponent(apiId)}?revision=${revision}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setInfo(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError((failure as Error).message);
      });
    return () => controller.abort();
  }, [api, apiId, revision]);
  return (
    <Modal open={!!revision} title={`导入来源 · r${revision ?? ""}`} footer={null} onCancel={onClose} destroyOnHidden>
      {error && <Alert type="error" showIcon title={error} />}
      {!info && !error && <Skeleton active paragraph={{ rows: 2 }} />}
      {info && (
        <dl className="op-versions__facts">
          <dt>资料类型</dt>
          <dd>{info.sourceLabel}</dd>
          <dt>来源摘要（SHA-256）</dt>
          <dd>
            <code>{info.sourceDigest}</code>
          </dd>
        </dl>
      )}
      <p className="op-muted">来源属于该固定草稿修订，不保留原始文档与认证信息。</p>
    </Modal>
  );
}
