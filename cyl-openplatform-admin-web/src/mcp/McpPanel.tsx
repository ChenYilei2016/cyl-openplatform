import { PageHeader } from "@cyl/open-platform-web-shared/ui/components";
import { Tabs } from "antd";
import { useState } from "react";
import type { AdminApi } from "../access/api";
import "../access/credentials.css";
import { useListQuery } from "../navigation/useListQuery";
import GatewayCredentialTab from "./GatewayCredentialTab";
import TenantActivationsTab from "./TenantActivationsTab";
import ToolsTab from "./ToolsTab";
import ToolSetsTab from "./ToolSetsTab";
import "./mcp.css";

/** 页签保存在地址 `filter.mcp.tab`。 */
const tabs = [
  { key: "gateway", label: "网关凭据" },
  { key: "tenants", label: "租户开通" },
  { key: "tools", label: "工具" },
  { key: "sets", label: "工具集" },
] as const;

/** MCP 接入：统一管理网关凭据、租户开通、工具目录与分类地址。 */
export default function McpPanel({ api }: { api: AdminApi }) {
  const [toolRevision, setToolRevision] = useState(0);
  const query = useListQuery({ namespace: "mcp", defaults: { tab: "gateway" } });
  const active = tabs.some((tab) => tab.key === query.filters.tab) ? query.filters.tab : "gateway";
  return (
    <section className="mcp-page" aria-labelledby="mcp-title">
      <PageHeader
        title={<span id="mcp-title">MCP 接入</span>}
        meta="MCP 网关装载开放平台并对客提供；网关凭据证明调用来自网关，租户开通决定哪些租户可以使用。"
      />
      <Tabs
        className="mcp-page__tabs"
        activeKey={active}
        onChange={(key) => query.setFilter("tab", key)}
        items={[
          { key: "gateway", label: tabs[0].label, children: <GatewayCredentialTab api={api} /> },
          { key: "tenants", label: tabs[1].label, children: <TenantActivationsTab api={api} /> },
          { key: "tools", label: "工具", children: <ToolsTab api={api} revision={toolRevision} /> },
          { key: "sets", label: "工具集", children: <ToolSetsTab api={api} onChanged={() => setToolRevision(value => value + 1)} /> },
        ]}
      />
    </section>
  );
}
