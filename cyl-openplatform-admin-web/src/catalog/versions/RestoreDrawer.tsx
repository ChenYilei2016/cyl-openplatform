import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { EntityDrawer } from "@cyl/open-platform-web-shared/ui/components";
import { Alert, Button, Checkbox, Skeleton, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import type { AdminApi } from "../../access/api";
import PublicationDiff from "../../publication/PublicationDiff";
import type { ApiDefinition } from "../CatalogPanel";
import type { RevisionDetail } from "./types";

/**
 * 恢复历史修订为草稿：先核对“当前草稿 → 历史修订”的差异再确认。只改草稿，生效版本、审核、访问开关不变；
 * 有未保存输入时须明确放弃后才读取与恢复。
 */
export default function RestoreDrawer({
  api,
  apiId,
  revision,
  canManage,
  hasUnsavedChanges,
  onClose,
  onRestored,
}: {
  api: AdminApi;
  apiId: string;
  revision: string | null;
  canManage: boolean;
  hasUnsavedChanges: () => boolean;
  onClose: () => void;
  onRestored: (value: ApiDefinition, changed: boolean) => void;
}) {
  const path = `/apis/${encodeURIComponent(apiId)}`;
  const dirty = !!revision && hasUnsavedChanges();
  const [discard, setDiscard] = useState(false);
  const [snapshots, setSnapshots] = useState<{ current: ApiDefinition; historical: ApiDefinition } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const writing = useRef(false);

  useEffect(() => {
    setDiscard(false);
    setNeedsRefresh(false);
  }, [revision]);
  useEffect(() => {
    setSnapshots(null);
    setError("");
    if (!revision || (dirty && !discard)) return;
    const controller = new AbortController();
    void Promise.all([api<ApiDefinition>(path, { signal: controller.signal }), api<RevisionDetail>(`${path}/revisions/${revision}`, { signal: controller.signal })])
      .then(([current, historical]) => {
        if (
          current?.id !== apiId ||
          !historical?.snapshot ||
          historical.apiId !== apiId ||
          historical.snapshot.id !== apiId ||
          stringifyJson(historical.revision) !== revision ||
          stringifyJson(historical.snapshot.draftRevision) !== revision
        )
          throw new Error("缺少完整草稿或历史快照，不能恢复。");
        if (!controller.signal.aborted) {
          setSnapshots({ current, historical: historical.snapshot });
          setNeedsRefresh(false);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError((failure as Error).message);
      });
    return () => controller.abort();
  }, [api, apiId, path, revision, dirty, discard, refresh]);

  const restore = async () => {
    if (!snapshots || !canManage || writing.current || needsRefresh || (hasUnsavedChanges() && !discard)) return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const { changed, ...value } = await api<ApiDefinition & { changed: boolean }>(`${path}/revisions/${revision}/restore`, {
        method: "POST",
        body: { expectedRevision: snapshots.current.draftRevision },
      });
      onRestored(value, changed);
    } catch (failure) {
      setError(`${(failure as Error).message} 本次未确认恢复结果，请重新读取并核对当前草稿。`);
      setNeedsRefresh(true);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };

  return (
    <EntityDrawer
      open={!!revision}
      width="lg"
      title={`恢复 r${revision ?? ""} 为草稿`}
      subtitle="只更新草稿；生效版本、审核、访问开关与授权保持不变，恢复后仍需另行发布。"
      onClose={() => !busy && onClose()}
      footer={
        <div className="op-versions__drawer-footer">
          <span className="op-muted">内容有变化时生成新修订；内容相同不增加修订。</span>
          <Space>
            <Button disabled={busy} onClick={onClose}>
              取消
            </Button>
            {needsRefresh && (
              <Button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
                重新读取
              </Button>
            )}
            <Button type="primary" loading={busy} disabled={busy || !snapshots || !canManage || needsRefresh || (dirty && !discard)} onClick={() => void restore()}>
              确认恢复草稿
            </Button>
          </Space>
        </div>
      }
    >
      <div className="op-versions__drawer-body">
        {!canManage && <Alert type="warning" showIcon title="当前账号没有 API 管理权限（MANAGE_APIS），可以核对差异，不能恢复。" />}
        {dirty && (
          <Alert
            type="warning"
            showIcon
            title="配置页有未保存的修改"
            description={
              <Checkbox checked={discard} disabled={busy} onChange={(event) => setDiscard(event.target.checked)}>
                我确认放弃未保存的修改，继续核对恢复内容
              </Checkbox>
            }
          />
        )}
        {error && <Alert type="error" showIcon title={error} />}
        {revision && !(dirty && !discard) && !snapshots && !error && <Skeleton active paragraph={{ rows: 6 }} />}
        {snapshots && (
          <PublicationDiff
            api={api}
            before={snapshots.current}
            after={snapshots.historical}
            beforeLabel={`当前草稿 r${stringifyJson(snapshots.current.draftRevision)}`}
            afterLabel={`恢复为 r${revision}`}
            emptyLabel="历史内容与当前草稿相同，恢复不会增加修订"
          />
        )}
      </div>
    </EntityDrawer>
  );
}
