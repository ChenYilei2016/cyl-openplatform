import SchemaView from "@cyl/open-platform-web-shared/documentation/SchemaView";
import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { Descriptions, Table } from "antd";
import type { ReactNode } from "react";
import type { ApiDefinition } from "../catalog/CatalogPanel";
import { publicationFieldNames, publicationFields, type PublicationField } from "./PublicationDiff";
import { publicationDisplay } from "./publicationDisplay";
import { operationKindNames } from "../catalog/workspace/mcpTool";
import "./release-review.css";

/** 阅读顺序：先认出接口，再看调用要求、内部绑定与返回；分组沿用差异视图的业务分组。 */
const order: PublicationField[] = ["name", "service", "version", "method", "category", "owner", "description", "operationKind", "employeeRequired", "scopeCodes", "requestSchema", "idempotencyField", "protocol", "binding", "mappings", "responseAdapter", "responseSchema", "errorDefinitions", "mcpTool", "lifecycle"];
const schemaKeys = new Set<PublicationField>(["requestSchema", "responseSchema"]);

const isRawJson = (value: unknown) => (JSON as typeof JSON & { isRawJSON?: (value: unknown) => boolean }).isRawJSON?.(value) === true;
const isContainer = (value: unknown): value is Record<string, unknown> | unknown[] => value !== null && typeof value === "object" && !isRawJson(value);
const label = (key: string) => publicationFieldNames[key] ?? key;

function Scalar({ value }: { value: unknown }) {
  if (value === undefined || value === null) return <span className="op-muted">未设置</span>;
  if (typeof value === "string") return value ? <span className="op-snapshot__text">{value}</span> : <span className="op-muted">空字符串</span>;
  if (typeof value === "boolean") return <>{value ? "是" : "否"}</>;
  return <span className="op-code">{stringifyJson(value)}</span>;
}

/** 任意配置值：标量直接显示，同构对象数组成表，对象成键值对；无法归类的嵌套才回落为 JSON。 */
function Value({ value }: { value: unknown }): ReactNode {
  if (!isContainer(value)) return <Scalar value={value} />;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="op-muted">无</span>;
    if (value.every((item) => !isContainer(item)))
      return (
        <span className="op-snapshot__list">
          {value.map((item, index) => (
            <span key={index} className="op-code">
              {typeof item === "string" ? item : stringifyJson(item)}
            </span>
          ))}
        </span>
      );
    if (value.every((item) => isContainer(item) && !Array.isArray(item))) {
      const rows = value as Record<string, unknown>[];
      const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      return (
        <Table<{ row: Record<string, unknown>; index: number }>
          size="small"
          pagination={false}
          rowKey="index"
          dataSource={rows.map((row, index) => ({ row, index }))}
          columns={keys.map((key) => ({ key, title: label(key), render: (_: unknown, item) => <Value value={item.row[key]} /> }))}
        />
      );
    }
    return <pre className="op-snapshot__json">{stringifyJson(value, 2)}</pre>;
  }
  const entries = Object.entries(value);
  if (!entries.length) return <span className="op-muted">无</span>;
  return (
    <dl className="op-snapshot__pairs">
      {entries.map(([key, entry]) => (
        <div key={key}>
          <dt>{label(key)}</dt>
          <dd>
            <Value value={entry} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function fieldValue(key: PublicationField, value: unknown) {
  if (key === "employeeRequired") return value === true ? "开启：必须有完整有效人员委托" : "关闭：允许租户级或人员级调用";
  if (key === "operationKind") return operationKindNames[value === "QUERY" ? "QUERY" : "MUTATION"];
  if (key === "idempotencyField") return value ? <span className="op-code">{String(value)}</span> : <span className="op-muted">未配置</span>;
  if (key === "mcpTool") {
    const tool = value as { enabled?: boolean; aiDescription?: string | null } | undefined;
    if (!tool?.enabled) return <span className="op-muted">未开放</span>;
    return tool.aiDescription ? <span className="op-snapshot__text">已开放 · {tool.aiDescription}</span> : "已开放 · 用途说明沿用接口说明";
  }
  if (key === "description") return value ? <span className="op-snapshot__text">{String(value)}</span> : <span className="op-muted">未填写</span>;
  return <Value value={value} />;
}

/** 固定发布快照按业务字段分区阅读（敏感值已隐藏）；原始 JSON 由调用方作为“查看原文”折叠保留。 */
export default function SnapshotView({ definition }: { definition: ApiDefinition }) {
  const safe = publicationDisplay(definition) as unknown as Record<PublicationField, unknown>;
  const groups = [...new Set(order.map((key) => publicationFields[key][0]))];
  return (
    <div className="op-snapshot">
      {groups.map((group) => {
        const keys = order.filter((key) => publicationFields[key][0] === group && (["employeeRequired", "operationKind", "idempotencyField", "mcpTool"].includes(key) || safe[key] !== undefined));
        if (!keys.length) return null;
        const plain = keys.filter((key) => !schemaKeys.has(key));
        return (
          <section key={group} className="op-snapshot__group" aria-label={group}>
            <h4>{group}</h4>
            {plain.length > 0 && (
              <Descriptions
                size="small"
                bordered
                column={1}
                items={plain.map((key) => ({ key, label: publicationFields[key][1], children: fieldValue(key, safe[key]) }))}
              />
            )}
            {keys
              .filter((key) => schemaKeys.has(key))
              .map((key) => (
                <SchemaView key={key} title={publicationFields[key][1]} schema={safe[key] as SchemaNode} showRawSchema={false} />
              ))}
          </section>
        );
      })}
    </div>
  );
}
