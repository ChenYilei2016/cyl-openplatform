import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { CopyButton } from "@cyl/open-platform-web-shared/ui/components";
import { Alert, Button, Space } from "antd";
import { releaseStatusNames } from "./types";
import type { PublicationSubmissionState } from "./usePublicationSubmission";

/** 发布/回滚提交的结果提示：结果未知时给出“查询原提交”，受理后给出结果与快照入口。 */
export default function SubmissionNotice({ state, canPublish, onReview }: { state: PublicationSubmissionState; canPublish: boolean; onReview: (releaseId: string) => void }) {
  const { submission, result, error, busy, originalChecked } = state;
  return (
    <>
      {submission && (
        <Alert
          type="warning"
          showIcon
          className="op-publish__notice"
          title={busy ? "正在核对本次提交…" : "提交结果未知，请先查询原提交"}
          description={
            <span>
              {"sourceReleaseId" in submission ? "回滚发布" : `固定草稿 r${stringifyJson(submission.expectedDraftRevision)}`} · 备注：{submission.comment || "未填写"} · 原提交号
              <CopyButton value={submission.submissionKey} label="原提交号" />
            </span>
          }
          action={
            <Space>
              <Button size="small" disabled={busy} onClick={() => void state.queryOriginal()}>
                查询原提交结果
              </Button>
              {canPublish && originalChecked && (
                <Button size="small" disabled={busy} onClick={() => void state.retryOriginal()}>
                  重试原提交
                </Button>
              )}
            </Space>
          }
        />
      )}
      {error && <Alert type="error" showIcon className="op-publish__notice" title={error} closable onClose={state.clearError} />}
      {result && (
        <Alert
          type={result.status === "APPLIED" ? "success" : result.status === "PENDING" ? "info" : "error"}
          showIcon
          closable
          onClose={state.clearResult}
          className="op-publish__notice"
          title={`${result.kind === "ROLLBACK" ? "回滚" : "提交"}结果：${releaseStatusNames[result.status]} · 固定修订 r${stringifyJson(result.draftRevision)}${result.failureReason ? ` · ${result.failureReason}` : ""}`}
          action={
            <Button size="small" type="link" onClick={() => onReview(result.id)}>
              查看固定快照
            </Button>
          }
        />
      )}
    </>
  );
}
