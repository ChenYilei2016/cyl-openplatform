import { createRequestKey } from "../../shared/requestKey";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { EntityDrawer, FieldLabel } from "@cyl/open-platform-web-shared/ui/components";
import { Alert, Button, Input, Skeleton, Space } from "antd";
import { useEffect, useState } from "react";
import type { AdminApi } from "../../access/api";
import PublicationDiff from "../../publication/PublicationDiff";
import type { PublicationState, ReleaseDetail, RollbackSubmission } from "../../publication/types";
import { usePublicationNote } from "../../publication/usePublicationNote";

interface Preview {
  source: ReleaseDetail;
  live: ReleaseDetail;
  state: PublicationState;
  auditEnabled: boolean;
}

/**
 * 回滚到历史已生效版本：核对“当前生效 → 回滚候选”差异并填写原因。回滚创建新的发布，保留工作草稿与访问开关，
 * 沿用本环境审核规则。读取期间生效版本或状态变化时拒绝继续。
 */
export default function RollbackDrawer({
  api,
  apiId,
  releaseId,
  canPublish,
  blocked,
  publicationNotes,
  onSubmit,
  onClose,
}: {
  api: AdminApi;
  apiId: string;
  releaseId: string | null;
  canPublish: boolean;
  /** 有结果未知的提交时禁止再次提交。 */
  blocked: boolean;
  publicationNotes?: Map<string, string>;
  onSubmit: (attempt: RollbackSubmission) => Promise<boolean>;
  onClose: () => void;
}) {
  const path = `/publications/apis/${encodeURIComponent(apiId)}`;
  const [localNotes] = useState(() => new Map<string, string>());
  const [comment, setComment] = usePublicationNote(publicationNotes ?? localNotes, `rollback:${apiId}:${releaseId ?? ""}`);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setPreview(null);
    setError("");
    if (!releaseId) return;
    const controller = new AbortController();
    const signal = controller.signal;
    void (async () => {
      const [before, source, config] = await Promise.all([
        api<PublicationState>(`${path}/state`, { signal }),
        api<ReleaseDetail>(`/publications/${encodeURIComponent(releaseId)}`, { signal }),
        api<{ auditEnabled: boolean }>("/publications/config", { signal }),
      ]);
      if (before.pendingReleaseId) throw new Error("已有待审核提交，请先处理后再发起回滚。");
      if (
        before.apiId !== apiId ||
        !before.liveReleaseId ||
        before.liveReleaseId === releaseId ||
        source.status !== "APPLIED" ||
        source.id !== releaseId ||
        source.apiId !== apiId ||
        source.snapshot?.id !== apiId ||
        stringifyJson(source.snapshot.draftRevision) !== stringifyJson(source.draftRevision)
      )
        throw new Error("只能选择本 API 曾经生效过的历史版本回滚，不能选择当前生效版本。");
      const live = await api<ReleaseDetail>(`/publications/${encodeURIComponent(before.liveReleaseId)}`, { signal });
      const after = await api<PublicationState>(`${path}/state`, { signal });
      if (
        live.id !== before.liveReleaseId ||
        live.apiId !== apiId ||
        live.snapshot?.id !== apiId ||
        live.status !== "APPLIED" ||
        stringifyJson(live.snapshot.draftRevision) !== stringifyJson(live.draftRevision) ||
        before.liveReleaseId !== after.liveReleaseId ||
        before.pendingReleaseId !== after.pendingReleaseId ||
        stringifyJson(before.stateVersion) !== stringifyJson(after.stateVersion)
      )
        throw new Error("生效版本或访问状态在读取期间发生变化，请重新核对。");
      if (!signal.aborted) {
        setNeedsRefresh(false);
        setPreview({ source, live, state: after, auditEnabled: config.auditEnabled });
      }
    })().catch((failure) => {
      if (!signal.aborted) setError((failure as Error).message);
    });
    return () => controller.abort();
  }, [api, apiId, path, releaseId, refresh]);

  const confirm = async () => {
    if (!preview || busy) return;
    setBusy(true);
    const accepted = await onSubmit({
      sourceReleaseId: preview.source.id,
      expectedLiveReleaseId: preview.state.liveReleaseId!,
      expectedStateVersion: preview.state.stateVersion,
      submissionKey: createRequestKey(),
      comment: comment.trim(),
    });
    setBusy(false);
    if (accepted) onClose();
    else setNeedsRefresh(true);
  };
  const label = !preview ? "确认回滚" : preview.auditEnabled ? "提交回滚审核" : "确认回滚并生效";

  return (
    <EntityDrawer
      open={!!releaseId}
      width="lg"
      title={preview ? `回滚到 r${stringifyJson(preview.source.draftRevision)}` : "回滚到历史版本"}
      subtitle={
        preview
          ? `创建新的发布：当前生效 r${stringifyJson(preview.live.draftRevision)} → r${stringifyJson(preview.source.draftRevision)}。工作草稿保留，访问开关保持“${preview.state.enabled ? "已启用" : "已停用"}”；${preview.auditEnabled ? "需审核，通过后生效" : "本环境免审，确认后直接生效"}。`
          : "正在核对生效基线"
      }
      onClose={() => !busy && onClose()}
      footer={
        <div className="op-versions__drawer-footer op-versions__drawer-footer--form">
          <label className="op-versions__reason">
            <FieldLabel label="回滚原因" required />
            <Input.TextArea
              aria-label="回滚原因"
              maxLength={500}
              disabled={busy || !preview}
              value={comment}
              autoSize={{ minRows: 1, maxRows: 4 }}
              placeholder="说明选择此历史版本的原因与影响"
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
          <Space>
            <Button disabled={busy} onClick={onClose}>
              取消
            </Button>
            {needsRefresh && !blocked && (
              <Button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
                重新核对
              </Button>
            )}
            <Button type="primary" aria-label={label} loading={busy} disabled={busy || blocked || !canPublish || !preview || needsRefresh || !comment.trim()} onClick={() => void confirm()}>
              {label}
            </Button>
          </Space>
        </div>
      }
    >
      <div className="op-versions__drawer-body">
        {!canPublish && <Alert type="warning" showIcon title="当前账号没有 API 发布权限（PUBLISH_APIS），可以核对差异，不能回滚。" />}
        {blocked && <Alert type="warning" showIcon title="存在结果未知的提交，请先在页面顶部查询原提交结果，不要重复提交。" />}
        {error && <Alert type="error" showIcon title={error} action={<Button size="small" onClick={() => setRefresh((value) => value + 1)}>重试</Button>} />}
        {!preview && !error && <Skeleton active paragraph={{ rows: 6 }} />}
        {preview && (
          <PublicationDiff
            api={api}
            before={preview.live.snapshot}
            after={preview.source.snapshot}
            beforeLabel={`当前生效 r${stringifyJson(preview.live.draftRevision)}`}
            afterLabel={`回滚为 r${stringifyJson(preview.source.draftRevision)}`}
          />
        )}
      </div>
    </EntityDrawer>
  );
}
