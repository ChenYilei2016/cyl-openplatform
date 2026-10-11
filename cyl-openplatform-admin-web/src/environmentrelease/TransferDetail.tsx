import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { FieldHelp, IdText, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable } from "@cyl/open-platform-web-shared/ui/list";
import { Alert, Button, Descriptions } from "antd";
import type { ReactNode } from "react";
import { publicationTime } from "../publication/publicationDisplay";
import SnapshotView from "../publication/SnapshotView";
import { accessTone, deliveryTone, transferHelp, transferProgress } from "./transferProgress";
import type { OutgoingTransfer, Target } from "./types";
import "./transfers.css";

const receiptStatus = { PENDING: "待审核", APPLIED: "已通过发布", REJECTED: "已驳回", FAILED: "生效失败" } as const;

/** 刷新与重试只对有发布权限的账号出现；重试只在发送结果仍未确定时提供，服务端会先读取原记录。 */
export function TransferActions({ transfer, busy, canOperate, onRefresh, onRetry }: { transfer: OutgoingTransfer; busy: boolean; canOperate: boolean; onRefresh: () => void; onRetry: () => void }) {
  if (!canOperate) return null;
  return (
    <>
      {["READY", "UNKNOWN"].includes(transfer.deliveryState) && (
        <Button disabled={busy} onClick={onRetry}>
          查询并重试原传输
        </Button>
      )}
      <Button loading={busy} onClick={onRefresh}>
        刷新目标状态
      </Button>
    </>
  );
}

function Fact({ value, detail }: { value: ReactNode; detail: ReactNode }) {
  return (
    <div className="op-cell-main">
      <span>{value}</span>
      <span className="op-cell-sub">{detail}</span>
    </div>
  );
}

const helpLabel = (label: string, help: readonly [string, string]) => (
  <span className="op-transfer__label">
    {label}
    <FieldHelp label={label}>{help[1]}</FieldHelp>
  </span>
);

/** 一次跨环境传输的已保存进度：发送、目标审核、目标配置与独立开关分别表达，节点逐一核对。 */
export default function TransferDetail({ transfer, target, canOperate = true }: { transfer: OutgoingTransfer; target?: Target; canOperate?: boolean }) {
  const progress = transferProgress({ ...transfer, sourceEnvironment: transfer.request.sourceEnvironment, targetId: transfer.request.targetEnvironment }, target);
  const receipt = progress.receipt;
  const definition = transfer.request.definition;
  return (
    <section className="op-transfer" aria-label="传输详情">
      {transfer.error && <Alert type="error" showIcon title={transfer.error} />}
      <Descriptions
        size="small"
        bordered
        layout="vertical"
        column={4}
        items={[
          { key: "delivery", label: helpLabel("发送 / 接收", transferHelp.send), children: <Fact value={<StatusBadge tone={deliveryTone[transfer.deliveryState]}>{progress.delivery}</StatusBadge>} detail={progress.received} /> },
          { key: "review", label: helpLabel("目标审核", transferHelp.review), children: <Fact value={progress.review} detail={receipt?.auditRequired ? "由目标审核人处理" : "以目标审核规则为准"} /> },
          { key: "config", label: helpLabel("目标配置", transferHelp.config), children: <Fact value={progress.config} detail={receipt ? `本次修订 r${stringifyJson(receipt.draftRevision)}` : "尚未取得匹配回执"} /> },
          { key: "access", label: helpLabel("独立开关", transferHelp.enabled), children: <Fact value={<StatusBadge tone={accessTone(receipt?.enabled)}>{progress.access}</StatusBadge>} detail="发布不会自动启用" /> },
        ]}
      />
      <div className="op-transfer__heading">
        <h3>
          节点观测
          <FieldHelp label="节点观测">{transferHelp.nodes[1]}</FieldHelp>
        </h3>
        <span role="status">
          <StatusBadge tone={progress.ready ? "success" : "warning"}>
            {progress.ready ? "全部目标节点当前已生效" : progress.complete ? "全部节点已加载，目标 API 当前停用" : "尚未确认全部目标节点当前生效"}
          </StatusBadge>
        </span>
      </div>
      {progress.nodes.length ? (
        <DataTable<(typeof progress.nodes)[number]>
          caption="目标节点观测"
          rowKey={(node) => node.nodeId}
          data={progress.nodes}
          columns={[
            { key: "node", title: "目标节点", width: 140, hideable: false, render: (node) => <span className="op-code">{node.nodeId}</span> },
            {
              key: "release",
              title: "配置与发布",
              render: (node) =>
                node.error ? (
                  <span className="op-cell-sub--error">{node.error}</span>
                ) : node.receipt ? (
                  <div className="op-cell-main">
                    <span>
                      r{stringifyJson(node.receipt.draftRevision)} · {receiptStatus[node.receipt.status]}
                    </span>
                    <IdText value={node.receipt.releaseId} label="目标发布编号" maxChars={32} />
                    {node.receipt.liveReleaseId !== node.receipt.releaseId && <span className="op-cell-sub op-cell-sub--warning">当前运行仍为 {node.receipt.liveReleaseId || "无生效配置"}</span>}
                  </div>
                ) : (
                  <span className="op-muted">未观测</span>
                ),
            },
            { key: "access", title: "独立开关", width: 120, render: (node) => (node.receipt ? <StatusBadge tone={accessTone(node.receipt.enabled)}>{node.receipt.enabled ? "启用" : "API 已停用"}</StatusBadge> : <span className="op-muted">未知</span>) },
            {
              key: "time",
              title: "观测时间",
              width: 170,
              render: (node) => {
                const time = node.observation?.observedAt || node.receipt?.observedAt;
                return time ? publicationTime(time) : <span className="op-muted">未观测</span>;
              },
            },
          ]}
        />
      ) : (
        <Alert type="warning" showIcon role="status" title="节点清单未知，请联系维护者核对目标配置后刷新。" />
      )}
      <p className="op-muted op-transfer__note">{progress.observation}；以上只代表标注时刻，调用还需通过权限与服务运行校验。</p>
      <Descriptions
        size="small"
        bordered
        column={1}
        items={[
          { key: "id", label: "原传输编号", children: <IdText value={transfer.id} label="原传输编号" maxChars={40} /> },
          { key: "source", label: "来源固定发布", children: <IdText value={transfer.request.sourceReleaseId} label="来源发布编号" maxChars={40} /> },
          { key: "target", label: "目标本次发布", children: receipt ? <IdText value={receipt.releaseId} label="目标发布编号" maxChars={40} /> : <span className="op-muted">尚未取得</span> },
          { key: "live", label: "目标当前生效发布", children: receipt?.liveReleaseId ? <IdText value={receipt.liveReleaseId} label="目标生效发布编号" maxChars={40} /> : <span className="op-muted">尚未取得</span> },
          { key: "time", label: "回执观测时间", children: receipt?.observedAt ? publicationTime(receipt.observedAt) : <span className="op-muted">尚未取得</span> },
        ]}
      />
      {definition && (
        <details className="op-transfer__fold">
          <summary>查看本次发送的固定内容</summary>
          <SnapshotView definition={definition} />
        </details>
      )}
      {!canOperate && <p className="op-muted op-transfer__note">当前账号可阅读已保存进度；刷新目标节点或重试发送需要 API 发布权限。</p>}
    </section>
  );
}
