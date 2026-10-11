import { Alert } from "antd";
import { useMemo, type ReactNode } from "react";
import type { AdminApi } from "../access/api";
import type { ApiDefinition } from "../catalog/CatalogPanel";
import CreateWorkspace from "../catalog/workspace/CreateWorkspace";
import { placeholderDefinition } from "../catalog/workspace/draftModel";

/**
 * 补齐一个导入候选：与 API 配置页同一套分区与检查面板；确认只做只读校验，
 * 把完整正文交回导入批次（onPrepared），不创建草稿。
 */
export default function CandidateEditor({
  api,
  initial,
  title,
  description,
  reminders = [],
  backLabel,
  onCancel,
  onPrepared,
}: {
  api: AdminApi;
  initial: Partial<ApiDefinition>;
  title: ReactNode;
  description?: ReactNode;
  /** 来源转换的阻断与提醒，逐条列出。 */
  reminders?: string[];
  backLabel: string;
  onCancel: () => void;
  onPrepared: (bodyText: string) => boolean | void | Promise<boolean | void>;
}) {
  const definition = useMemo(() => placeholderDefinition(initial), [initial]);
  const creation = useMemo(() => ({ kind: "candidate" as const, onPrepared }), [onPrepared]);
  return (
    <CreateWorkspace
      api={api}
      definition={definition}
      creation={creation}
      breadcrumb={<>导入 API / 补齐候选</>}
      backAction={{ label: backLabel, onClick: onCancel }}
      context={
        <Alert
          type={reminders.length ? "warning" : "info"}
          showIcon
          title={title}
          description={
            <>
              {description && <p className="op-create__hint">{description}</p>}
              {reminders.length > 0 && (
                <ul className="op-create__list" aria-label="来源转换提醒">
                  {reminders.map((reminder, index) => (
                    <li key={index}>{reminder}</li>
                  ))}
                </ul>
              )}
            </>
          }
        />
      }
    />
  );
}
