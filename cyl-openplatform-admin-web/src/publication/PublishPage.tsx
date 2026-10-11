import { createRequestKey } from "../shared/requestKey";
import { ArrowRightOutlined, EllipsisOutlined, ReloadOutlined } from "@ant-design/icons";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { lifecycleStatusNames } from "@cyl/open-platform-web-shared/lifecycle";
import { FieldLabel, StatusBadge, StickyActionBar } from "@cyl/open-platform-web-shared/ui/components";
import { Alert, Button, Dropdown, Input, Modal, Skeleton, Tooltip } from "antd";
import { useEffect, useState, type ReactNode } from "react";
import type { AdminApi } from "../access/api";
import type { ApiDefinition } from "../catalog/CatalogPanel";
import PublicationAuditDrawer from "./PublicationAuditDrawer";
import PublicationDiff, { publicationChanges } from "./PublicationDiff";
import SubmissionNotice from "./SubmissionNotice";
import type { EffectiveRelease, PublicationState, PublicationSubmission, ReleaseDetail } from "./types";
import { usePublicationNote } from "./usePublicationNote";
import { usePublicationSubmission } from "./usePublicationSubmission";
import "./publish.css";

interface Baseline {
  state: PublicationState;
  effective: EffectiveRelease | null;
  pending: ReleaseDetail | null;
  auditEnabled: boolean;
}

/**
 * 发布页（112b）：一条状态带（生效 → 本次、审核要求、访问开关）、本次与生效版本的差异、底部固定提交栏；
 * 停用当前环境与发布到其他环境直接展示，确认时写明后果。API 工作区与审核中心的“发布 API”共用。
 */
export default function PublishPage({
  api,
  definition,
  canPublish,
  pendingSubmissions,
  publicationNotes,
  onChanged,
  onReview,
  onTransfer,
  onRefreshCandidate,
  unsavedNotice,
  requestedAction,
  onActionHandled,
}: {
  api: AdminApi;
  /** 已保存的完整草稿；本次提交固定它的修订号。 */
  definition: ApiDefinition;
  canPublish: boolean;
  pendingSubmissions: Map<string, PublicationSubmission>;
  publicationNotes?: Map<string, string>;
  onChanged: () => void;
  onReview: (releaseId: string) => void;
  onTransfer?: (releaseId: string) => void;
  /** 刷新时一并重读候选草稿（审核中心的发布入口没有本地草稿）。 */
  onRefreshCandidate?: () => void;
  /** 配置页存在未保存修改时的提示（含前往保存的入口）。 */
  unsavedNotice?: ReactNode;
  /** 列表快捷入口：读取最新发布基线后复用确认框，不直接写入。 */
  requestedAction?: "status" | "transfer";
  onActionHandled?: () => void;
}) {
  const path = `/publications/apis/${encodeURIComponent(definition.id)}`;
  const [revision, setRevision] = useState(0);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const refresh = () => {
    setRevision((value) => value + 1);
    onRefreshCandidate?.();
  };
  const submission = usePublicationSubmission({
    api,
    apiId: definition.id,
    pendingSubmissions,
    publicationNotes,
    onAccepted: () => {
      refresh();
      onChanged();
    },
  });
  const [comment, setComment] = usePublicationNote(publicationNotes, `publish:${definition.id}`, submission.submission?.comment ?? "");
  const [dialog, setDialog] = useState<"status" | "transfer" | null>(null);
  const [reason, setReason] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [statusNotice, setStatusNotice] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    setLoading(true);
    setLoadError("");
    void (async () => {
      const [state, policy] = await Promise.all([
        api<PublicationState>(`${path}/state`, { signal }),
        api<{ auditEnabled: boolean }>("/publications/config", { signal }),
      ]);
      const [effective, pending] = await Promise.all([
        state.liveReleaseId ? api<EffectiveRelease>(`${path}/effective`, { signal }) : null,
        state.pendingReleaseId ? api<ReleaseDetail>(`/publications/${encodeURIComponent(state.pendingReleaseId)}`, { signal }) : null,
      ]);
      if (pending && (pending.id !== state.pendingReleaseId || pending.apiId !== definition.id || pending.status !== "PENDING"))
        throw new Error("审核状态在读取期间发生变化，请刷新后重新核对。");
      if (effective && effective.releaseId !== state.liveReleaseId) throw new Error("生效版本在读取期间发生变化，请刷新后重新核对差异。");
      if (!signal.aborted) setBaseline({ state, effective, pending, auditEnabled: policy.auditEnabled });
    })()
      .catch((failure) => {
        if (!signal.aborted) setLoadError((failure as Error).message);
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, path, definition.id, revision]);

  const state = baseline?.state;
  const effective = baseline?.effective ?? null;
  useEffect(() => {
    if (!requestedAction || loading || loadError || !baseline) return;
    if (canPublish && effective && (requestedAction !== "transfer" || onTransfer)) {
      setStatusError("");
      setDialog(requestedAction);
    }
    onActionHandled?.();
  }, [requestedAction, loading, loadError, baseline, canPublish, effective, onTransfer, onActionHandled]);
  const live = effective ? `r${stringifyJson(effective.snapshot.draftRevision)}` : null;
  const draftRevision = `r${stringifyJson(definition.draftRevision)}`;
  const unchanged = !!effective && !publicationChanges(effective.snapshot, definition).length;
  const blocked = loading
    ? "正在读取发布基线…"
    : loadError
      ? "发布状态读取失败，请先重试。"
      : submission.submission
        ? "上一次提交结果未知，请先查询原提交。"
        : state?.pendingReleaseId
          ? `已有待审核的 r${stringifyJson(baseline!.pending!.draftRevision)}，处理后才能再次提交。`
          : unchanged
            ? "已保存草稿与生效版本一致，无需发布。"
            : !canPublish
              ? "当前账号没有 API 发布权限。"
              : "";
  const submitLabel = baseline?.auditEnabled ? "提交审核" : "直接发布";

  const submit = async () => {
    if (blocked || !state || submission.busy) return;
    const accepted = await submission.submit({
      submissionKey: createRequestKey(),
      expectedDraftRevision: definition.draftRevision,
      expectedStateVersion: state.stateVersion,
      comment,
    });
    if (!accepted) refresh();
  };

  const changeStatus = async () => {
    if (!state || !reason.trim() || statusBusy) return;
    setStatusBusy(true);
    setStatusError("");
    try {
      await api<PublicationState>(`${path}/status`, { method: "PUT", body: { enabled: !state.enabled, expectedStateVersion: state.stateVersion, reason: reason.trim() } });
      setStatusNotice(state.enabled ? "当前环境 API 已停用：调用与公开文档已停止。" : "当前环境 API 已启用。");
      setReason("");
      setDialog(null);
      refresh();
      onChanged();
    } catch (failure) {
      setStatusError((failure as Error).message);
    } finally {
      setStatusBusy(false);
    }
  };

  const enabled = state?.enabled ?? false;
  const accessBadge = !effective ? (
    <StatusBadge tone="neutral">尚未发布，不可调用</StatusBadge>
  ) : enabled ? (
    <StatusBadge tone="success">已启用</StatusBadge>
  ) : (
    <StatusBadge tone="error">已停用</StatusBadge>
  );
  const busy = submission.busy || statusBusy;

  return (
    <section className="op-publish" aria-label="发布">
      <div className="op-publish__band" aria-label="当前发布状态">
        {loading && !baseline ? (
          <Skeleton.Input active size="small" style={{ width: 420 }} />
        ) : (
          <>
            <div className="op-publish__flow">
              <span className="op-publish__fact-label">生效</span>
              <strong className={live ? "op-publish__rev" : "op-publish__rev op-publish__rev--none"}>{live ?? "尚未发布"}</strong>
              <ArrowRightOutlined className="op-publish__arrow" aria-label="发布为" />
              <span className="op-publish__fact-label">本次</span>
              <strong className="op-publish__rev op-publish__rev--next">{draftRevision}</strong>
              {effective && <StatusBadge tone={unchanged ? "neutral" : "info"}>{unchanged ? "内容一致" : "有改动"}</StatusBadge>}
            </div>
            <span className="op-publish__divider" aria-hidden />
            <div className="op-publish__fact">
              <span className="op-publish__fact-label">审核</span>
              <span>{baseline ? (baseline.auditEnabled ? "提交后需人工审核" : "本环境免审，发布即生效") : "—"}</span>
            </div>
            <span className="op-publish__divider" aria-hidden />
            <div className="op-publish__fact">
              <span className="op-publish__fact-label">访问开关</span>
              {accessBadge}
            </div>
            {effective && (
              <>
                <span className="op-publish__divider" aria-hidden />
                <div className="op-publish__fact">
                  <span className="op-publish__fact-label">维护状态</span>
                  <span>{lifecycleStatusNames[effective.snapshot.lifecycle?.status ?? "ACTIVE"]}</span>
                </div>
              </>
            )}
            {baseline?.pending && (
              <>
                <span className="op-publish__divider" aria-hidden />
                <Button type="link" size="small" className="op-publish__pending" onClick={() => onReview(baseline.pending!.id)}>
                  待审核 r{stringifyJson(baseline.pending.draftRevision)}
                </Button>
              </>
            )}
          </>
        )}
        <div className="op-publish__band-actions">
          <Tooltip title="刷新发布状态">
            <Button type="text" size="small" icon={<ReloadOutlined aria-hidden />} aria-label="刷新发布状态" loading={loading && !!baseline} onClick={refresh} />
          </Tooltip>
          {canPublish && (
            <>
              {onTransfer && <Button size="small" disabled={!effective || busy} onClick={() => { setStatusError(""); setDialog("transfer"); }}>
                发布到其他环境
              </Button>}
              <Button size="small" danger={enabled} disabled={!effective || busy} onClick={() => { setStatusError(""); setDialog("status"); }}>
                {enabled ? "停用当前环境 API" : "启用当前环境 API"}
              </Button>
            </>
          )}
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [{ key: "audit", label: "发布操作明细" }],
              onClick: () => setAuditOpen(true),
            }}
          >
            <Button size="small" icon={<EllipsisOutlined aria-hidden />} aria-label="更多发布操作" />
          </Dropdown>
        </div>
      </div>

      {loadError && (
        <Alert type="error" showIcon className="op-publish__notice" title={loadError} action={<Button size="small" onClick={refresh}>重试</Button>} />
      )}
      {unsavedNotice}
      <SubmissionNotice state={submission} canPublish={canPublish} onReview={onReview} />
      {statusNotice && <Alert type="success" showIcon closable className="op-publish__notice" title={statusNotice} onClose={() => setStatusNotice("")} />}
      {effective && !enabled && (
        <Alert type="warning" showIcon className="op-publish__notice" title="当前环境已停用：发布或审核通过后仍保持停用，需点击“启用当前环境 API”单独启用。" />
      )}

      <section className="op-publish__diff" aria-label="本次变更">
        <header className="op-publish__diff-head">
          <h2>本次变更</h2>
          <span className="op-muted">
            {effective ? `生效 ${live} ↔ 已保存草稿 ${draftRevision}` : `首次发布 · 已保存草稿 ${draftRevision}`}
          </span>
        </header>
        {baseline && !loadError ? (
          <PublicationDiff
            api={api}
            before={effective?.snapshot ?? null}
            after={definition}
            beforeLabel={`生效 ${live ?? "无"}`}
            afterLabel={`本次 ${draftRevision}`}
            emptyLabel="已保存草稿与生效版本内容一致"
          />
        ) : (
          <Skeleton active paragraph={{ rows: 4 }} />
        )}
      </section>

      <StickyActionBar
        status={
          <span className={blocked ? "op-publish__status op-publish__status--blocked" : "op-publish__status"}>
            {blocked || `将固定提交草稿 ${draftRevision}${baseline?.auditEnabled ? "，审核通过后生效" : "，提交即生效"}；不改变访问开关`}
          </span>
        }
      >
        {canPublish && (
          <Input
            aria-label="发布备注"
            className="op-publish__comment"
            maxLength={500}
            value={comment}
            disabled={busy || !!submission.submission}
            onChange={(event) => setComment(event.target.value)}
            onPressEnter={() => void submit()}
            placeholder="发布备注（可选），供审核人核对"
          />
        )}
        {canPublish && (
          <Button type="primary" loading={submission.busy} disabled={!!blocked || busy} onClick={() => void submit()}>
            {submitLabel}
          </Button>
        )}
      </StickyActionBar>

      <Modal
        open={dialog === "status"}
        title={enabled ? "停用当前环境 API？" : "启用当前环境 API？"}
        okText={enabled ? "确认停用" : "确认启用"}
        cancelText="取消"
        okButtonProps={{ danger: enabled, loading: statusBusy, disabled: !reason.trim() }}
        onOk={() => void changeStatus()}
        onCancel={() => !statusBusy && setDialog(null)}
        destroyOnHidden
      >
        <div className="op-confirm__description">
          {enabled
            ? `立即停止生效版本 ${live} 的调用与公开文档阅读，接入方调用将被拒绝。`
            : `恢复生效版本 ${live} 的调用与公开文档阅读。`}
          不改变草稿与待审提交，无需发布审核。
        </div>
        {statusError && <Alert type="error" showIcon title={statusError} className="op-publish__notice" />}
        <label className="op-publish__reason">
          <FieldLabel label={enabled ? "停用原因" : "启用原因"} required />
          <Input.TextArea aria-label="启停原因" value={reason} maxLength={500} autoSize={{ minRows: 3, maxRows: 6 }} onChange={(event) => setReason(event.target.value)} autoFocus />
        </label>
      </Modal>
      <Modal
        open={dialog === "transfer"}
        title="发布到其他环境？"
        okText="继续选择目标环境"
        cancelText="取消"
        onOk={() => {
          setDialog(null);
          if (effective && onTransfer) onTransfer(effective.releaseId);
        }}
        onCancel={() => setDialog(null)}
        destroyOnHidden
      >
        <ul className="op-publish__consequences">
          <li>复制当前生效快照 {live}，不包含之后的草稿修改。</li>
          <li>目标环境按自己的审核规则处理，并保留它自己的访问开关。</li>
          <li>Dubbo API 需要明确选择目标环境的连接与修订。</li>
          <li>受理成功不代表目标所有节点都已生效，可在“版本与生命周期”中查看进度。</li>
        </ul>
      </Modal>
      <PublicationAuditDrawer
        open={auditOpen}
        api={api}
        apiId={definition.id}
        state={state ?? null}
        effective={effective}
        onClose={() => setAuditOpen(false)}
      />
    </section>
  );
}
