import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { Alert, Button, Drawer, Space } from "antd";
import { draftComparable, snapshotComparable } from "./compare";
import { sectionDiffs, sectionTitle } from "./draftModel";
import type { ApiDraft } from "./useApiDraft";

/** 保存冲突：别人先保存了新修订。三选一：查看对方修改、以我的修改覆盖、放弃我的修改。 */
export default function ConflictDrawer({ draft }: { draft: ApiDraft }) {
  const conflict = draft.conflict;
  const latest = conflict?.latest;
  const differences = latest
    ? sectionDiffs(draftComparable(draft), snapshotComparable(latest))
    : [];
  return (
    <Drawer
      open={conflict !== null}
      title="草稿已被他人更新"
      size={520}
      onClose={draft.closeConflict}
      maskClosable={!draft.busy}
      footer={
        <Space wrap>
          <Button onClick={() => void draft.loadConflict()} loading={conflict?.loading} disabled={draft.busy}>
            查看对方修改
          </Button>
          <Button type="primary" danger onClick={() => void draft.overwrite()} loading={draft.busy}>
            以我的修改覆盖
          </Button>
          <Button onClick={draft.discardLocal} disabled={draft.busy}>
            放弃我的修改
          </Button>
        </Space>
      }
    >
      <Alert type="warning" showIcon title={conflict?.message || "草稿已变化"} description={`你基于 r${stringifyJson(draft.definition.draftRevision)} 编辑；在你保存前，其他人已保存了新的修订。你的输入仍保留在页面上。`} />
      {latest && (
        <div className="op-conflict">
          <p>
            服务器最新为 <strong>r{stringifyJson(latest.draftRevision)}</strong>
            {differences.length ? `，与你当前的输入在 ${differences.map(sectionTitle).join("、")} 上不同。` : "，与你当前的输入内容一致。"}
          </p>
          <ul className="op-conflict__hints">
            <li>以我的修改覆盖：用你当前的输入生成新修订，对方在这些分区的修改会被替换。</li>
            <li>放弃我的修改：丢弃本页未保存输入，加载 r{stringifyJson(latest.draftRevision)}。</li>
          </ul>
        </div>
      )}
    </Drawer>
  );
}
