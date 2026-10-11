import { StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Alert, Button } from "antd";
import { useEffect, useState } from "react";
import type { AdminApi } from "../access/api";
import { publicationTime } from "../publication/publicationDisplay";
import { deliveryTone, transferProgress } from "./transferProgress";
import type { Target, TransferSummary } from "./types";

/** 单个 API 发往其他环境的记录（按 service/version/method 精确过滤）；详情与跟进在审核中心的跨环境发布页。 */
export default function ApiTransfers({ api, apiId, onOpen }: { api: AdminApi; apiId: string; onOpen: (transferId: string) => void }) {
  const [page, setPage] = useState(1);
  const transfers = useReadPage<TransferSummary>(api, `/environment-releases?apiId=${encodeURIComponent(apiId)}&page=${page}&pageSize=20`);
  const [targets, setTargets] = useState<Target[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void api<Target[]>("/environment-releases/targets", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setTargets(value);
      })
      .catch(() => {
        /* 目标名称只用于展示，读取失败时显示目标编号。 */
      });
    return () => controller.abort();
  }, [api]);
  if (!transfers.loading && !transfers.error && !transfers.data?.total) return <p className="op-muted op-versions__empty-line">尚未发往其他环境。可在“发布”页的“⋯”中把当前生效版本发布到其他环境。</p>;
  return (
    <>
      {transfers.error && <Alert type="error" showIcon title={transfers.error} action={<Button size="small" onClick={transfers.reload}>重试</Button>} />}
      <DataTable<TransferSummary>
        rowKey={(item) => item.id}
        loading={transfers.loading}
        data={transfers.data?.items ?? []}
        caption="发往其他环境的记录"
        pagination={transfers.data && transfers.data.total > 20 ? { page, pageSize: 20, total: transfers.data.total, onChange: setPage, pageSizeOptions: [20] } : undefined}
        columns={[
          {
            key: "target",
            title: "目标环境",
            hideable: false,
            render: (item) => (
              <span className="op-versions__cell">
                <span>{targets.find((target) => target.id === item.targetId)?.name ?? item.targetId}</span>
                <span className="op-muted">{publicationTime(item.createdAt)}</span>
              </span>
            ),
          },
          { key: "delivery", title: "目标接收", render: (item) => <StatusBadge tone={deliveryTone[item.deliveryState]}>{transferProgress(item).delivery}</StatusBadge> },
          { key: "review", title: "目标审核", render: (item) => transferProgress(item).review },
          { key: "config", title: "目标配置", render: (item) => transferProgress(item).config },
          { key: "nodes", title: "节点", render: (item) => transferProgress(item, targets.find((target) => target.id === item.targetId)).observation },
          {
            key: "actions",
            title: "",
            width: 72,
            hideable: false,
            render: (item) => (
              <Button type="link" size="small" onClick={() => onOpen(item.id)}>
                详情
              </Button>
            ),
          },
        ]}
      />
    </>
  );
}
