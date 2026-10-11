import { RobotOutlined } from "@ant-design/icons";

/** 标记当前发布版本支持MCP，不代表当前租户已经开通。 */
export default function McpBadge() {
  return <span className="op-doc-mcp-badge" aria-label="支持 MCP" title="当前发布版本支持通过MCP 网关调用"><RobotOutlined aria-hidden /> MCP</span>;
}
