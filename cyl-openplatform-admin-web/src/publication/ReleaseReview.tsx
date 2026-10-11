import { ReloadOutlined } from "@ant-design/icons";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { EntityDrawer, FieldHelp, FieldLabel, IdText, PersonTag, StatusBadge, type StatusTone } from "@cyl/open-platform-web-shared/ui/components";
import { Alert, Button, Descriptions, Input, Tooltip, type DescriptionsProps } from "antd";
import { useEffect, useRef, useState } from "react";
import type { AdminApi } from "../access/api";
import type { IncomingReview } from "../environmentrelease/types";
import PublicationDiff from "./PublicationDiff";
import { publicationDisplay, publicationTime } from "./publicationDisplay";
import SnapshotView from "./SnapshotView";
import { releaseOutcome, type PublicationState, type ReleaseDetail } from "./types";
import { usePublicationNote } from "./usePublicationNote";
import "./release-review.css";

const outcomeTone = (detail: Pick<ReleaseDetail, "status">): StatusTone =>
  detail.status === "PENDING" ? "info" : detail.status === "APPLIED" ? "success" : "error";

/** 审核中心与 API 版本页共用的发布详情：右侧抽屉，“变更与审核”处理申请，“固定快照”按字段阅读提交时内容。 */
export default function ReleaseReview({
  api,
  releaseId,
  canReview,
  onChanged,
  onBack,
  backLabel = "关闭",
  publicationNotes,
}: {
  publicationNotes?: Map<string, string>;
  api: AdminApi;
  releaseId: string;
  canReview: boolean;
  onChanged: () => void;
  onBack: () => void;
  backLabel?: string;
}) {
  const [incoming, setIncoming] = useState<IncomingReview | null>(null);
  const [incomingError, setIncomingError] = useState("");
  const [incomingLoading, setIncomingLoading] = useState(true);
  const [detail, setDetail] = useState<ReleaseDetail | null>(null);
  const [state, setState] = useState<PublicationState | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState("review");
  const [comment, setComment] = usePublicationNote(publicationNotes, `review:${releaseId}`);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState("");
  const writing = useRef(false);
  const context = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    context.current += 1;
    setDetail(null);
    setState(null);
    setError("");
    setIncoming(null);
    setIncomingError("");
    setIncomingLoading(true);
    setBusy(false);
    writing.current = false;
    void api<IncomingReview | null>(`/environment-releases/incoming/${encodeURIComponent(releaseId)}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setIncoming(value?.sourceEnvironment ? value : null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setIncomingError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIncomingLoading(false);
      });
    void (async () => {
      const value = await api<ReleaseDetail>(`/publications/${encodeURIComponent(releaseId)}`, { signal: controller.signal });
      if (!controller.signal.aborted) setDetail(value);
      const status = await api<PublicationState>(`/publications/apis/${encodeURIComponent(value.apiId)}/state`, { signal: controller.signal });
      if (!controller.signal.aborted) setState(status);
    })().catch((error) => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => {
      controller.abort();
      context.current += 1;
    };
  }, [api, releaseId, revision]);
  const review = async (decision: "approve" | "reject") => {
    if (!canReview || writing.current || detail?.status !== "PENDING" || writeError || error || incomingLoading || incomingError) return;
    if ((decision === "reject" && !comment.trim()) || (decision === "approve" && (!detail.baselineKnown || detail.baselineStateVersion === null))) return;
    writing.current = true;
    const requestContext = context.current;
    setBusy(true);
    setWriteError("");
    try {
      const value = await api<ReleaseDetail>(`/publications/${encodeURIComponent(releaseId)}/${decision}`, { method: "POST", body: { comment } });
      if (publicationNotes?.get(`review:${releaseId}`) === comment) publicationNotes.delete(`review:${releaseId}`);
      if (context.current === requestContext) {
        setDetail(value);
        setComment("");
        // 处理结果（含生效失败）在“变更与审核”页签说明。
        setTab("review");
        onChanged();
      }
    } catch (failure) {
      if (context.current === requestContext) setWriteError((failure as Error).message);
    } finally {
      if (context.current === requestContext) {
        writing.current = false;
        setBusy(false);
      }
    }
  };
  const refresh = () => {
    setWriteError("");
    setRevision((value) => value + 1);
  };
  const disabled = busy || !!writeError || !!error || incomingLoading || !!incomingError;
  const reviewing = canReview && detail?.status === "PENDING";
  const loadError = error && (
    <Alert
      type="error"
      showIcon
      title={error}
      action={
        <Button size="small" onClick={() => setRevision((value) => value + 1)}>
          重新加载
        </Button>
      }
    />
  );
  return (
    <EntityDrawer
      open
      width="lg"
      title={detail?.name ?? "发布记录"}
      status={detail && <StatusBadge tone={outcomeTone(detail)}>{releaseOutcome(detail)}</StatusBadge>}
      subtitle={detail && <IdText value={`${detail.service}.${detail.method} · ${detail.version}`} copyable={false} maxChars={64} />}
      actions={
        <Tooltip title="刷新发布结果">
          <Button icon={<ReloadOutlined aria-hidden />} aria-label="刷新发布结果" disabled={busy} onClick={refresh} />
        </Tooltip>
      }
      onClose={() => {
        // 审批请求在途时不离开，避免结果回来时已看不到。
        if (!busy) onBack();
      }}
      loading={!detail && !error}
      activeTab={tab}
      onTabChange={setTab}
      tabs={
        detail
          ? [
              {
                key: "review",
                label: "变更与审核",
                children: (
                  <div className="op-review">
                    {loadError}
                    <ReviewNotices detail={detail} state={state} />
                    <section className="op-review__section" aria-label="提交信息">
                      <Descriptions size="small" bordered column={2} items={submissionFacts(detail)} />
                    </section>
                    {incomingLoading && <p role="status" className="op-muted">正在核对发布来源…</p>}
                    {incomingError && <Alert type="error" showIcon title={`跨环境来源读取失败：${incomingError}。请刷新核对来源后再处理。`} />}
                    {incoming && <IncomingSource api={api} incoming={incoming} />}
                    <section className="op-review__section" aria-labelledby="release-review-diff">
                      <h3 id="release-review-diff">
                        变更比较
                        <FieldHelp label="变更比较">左侧是提交时保存的生效配置，右侧是本次固定候选，默认只列变化字段。历史记录未保存基线时明确显示未知，不使用当前草稿或后来生效的配置代替。</FieldHelp>
                      </h3>
                      {detail.baselineKnown ? (
                        <PublicationDiff api={api} before={detail.baseline} after={detail.snapshot} beforeLabel="提交时生效基线" afterLabel="候选固定快照" emptyLabel="候选固定快照与提交时生效基线没有差异" />
                      ) : (
                        <Alert type="warning" showIcon role="status" title="这条历史记录未保存提交时基线，无法还原准确变更；请驳回后重新提交带固定基线的申请，不能直接批准此历史候选。" />
                      )}
                    </section>
                    {comment && detail.status !== "PENDING" && (
                      <Alert
                        type="info"
                        showIcon
                        role="status"
                        title={`此记录已结束审核，以下意见尚未提交：${comment}`}
                        action={
                          <Button size="small" onClick={() => setComment("")}>
                            清除未提交意见
                          </Button>
                        }
                      />
                    )}
                  </div>
                ),
              },
              {
                key: "snapshot",
                label: "固定快照",
                children: (
                  <div className="op-review">
                    <div className="op-review__heading">
                      <h3>固定提交快照 · 修订 {stringifyJson(detail.snapshot.draftRevision)}</h3>
                      <span className="op-muted">管理专用，敏感值已隐藏</span>
                    </div>
                    <SnapshotView definition={detail.snapshot} />
                    <details className="op-review__raw">
                      <summary>查看原文（JSON）</summary>
                      <div className="op-review__raw-grid">
                        <div>
                          <h4>提交时生效基线</h4>
                          <pre className="op-snapshot__json">{detail.baselineKnown ? stringifyJson(publicationDisplay(detail.baseline), 2) : "历史基线未记录"}</pre>
                        </div>
                        <div>
                          <h4>固定提交快照</h4>
                          <pre className="op-snapshot__json">{stringifyJson(publicationDisplay(detail.snapshot), 2)}</pre>
                        </div>
                      </div>
                    </details>
                  </div>
                ),
              },
            ]
          : undefined
      }
      footer={
        detail && (
          <div className="op-review-footer" role="group" aria-label="审核操作">
            {writeError && (
              <div className="op-review-footer__error">
                <ErrorFeedback error={writeError} />
                <span className="op-muted">请刷新发布结果后再操作；已填写意见保留。</span>
              </div>
            )}
            <div className="op-review-footer__row">
              {reviewing ? (
                <div className="op-review-footer__comment">
                  <FieldLabel label="审核意见" help="通过时可选，补充核对依据；驳回时必填，说明需要修改的内容。" />
                  <Input.TextArea
                    aria-label="审核意见"
                    maxLength={500}
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    value={comment}
                    disabled={busy}
                    placeholder="驳回时必填，说明需要修改的内容"
                    onChange={(event) => setComment(event.target.value)}
                  />
                </div>
              ) : (
                <span className="op-review-footer__comment op-muted">
                  {detail.reviewComment ? `审核意见：${detail.reviewComment}` : canReview ? "本次记录没有人工审核意见。" : "当前权限仅允许查看此发布记录。"}
                </span>
              )}
              <div className="op-review-footer__actions">
                <Button disabled={busy} onClick={onBack}>
                  {backLabel}
                </Button>
                {reviewing && (
                  <>
                    <Button danger disabled={disabled || !comment.trim()} onClick={() => void review("reject")}>
                      驳回
                    </Button>
                    <Button type="primary" disabled={disabled || !detail.baselineKnown || detail.baselineStateVersion === null} onClick={() => void review("approve")}>
                      通过审核
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      }
    >
      {loadError}
    </EntityDrawer>
  );
}

/** 只在需要处理人注意时出现：失败、驳回、缺基线、回滚与独立停用。 */
function ReviewNotices({ detail, state }: { detail: ReleaseDetail; state: PublicationState | null }) {
  return (
    <>
      {detail.status === "FAILED" && <Alert type="error" showIcon title={`发布失败：${detail.failureReason || "候选未通过生效校验"}。本次审批已结束，原生效配置保持不变；请修正后重新提交。`} />}
      {detail.status === "PENDING" && detail.baselineStateVersion === null && <Alert type="warning" showIcon title="此申请缺少精确生效基线，不能通过；请填写驳回原因，退回重新提交。" />}
      {detail.status === "REJECTED" && <Alert type="warning" showIcon role="status" title={`本次申请已驳回，原生效配置保持不变。${detail.reviewComment || "请联系处理人确认需要修改的内容。"}`} />}
      {detail.kind === "ROLLBACK" && <Alert type="info" showIcon role="status" title={`回滚发布 · 来源 ${detail.sourceReleaseId}。通过后只更新生效快照，草稿和独立开关保持。`} />}
      {state?.liveReleaseId && !state.enabled && <Alert type="warning" showIcon role="status" title="当前独立停用；审核通过仍保持停用。" />}
    </>
  );
}

function submissionFacts(detail: ReleaseDetail) {
  const facts: NonNullable<DescriptionsProps["items"]> = [
    { key: "baseline", label: "比较基线", children: detail.baselineKnown ? (detail.baseline ? `生效 r${stringifyJson(detail.baseline.draftRevision)}` : "首次发布，无基线") : "历史基线未记录" },
    {
      key: "candidate",
      label: (
        <span className="op-review__label">
          固定候选
          <FieldHelp label="固定候选">候选读取提交时快照，后续草稿编辑不改变本次审核。审核通过不解除独立停用。</FieldHelp>
        </span>
      ),
      children: <span className="op-code">r{stringifyJson(detail.draftRevision)}</span>,
    },
    { key: "version", label: "外部版本", children: detail.version },
    { key: "audit", label: "审核规则", children: detail.auditRequired ? "提交时规则要求人工审核" : "按提交时规则免审，非人工审核通过" },
    { key: "submitter", label: "提交人", children: <PersonTag name={detail.submittedByName} employeeNo={detail.submittedByEmployeeNo} id={`租户 ID ${detail.submittedByTenantId}`} /> },
    { key: "submittedAt", label: "提交时间", children: <time dateTime={detail.submittedAt}>{publicationTime(detail.submittedAt)}</time> },
    { key: "comment", label: "发布备注", span: 2, children: detail.comment || <span className="op-muted">未填写</span> },
  ];
  if (detail.reviewedAt)
    facts.push(
      { key: "reviewer", label: "处理人", children: <PersonTag name={detail.reviewedByName} employeeNo={detail.reviewedByEmployeeNo} id={detail.reviewedByTenantId ? `租户 ID ${detail.reviewedByTenantId}` : null} /> },
      { key: "reviewedAt", label: "处理时间", children: <time dateTime={detail.reviewedAt}>{publicationTime(detail.reviewedAt)}</time> },
    );
  facts.push({ key: "id", label: "审核记录", span: 2, children: <IdText value={detail.id} label="审核记录编号" maxChars={40} /> });
  return facts;
}

/** 目标环境收到的跨环境申请：来源已发布不代替本环境审核，来源与操作人取自受理时的记录。 */
function IncomingSource({ api, incoming }: { api: AdminApi; incoming: IncomingReview }) {
  return (
    <section className="op-review__section" aria-labelledby="release-review-incoming">
      <h3 id="release-review-incoming">
        跨环境来源：{incoming.sourceEnvironment}
        <FieldHelp label="跨环境审核">这里处理目标环境收到的申请。来源已经发布，不代替本环境审核；本次候选与来源操作人均来自受理时保存的记录。</FieldHelp>
      </h3>
      <Descriptions
        size="small"
        bordered
        column={2}
        items={[
          { key: "source", label: "来源发布", children: <IdText value={incoming.sourceReleaseId} label="来源发布编号" maxChars={40} /> },
          { key: "operator", label: "原操作者", children: <PersonTag name={null} employeeNo={incoming.operatorEmployeeNo} id={`租户 ID ${incoming.operatorTenantId}`} /> },
        ]}
      />
      <details className="op-review__raw">
        <summary>提交时目标草稿与收到的配置</summary>
        <PublicationDiff api={api} before={incoming.before} after={incoming.after} beforeLabel="提交时目标草稿" afterLabel="收到的固定候选" />
      </details>
    </section>
  );
}
