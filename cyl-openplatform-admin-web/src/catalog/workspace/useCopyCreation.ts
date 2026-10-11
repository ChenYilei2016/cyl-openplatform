import { createRequestKey } from "../../shared/requestKey";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { useRef, useState, type MutableRefObject } from "react";
import { AdminApiError, type AdminApi } from "../../access/api";
import type { ApiDefinition } from "../CatalogPanel";
import type { ApiCopyDraft } from "../create/ApiCopyDialog";
import type { DraftMetadata } from "./draftModel";

/** 只有明确的客户端拒绝才能结束本次复制创建；代理 5xx 和业务 5xx 都可能已写入成功。 */
const isDefinitiveRejection = (failure: unknown) =>
  failure instanceof AdminApiError && ((failure.code >= 400 && failure.code < 500) || (failure.code >= 40000000 && failure.code < 50000000));
const isNotFound = (failure: unknown) => failure instanceof AdminApiError && (failure.code === 404 || Math.floor(failure.code / 100000) === 404);

/**
 * 复制新 API 的幂等创建（沿用 /api-copies 创建键语义）：
 * 发送时固定创建键与原始正文；结果未知时先按创建键查询原结果，查无（404）才允许用同一请求重试。
 */
export function useCopyCreation({
  api,
  saving,
  setBusy,
  setError,
  onCreated,
}: {
  api: AdminApi;
  saving: MutableRefObject<boolean>;
  setBusy: (busy: boolean) => void;
  setError: (message: string) => void;
  onCreated: (saved: ApiDefinition) => void;
}) {
  const request = useRef<{ creationKey: string; bodyText: string } | null>(null);
  const [recovery, setRecovery] = useState<"unknown" | "not-found" | null>(null);
  /** 生成创建请求；调用标识与来源完全相同时拒绝（只改名称不能产生新的调用地址）。 */
  const start = (copy: ApiCopyDraft, metadata: DraftMetadata, definitionBody: string) => {
    if ((["service", "version", "method"] as const).every((key) => metadata[key].trim() === copy.snapshot[key]))
      throw new Error("复制新 API 至少更换服务标识、外部版本或操作标识中的一项。");
    const creationKey = createRequestKey();
    const { sourceApiId, sourceKind, sourceRevision, sourceReleaseId } = copy;
    request.current = {
      creationKey,
      bodyText: `{${stringifyJson({ creationKey, sourceApiId, sourceKind, sourceRevision, sourceReleaseId }).slice(1, -1)},"definition":${definitionBody}}`,
    };
    return request.current.bodyText;
  };
  const succeeded = () => {
    request.current = null;
  };
  const failed = (failure: unknown) => {
    if (!request.current) return;
    if (isDefinitiveRejection(failure)) request.current = null;
    else setRecovery("unknown");
  };
  const recover = async (retry: boolean) => {
    const current = request.current;
    if (!current || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await api<ApiDefinition>(
        retry ? "/api-copies" : `/api-copies/requests/${encodeURIComponent(current.creationKey)}`,
        retry ? { method: "POST", bodyText: current.bodyText } : {},
      );
      request.current = null;
      saving.current = false;
      setRecovery(null);
      onCreated(saved);
    } catch (failure) {
      if (!retry && isNotFound(failure)) {
        setRecovery("not-found");
        setError("尚未找到原创建结果。可使用同一创建键和原正文重试，不会重复创建。");
      } else if (retry && isDefinitiveRejection(failure)) {
        request.current = null;
        setRecovery(null);
        setError((failure as Error).message);
      } else {
        setRecovery("unknown");
        setError(`创建结果仍待核对：${(failure as Error).message}`);
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return { pending: () => request.current !== null, recovery, start, succeeded, failed, recover };
}
