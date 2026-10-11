import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { defaultLifecycle, lifecycleStatusNames, type ApiLifecycle } from "@cyl/open-platform-web-shared/lifecycle";
import { EntityDrawer, StatusBadge, type StatusTone } from "@cyl/open-platform-web-shared/ui/components";
import { Alert, Button, Space } from "antd";
import { useEffect, useState } from "react";
import AffectedApplications from "../../lifecycle/AffectedApplications";
import LifecycleFields, { lifecycleIssues } from "../../lifecycle/LifecycleFields";
import type { EffectiveRelease } from "../../publication/types";
import { IssueText } from "../workspace/ConfigSection";
import type { ApiDraft } from "../workspace/useApiDraft";

const tone: Record<ApiLifecycle["status"], StatusTone> = { ACTIVE: "success", DEPRECATED: "warning", RETIRED: "error" };

/**
 * 维护声明（废弃、退役、迁移公告）：默认一行摘要（生效状态与草稿状态），展开后编辑。
 * 编辑的是同一份工作草稿，保存为新修订；发布后才对外生效。
 */
export default function LifecycleCard({
  draft,
  liveReleaseId,
  canReadAffected,
  onGoPublish,
}: {
  draft: ApiDraft;
  liveReleaseId: string | null;
  canReadAffected: boolean;
  onGoPublish: () => void;
}) {
  const { api, definition } = draft;
  const [live, setLive] = useState<ApiLifecycle | null>(null);
  const [affectedOpen, setAffectedOpen] = useState(false);
  const changed = draft.changed.includes("lifecycle");
  const [editing, setEditing] = useState(changed);
  const [saved, setSaved] = useState("");
  useEffect(() => {
    setLive(null);
    if (!liveReleaseId) return;
    const controller = new AbortController();
    void api<EffectiveRelease>(`/publications/apis/${encodeURIComponent(definition.id)}/effective`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setLive(value.snapshot.lifecycle ?? defaultLifecycle);
      })
      .catch(() => {
        /* 生效状态仅作对照，读取失败时不显示。 */
      });
    return () => controller.abort();
  }, [api, definition.id, liveReleaseId]);

  const savedLifecycle = definition.lifecycle ?? defaultLifecycle;
  const pendingPublish = !!live && stringifyJson(live) !== stringifyJson(savedLifecycle);
  const invalid = Object.values(lifecycleIssues(draft.lifecycle, definition.version)).find(Boolean);
  const otherChanges = draft.changed.filter((field) => field !== "lifecycle").length;
  const save = async () => {
    setSaved("");
    if (await draft.save()) setSaved("已保存为新修订，发布后对外生效。");
  };

  return (
    <section className="op-versions__card" aria-label="维护声明">
      <header className="op-versions__card-head">
        <div className="op-versions__card-title">
          <h2>维护声明</h2>
          {live ? (
            <span className="op-versions__lifecycle-state">
              <span className="op-muted">生效</span>
              <StatusBadge tone={tone[live.status]}>{lifecycleStatusNames[live.status]}</StatusBadge>
            </span>
          ) : (
            <span className="op-muted">尚未发布</span>
          )}
          {(pendingPublish || !live) && (
            <span className="op-versions__lifecycle-state">
              <span className="op-muted">已保存草稿</span>
              <StatusBadge tone={tone[savedLifecycle.status]}>{lifecycleStatusNames[savedLifecycle.status]}</StatusBadge>
              {pendingPublish && <span className="op-muted">待发布</span>}
            </span>
          )}
          {changed && <StatusBadge tone="warning">有未保存修改</StatusBadge>}
        </div>
        <Space>
          {canReadAffected && <Button onClick={() => setAffectedOpen(true)}>可能受影响的接入方</Button>}
          {!editing && <Button onClick={() => setEditing(true)}>编辑维护声明</Button>}
        </Space>
      </header>
      {!editing && <p className="op-muted op-versions__card-note">用于废弃或退出当前外部版本并告知迁移安排；废弃仍可调用，退出后调用返回 410。紧急停止调用请用“发布”页的停用。</p>}
      {editing && (
        <div className="op-versions__lifecycle-form" data-field-path="/lifecycle">
          <IssueText result={draft.currentValidation} path="/lifecycle" />
          <LifecycleFields value={draft.lifecycle} version={definition.version} onChange={draft.updateLifecycle} disabled={draft.busy} />
          {saved && !changed && (
            <Alert
              type="success"
              showIcon
              title={saved}
              action={
                <Button size="small" type="link" onClick={onGoPublish}>
                  去发布
                </Button>
              }
            />
          )}
          <div className="op-versions__lifecycle-actions">
            <span className="op-muted">
              {invalid || (changed ? `保存为修订 r${nextRevision(definition.draftRevision)}${otherChanges ? `，将一并保存配置页的 ${otherChanges} 处修改` : ""}；发布后才对外生效。` : "与已保存草稿一致。")}
            </span>
            <Space>
              <Button
                disabled={draft.busy}
                onClick={() => {
                  if (changed) draft.updateLifecycle(savedLifecycle);
                  setEditing(false);
                  setSaved("");
                }}
              >
                {changed ? "撤销修改" : "收起"}
              </Button>
              <Button type="primary" loading={draft.busy} disabled={!changed || !!invalid || draft.busy} onClick={() => void save()}>
                保存维护声明
              </Button>
            </Space>
          </div>
        </div>
      )}
      <EntityDrawer open={affectedOpen} width="lg" title="可能受影响的接入方" subtitle="调整维护状态前，核对哪些接入凭据有权限调用此 API" onClose={() => setAffectedOpen(false)}>
        <AffectedApplications api={api} apiId={definition.id} defaultBasis={liveReleaseId ? "EFFECTIVE" : "DRAFT"} />
      </EntityDrawer>
    </section>
  );
}

const nextRevision = (revision: number) => {
  try {
    return (BigInt(stringifyJson(revision)) + 1n).toString();
  } catch {
    return "";
  }
};
