import { ReadonlyField } from "@cyl/open-platform-web-shared/ui/components";
import { Alert, Button, Form, Input, Switch } from "antd";
import { ConfigBlock, ConfigSection, issuesAt, IssueText } from "./ConfigSection";
import { MCP_AI_DESCRIPTION_LIMIT, mcpToolBlockers, mcpToolName, operationKindNames } from "./mcpTool";
import type { ApiDraft } from "./useApiDraft";

/** MCP 工具：开关、面向 AI 的用途说明与工具名预览；不满足启用条件时就地说明原因（119）。 */
export default function McpSection({ draft }: { draft: ApiDraft }) {
  const { metadata, mcpTool } = draft;
  const toolName = mcpToolName(metadata.service, metadata.method, metadata.version);
  const blockers = mcpToolBlockers(draft.content);
  const aiIssue = issuesAt(draft.currentValidation, "/mcpTool/aiDescription")[0]?.message;
  return (
    <ConfigSection id="mcp" title="MCP 配置（可选）" description="按需开放为 AI 可调用的工具，配置随 API 发布后生效。">
      <ConfigBlock title="工具开放" path="/mcpTool">
        <div className="op-config-access">
          <Switch id="config-mcp-enabled" checked={mcpTool.enabled} onChange={(enabled) => draft.updateMcpTool({ enabled })} />
          <label htmlFor="config-mcp-enabled">可作为 MCP 工具</label>
          <span className="op-muted">发布后，MCP 网关可发现并装载此工具；参数与返回结构由 API 契约推导。</span>
        </div>
        {mcpTool.enabled && (
          <>
            {blockers.length > 0 && (
              <Alert
                type="warning"
                showIcon
                title="还不能作为 MCP 工具发布"
                description={
                  <ul className="op-config-mcp__reasons">
                    {blockers.map((blocker) => (
                      <li key={blocker.message}>
                        {blocker.message}
                        {blocker.path === "/idempotencyField" && (
                          <Button type="link" size="small" onClick={() => draft.locate("/idempotencyField")}>
                            去选择
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                }
              />
            )}
            <Form layout="vertical" component={false}>
              <Form.Item label="面向 AI 的用途说明" htmlFor="config-mcp-description" validateStatus={aiIssue ? "error" : undefined} help={aiIssue}>
                <div data-field-path="/mcpTool/aiDescription">
                  <Input.TextArea
                    id="config-mcp-description"
                    rows={2}
                    maxLength={MCP_AI_DESCRIPTION_LIMIT}
                    showCount
                    value={mcpTool.aiDescription}
                    placeholder="告诉 AI 何时使用此工具，如：按订单号查询当前租户的订单状态。不填时使用接口说明。"
                    onChange={(event) => draft.updateMcpTool({ aiDescription: event.target.value })}
                  />
                </div>
              </Form.Item>
            </Form>
            <ReadonlyField
              label="工具名"
              code
              value={toolName ?? "无法生成"}
              reason="由 service、method 与外部版本生成（版本中的 . 和 - 转为 _），创建后不变；同一操作的不同版本是独立工具。"
            />
          </>
        )}
        <IssueText result={draft.currentValidation} path="/mcpTool/enabled" />
      </ConfigBlock>
      <ConfigBlock title="调用约束">
        <div className="op-config-access">
          <span>调用性质：{operationKindNames[draft.operationKind]}</span>
          <Button type="link" size="small" onClick={() => draft.locate("/operationKind")}>修改调用性质</Button>
        </div>
        <div className="op-config-access">
          <span>幂等字段：{draft.idempotencyField || "未配置"}</span>
          <Button type="link" size="small" onClick={() => draft.locate("/idempotencyField")}>配置幂等字段</Button>
        </div>
        <p className="op-muted">这两项属于 API 通用配置，普通 Token、签名和 MCP 调用共同遵循。</p>
      </ConfigBlock>
    </ConfigSection>
  );
}
