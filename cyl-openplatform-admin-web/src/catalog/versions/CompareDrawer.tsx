import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { EntityDrawer } from "@cyl/open-platform-web-shared/ui/components";
import { Alert, Button, Skeleton } from "antd";
import { useEffect, useState } from "react";
import type { AdminApi } from "../../access/api";
import PublicationDiff from "../../publication/PublicationDiff";
import { releaseOutcome, type ReleaseDetail } from "../../publication/types";
import type { ApiDefinition } from "../CatalogPanel";
import type { RevisionDetail } from "./types";

/** 可比较的固定快照：草稿修订或发布记录。 */
export type CompareTarget = { kind: "revision"; revision: string } | { kind: "release"; releaseId: string };

const loadSnapshot = async (api: AdminApi, apiId: string, target: CompareTarget, signal: AbortSignal): Promise<{ label: string; snapshot: ApiDefinition }> => {
  if (target.kind === "revision") {
    const value = await api<RevisionDetail>(`/apis/${encodeURIComponent(apiId)}/revisions/${target.revision}`, { signal });
    if (!value?.snapshot || value.apiId !== apiId || value.snapshot.id !== apiId || stringifyJson(value.revision) !== target.revision)
      throw new Error("缺少可比较的草稿快照，不能判断差异。");
    return { label: `草稿 r${target.revision}`, snapshot: value.snapshot };
  }
  const value = await api<ReleaseDetail>(`/publications/${encodeURIComponent(target.releaseId)}`, { signal });
  if (value.id !== target.releaseId || value.apiId !== apiId || value.snapshot?.id !== apiId || stringifyJson(value.snapshot.draftRevision) !== stringifyJson(value.draftRevision))
    throw new Error("发布快照不完整，不能比较。");
  return { label: `发布 r${stringifyJson(value.draftRevision)} · ${releaseOutcome(value)}`, snapshot: value.snapshot };
};

/** 两个固定快照的差异：targets[0] 为基线（较早），targets[1] 为对比。 */
export default function CompareDrawer({ api, apiId, targets, onClose }: { api: AdminApi; apiId: string; targets: [CompareTarget, CompareTarget] | null; onClose: () => void }) {
  const [result, setResult] = useState<{ label: string; snapshot: ApiDefinition }[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setResult(null);
    setError("");
    if (!targets) return;
    const controller = new AbortController();
    void Promise.all(targets.map((target) => loadSnapshot(api, apiId, target, controller.signal)))
      .then((values) => {
        if (!controller.signal.aborted) setResult(values);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(`差异暂不可用：${(failure as Error).message}`);
      });
    return () => controller.abort();
  }, [api, apiId, targets, retry]);
  return (
    <EntityDrawer
      open={!!targets}
      width="lg"
      title="版本比较"
      subtitle={result ? `${result[0].label} → ${result[1].label}` : "正在读取两个固定快照"}
      onClose={onClose}
    >
      {error && <Alert type="error" showIcon title={error} action={<Button size="small" onClick={() => setRetry((value) => value + 1)}>重试</Button>} />}
      {!result && !error && <Skeleton active paragraph={{ rows: 6 }} />}
      {result && (
        <PublicationDiff
          api={api}
          before={result[0].snapshot}
          after={result[1].snapshot}
          beforeLabel={result[0].label}
          afterLabel={result[1].label}
          emptyLabel="两个版本内容无差异"
        />
      )}
    </EntityDrawer>
  );
}
