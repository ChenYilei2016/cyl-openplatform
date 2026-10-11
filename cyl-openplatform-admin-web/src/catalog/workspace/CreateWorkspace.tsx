import { EllipsisOutlined } from "@ant-design/icons";
import { StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { Alert, Button, Dropdown, Space } from "antd";
import type { ReactNode } from "react";
import type { AdminApi } from "../../access/api";
import type { ApiDefinition } from "../CatalogPanel";
import ConfigPage from "./ConfigPage";
import type { DraftCreation } from "./draftModel";
import { useApiDraft } from "./useApiDraft";
import { useWholeJsonEditor } from "./useWholeJsonEditor";
import "./workspace.css";

/**
 * 尚未创建的 API 草稿（116）：复制新 API、补齐导入候选。
 * 与已有 API 共用配置页（分区、检查面板、保存栏），没有调试 / 发布 / 版本页签。
 */
export default function CreateWorkspace({
  api,
  definition,
  creation,
  canManageConnections = false,
  breadcrumb,
  backAction,
  context,
  onCreated,
}: {
  api: AdminApi;
  /** 占位定义（draftModel.placeholderDefinition）。 */
  definition: ApiDefinition;
  creation: DraftCreation;
  canManageConnections?: boolean;
  breadcrumb: ReactNode;
  /** 页头的返回动作；保存或结果待核对期间不可用。 */
  backAction?: { label: string; onClick: () => void };
  /** 来源说明：复制来源与提醒、候选来源与缺项；函数形式可按“保存或结果待核对中”禁用其中的离开动作。 */
  context?: ReactNode | ((leaving: boolean) => ReactNode);
  onCreated?: (saved: ApiDefinition) => void;
}) {
  const draft = useApiDraft({ api, definition, creation, onSaved: onCreated });
  const wholeJson = useWholeJsonEditor(draft);
  const { metadata } = draft;
  const leaving = draft.busy || draft.locked;
  return (
    <section className="op-api-workspace" aria-label={creation.kind === "copy" ? "复制新 API" : "补齐导入候选"}>
      <header className="op-api-workspace__head">
        <div className="op-api-workspace__breadcrumb">{breadcrumb}</div>
        <div className="op-api-workspace__title-row">
          <div className="op-api-workspace__title">
            <h1>{metadata.name.trim() || "新建 API"}</h1>
            <div className="op-api-workspace__badges" aria-label="创建状态">
              <StatusBadge tone="neutral">{creation.kind === "copy" ? "尚未创建" : "导入候选 · 尚未写入"}</StatusBadge>
            </div>
          </div>
          <Space className="op-api-workspace__actions">
            {backAction && (
              <Button disabled={leaving} onClick={() => !leaving && backAction.onClick()}>
                {backAction.label}
              </Button>
            )}
            <Dropdown trigger={["click"]} menu={{ items: [{ key: "json", label: "以 JSON 编辑整份配置", disabled: leaving }], onClick: () => wholeJson.open() }}>
              <Button icon={<EllipsisOutlined aria-hidden />} aria-label="更多操作" />
            </Dropdown>
          </Space>
        </div>
        <code className="op-api-workspace__identity">
          {metadata.service || "service"}.{metadata.method || "method"} · 外部版本 {metadata.version || "—"}
        </code>
      </header>
      {context && <div className="op-create__context">{typeof context === "function" ? context(leaving) : context}</div>}
      {draft.copyRecovery && (
        <Alert
          className="op-config__banner"
          type="warning"
          showIcon
          role="status"
          title="原创建结果待核对"
          description="输入与原请求已保留。先查询结果，再决定是否重试；重试发送原正文，不会重复创建。"
          action={
            <div className="op-config__banner-actions">
              <Button size="small" type="primary" disabled={draft.busy} onClick={() => void draft.recoverCopy(false)}>
                查询原创建结果
              </Button>
              {draft.copyRecovery === "not-found" && (
                <Button size="small" disabled={draft.busy} onClick={() => void draft.recoverCopy(true)}>
                  使用原请求重试创建
                </Button>
              )}
            </div>
          }
        />
      )}
      <ConfigPage draft={draft} workspace={null} canManageConnections={canManageConnections} active />
      {wholeJson.drawer}
    </section>
  );
}
