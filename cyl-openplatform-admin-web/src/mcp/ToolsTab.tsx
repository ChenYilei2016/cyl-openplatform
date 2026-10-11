import { ReloadOutlined } from "@ant-design/icons";
import { EmptyState, IdText, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, type DataTableColumn } from "@cyl/open-platform-web-shared/ui/list";
import { useRead } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Button, Checkbox, Space } from "antd";
import { useState } from "react";
import type { AdminApi } from "../access/api";
import type { McpTool, McpToolPage } from "./model";

/** 同一个分页目录既用于浏览，也用于工具集选择；每次只取100条，不在浏览器全量拉取。 */
export default function ToolsTab({ api, selected, onSelect, disabled = false, revision = 0 }: { api: AdminApi; selected?: string[]; onSelect?: (tool: McpTool, included: boolean) => void; disabled?: boolean; revision?: number }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1];
  const list = useRead<McpToolPage>(api, `/mcp/tools${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, revision);
  const columns: DataTableColumn<McpTool>[] = [
    ...(onSelect ? [{ key: "select", title: "选择", width: 60, hideable: false, render: (tool: McpTool) =>
      <Checkbox aria-label={`选择 ${tool.title}`} checked={selected?.includes(tool.apiId)}
        disabled={disabled || !selected?.includes(tool.apiId) && (selected?.length ?? 0) >= 200}
        onChange={event => onSelect(tool, event.target.checked)} /> }] : []),
    { key: "name", title: "工具", hideable: false, render: tool => <div><strong>{tool.title}</strong><div className="op-cell-sub"><IdText value={tool.name} maxChars={40} /></div></div> },
    { key: "kind", title: "调用性质", width: 125, render: tool => <StatusBadge tone={tool.operationKind === "QUERY" ? "neutral" : "warning"}>{tool.operationKind === "QUERY" ? "查询" : "会修改数据"}</StatusBadge> },
    ...(!onSelect ? [
      { key: "description", title: "用途", render: (tool: McpTool) => tool.description },
      { key: "sets", title: "所属工具集", render: (tool: McpTool) => tool.toolSets.length ? <div>{tool.toolSets.map(set => <div key={set.code}>{set.name}{!set.enabled && <span className="op-muted">（停用）</span>}</div>)}{tool.toolSets[0].total > 3 && <span className="op-cell-sub">共 {tool.toolSets[0].total} 个工具集</span>}</div> : <span className="op-muted">仅总地址</span> },
    ] : []),
    { key: "scopes", title: "权限组", render: tool => <span className="op-code">{tool.scopeCodes.join("、")}</span> },
  ];
  return <section className="mcp-tools" aria-label={onSelect ? "选择工具集成员" : "已发布的MCP工具"}>
    <div className="mcp-section__head">
      <p className="mcp-section__intro">{onSelect ? "选择已发布工具，每个工具集最多200项。工具后续停用会自动停止在此地址暴露。" : "这里展示当前已发布、可用的工具。工具配置随 API 发布生效，租户调用时仍需满足开通和权限要求。"}</p>
      <Button icon={<ReloadOutlined />} aria-label="刷新MCP工具" onClick={list.reload} />
    </div>
    <DataTable caption="MCP工具目录" rowKey={tool => tool.apiId} data={list.data?.items ?? []} columns={columns} loading={list.loading}
      empty={list.error ? <EmptyState kind="error" title="工具目录读取失败" description={list.error} action={<Button onClick={list.reload}>重试</Button>} />
        : <EmptyState title="暂无已发布的MCP工具" description="在API配置中开启MCP工具并发布后，会显示在这里。" />} />
    <Space className="mcp-page-controls">
      <Button disabled={cursors.length === 1 || list.loading} onClick={() => setCursors(value => value.slice(0, -1))}>上一页</Button>
      <span className="op-muted">第 {cursors.length} 页 · 每页最多100项</span>
      <Button disabled={!list.data?.nextCursor || list.loading} onClick={() => setCursors(value => [...value, list.data!.nextCursor])}>下一页</Button>
    </Space>
  </section>;
}
