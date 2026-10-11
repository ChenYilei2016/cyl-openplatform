import { useRef, useState } from "react";
import { AdminApiError, type AdminApi } from "../access/api";
import type { PublicationSubmission, ReleaseDetail, RollbackSubmission, StandardSubmission } from "./types";

const httpStatus = (failure: unknown) =>
  failure instanceof AdminApiError ? (failure.code < 1000 ? failure.code : Math.floor(failure.code / 100000)) : null;

/**
 * 标准发布与回滚共用的提交过程：提交号先登记到会话内的待确认集合，结果未知时只允许按原提交号查询或重试，
 * 不生成新的提交号；4xx 视为确定失败并清除。发布页与“版本与生命周期”页各自挂载，共享同一个待确认集合。
 */
export function usePublicationSubmission({
  api,
  apiId,
  pendingSubmissions,
  publicationNotes,
  onAccepted,
}: {
  api: AdminApi;
  apiId: string;
  pendingSubmissions: Map<string, PublicationSubmission>;
  publicationNotes?: Map<string, string>;
  onAccepted: (release: ReleaseDetail) => void;
}) {
  const path = `/publications/apis/${encodeURIComponent(apiId)}`;
  const [submission, setSubmission] = useState<PublicationSubmission | null>(pendingSubmissions.get(apiId) ?? null);
  const [originalChecked, setOriginalChecked] = useState(false);
  const [result, setResult] = useState<ReleaseDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);

  const accept = (value: ReleaseDetail) => {
    setResult(value);
    if (value.kind === "ROLLBACK" && value.sourceReleaseId) publicationNotes?.delete(`rollback:${apiId}:${value.sourceReleaseId}`);
    else publicationNotes?.delete(`publish:${apiId}`);
    pendingSubmissions.delete(apiId);
    setSubmission(null);
    setOriginalChecked(false);
    onAccepted(value);
  };

  /** 返回 true 表示服务端已受理（结果见 result）；false 表示失败或结果未知。 */
  const submit = async (attempt: StandardSubmission | RollbackSubmission): Promise<boolean> => {
    if (writing.current) return false;
    const current = submission ?? attempt;
    writing.current = true;
    pendingSubmissions.set(apiId, current);
    setSubmission(current);
    setOriginalChecked(false);
    setBusy(true);
    setError("");
    try {
      accept(await api<ReleaseDetail>(`${path}/${"sourceReleaseId" in current ? "rollbacks" : "submissions"}`, { method: "POST", body: current }));
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      const status = httpStatus(failure);
      if (status !== null && status >= 400 && status < 500) {
        pendingSubmissions.delete(apiId);
        setSubmission(null);
      }
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };

  const queryOriginal = async () => {
    if (!submission || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError("");
    setOriginalChecked(false);
    try {
      accept(await api<ReleaseDetail>(`${path}/submissions/${encodeURIComponent(submission.submissionKey)}`));
    } catch (failure) {
      if (httpStatus(failure) === 404) {
        setOriginalChecked(true);
        setError("暂未查到原提交记录，可使用原提交号重试；不会创建新的提交号。");
      } else setError((failure as Error).message);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };

  return {
    submission,
    originalChecked,
    result,
    error,
    busy,
    submit,
    queryOriginal,
    retryOriginal: () => (submission ? submit(submission) : Promise.resolve(false)),
    clearError: () => setError(""),
    clearResult: () => setResult(null),
  };
}

export type PublicationSubmissionState = ReturnType<typeof usePublicationSubmission>;
