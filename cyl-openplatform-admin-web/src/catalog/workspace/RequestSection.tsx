import { Select } from "antd";
import JsonSchemaButton from "../JsonSchemaButton";
import SchemaEditor from "../SchemaEditor";
import { ConfigBlock, ConfigSection, issuesAt, IssueText } from "./ConfigSection";
import { idempotencyCandidates } from "./mcpTool";
import type { ApiDraft } from "./useApiDraft";

/** 请求参数（对外）：客户调用时传哪些字段。字段怎么交给内部服务在“调用目标与映射”里配置。 */
export default function RequestSection({ draft }: { draft: ApiDraft }) {
  const { sections, lastBinding: binding } = draft;
  const candidates = idempotencyCandidates(draft.lastRequest);
  const selected = draft.idempotencyField.trim();
  const missing = selected !== "" && !candidates.includes(selected);
  const required = draft.mcpTool.enabled && draft.operationKind === "MUTATION";
  const issue = issuesAt(draft.currentValidation, "/idempotencyField")[0]?.message;
  return (
    <ConfigSection id="request" title="请求参数" scope="对外" description="客户调用时需要传哪些字段。这里只描述公开契约，会出现在接口文档中。">
      <div data-field-path="/requestSchema" tabIndex={-1}>
        <IssueText result={draft.currentValidation} path="/requestSchema" />
        <SchemaEditor
          api={draft.api}
          title="请求结构"
          allowAdvanced={false}
          request
          focusPath={draft.focusPath}
          text={sections.requestSchema}
          onStateChange={state => draft.editorState("request-fields", state)}
          onChange={(text) => draft.change("requestSchema", text)}
          mappings={draft.lastMappings}
          generation={
            <JsonSchemaButton
              api={draft.api}
              request
              onStateChange={(state) => draft.editorState("request", state)}
              schemaText={sections.requestSchema}
              mappingSource={{ binding, bindingText: sections.binding, mappingsText: sections.mappings }}
              onApply={(value) => {
                draft.change("requestSchema", value.schemaText);
                if (value.mappingsText !== undefined) draft.change("mappings", value.mappingsText);
              }}
            />
          }
        />
      </div>
      <ConfigBlock title="幂等字段" path="/idempotencyField">
        <div className="op-config-access">
          <Select
            aria-label="幂等字段"
            allowClear
            showSearch
            className="op-config-idempotency"
            status={issue || missing ? "error" : undefined}
            value={selected || undefined}
            placeholder={required ? "请选择业务唯一号字段" : "不配置"}
            notFoundContent="请求结构中没有可选的字符串或整数字段"
            options={[...(missing ? [selected] : []), ...candidates].map((path) => ({ value: path, label: path }))}
            onChange={(value?: string) => draft.setIdempotencyField(value ?? "")}
          />
          <span className="op-muted">
            {required ? "会修改数据的 API 开放为 MCP 工具时必须选择。" : "可选。"}
            选择请求中代表业务唯一号的字符串或整数字段；同一租户对此 API 重复提交相同值时，平台会拒绝重复执行。
          </span>
        </div>
        {missing && !issue && <div className="op-config-issue" role="alert">所选字段已不在请求结构中，请重新选择或清除。</div>}
        <IssueText result={draft.currentValidation} path="/idempotencyField" />
      </ConfigBlock>
    </ConfigSection>
  );
}
