import { Button } from "antd";
import JsonSchemaButton from "../JsonSchemaButton";
import ResponseAdapterEditor from "../ResponseAdapterEditor";
import SchemaEditor from "../SchemaEditor";
import { ConfigBlock, ConfigSection, IssueText } from "./ConfigSection";
import { parseSchema, stringify } from "./draftModel";
import type { ApiDraft } from "./useApiDraft";

/** 响应处理：怎样从提供方返回中取业务对象，公开的响应结构，以及公开示例。 */
export default function ResponseSection({ draft }: { draft: ApiDraft }) {
  const { sections } = draft;
  const response = parseSchema(sections.responseSchema);
  return (
    <ConfigSection id="response" title="响应处理" scope="对内 → 对外" description="先从提供方返回中取出业务数据（对内规则），再描述客户收到的结构（对外契约）。">
      <div data-field-path="/responseAdapter" tabIndex={-1} className="op-legacy-editor">
        <IssueText result={draft.currentValidation} path="/responseAdapter" />
        <ResponseAdapterEditor
          api={draft.api}
          apiId={draft.creation ? undefined : draft.definition.id}
          form={draft.adapter}
          sampleSource={draft.responseSample}
          schemaText={sections.responseSchema}
          onSchemaChange={(text) => draft.change("responseSchema", text)}
          onChange={draft.setAdapter}
        />
      </div>
      <div data-field-path="/responseSchema" tabIndex={-1}>
        <IssueText result={draft.currentValidation} path="/responseSchema" />
        <SchemaEditor
          api={draft.api}
          title="响应结构与示例"
          allowAdvanced={false}
          focusPath={draft.focusPath}
          text={sections.responseSchema}
          onStateChange={state => draft.editorState("response-fields", state)}
          onChange={(text) => draft.change("responseSchema", text)}
          generation={
            <JsonSchemaButton
              api={draft.api}
              onStateChange={(state) => draft.editorState("response", state)}
              schemaText={sections.responseSchema}
              adapter={draft.adapter}
              onApply={(value) => {
                draft.change("responseSchema", value.schemaText);
                if (value.adapter) draft.setAdapter(value.adapter);
              }}
            />
          }
        />
      </div>
      {sections.responseSchema && (
        <ConfigBlock
          title="公开业务响应示例"
          actions={
            <>
              <Button size="small" disabled={draft.candidate !== null} onClick={() => void draft.openExampleEditor()}>
                编辑 / 脱敏公开示例…
              </Button>
              {response?.example != null && (
                <Button size="small" onClick={() => draft.change("responseSchema", stringify({ ...response, example: null }))}>
                  清除示例
                </Button>
              )}
            </>
          }
        >
          {response?.example != null ? (
            <pre className="op-config-example">{stringify(response.example)}</pre>
          ) : (
            <p className="op-muted">尚未设置公开示例。可手工填写，或从成功的调试结果中选择公开片段。</p>
          )}
          <p className="op-muted">示例只包含业务 data，不包含统一响应外壳；保存后仍需发布才会对外生效。</p>
        </ConfigBlock>
      )}
    </ConfigSection>
  );
}
