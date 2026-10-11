import { PlusOutlined } from "@ant-design/icons";
import { FieldHelp } from "@cyl/open-platform-web-shared/ui/components";
import { Button } from "antd";
import { BindingEditor, MappingEditor } from "../BindingEditor";
import { requestPaths } from "../SchemaEditor";
import { stringify } from "./draftModel";
import { ConfigBlock, ConfigSection, IssueText } from "./ConfigSection";
import type { ApiDraft } from "./useApiDraft";

/**
 * 调用目标与映射（对内）：平台把调用转发到哪里（HTTP 地址 / Dubbo 接口），
 * 以及上方客户请求字段、平台身份或固定值如何放进内部请求（PATH / QUERY / BODY 或 Dubbo argN）。
 */
export default function TargetSection({ draft, canManageConnections }: { draft: ApiDraft; canManageConnections: boolean }) {
  const binding = draft.lastBinding;
  const mappings = draft.lastMappings;
  const http = binding.protocol === "HTTP";
  return (
    <ConfigSection
      id="target"
      title="调用目标与映射"
      scope="对内"
      description="平台收到调用后转发到哪里、参数怎么交给内部服务。这些信息只在平台内使用，不会出现在公开文档中。"
    >
      <div data-field-path="/binding" tabIndex={-1} className="op-legacy-editor">
        <IssueText result={draft.currentValidation} path="/binding" />
        <BindingEditor
          api={draft.api}
          canManageConnections={canManageConnections}
          value={binding}
          mappingCount={mappings.length}
          protectSignature={!draft.creation && draft.definition.protocol === "DUBBO"}
          onManualPendingChange={draft.setManualBindingPending}
          onRequestChange={draft.requestBindingChange}
          onChange={(value) => (value.protocol === "HTTP" ? draft.requestBindingChange(value) : draft.change("binding", stringify(value)))}
        />
      </div>
      <ConfigBlock
        path="/mappings"
        title={http ? "参数映射：放在内部请求的哪里" : "参数映射：内部方法参数"}
        help={
          <FieldHelp label={http ? "参数位置" : "Dubbo 参数映射"}>
            {http
              ? "把“请求参数”中的客户字段、平台验证的身份或固定值放进内部请求：路径变量放入 PATH；GET / DELETE 的字段放入 QUERY；POST / PUT / PATCH 默认放入 JSON 正文。"
              : "把“请求参数”中的客户字段、平台验证的身份或固定值交给 Java 方法参数：argN 按参数顺序从 arg0 开始；对象字段写作 argN.field。"}
          </FieldHelp>
        }
        actions={
          !http && (
            <Button
              size="small"
              icon={<PlusOutlined aria-hidden />}
              disabled={mappings.length >= 100}
              onClick={() => draft.change("mappings", stringify([...mappings, { target: "", source: "REQUEST", path: "" }]))}
            >
              添加映射
            </Button>
          )
        }
      >
        <p className="op-muted">取值来源是“客户请求字段”时，只能选上方“请求参数”里已定义的字段。</p>
        <IssueText result={draft.currentValidation} path="/mappings" />
        <div className="op-legacy-editor">
          <MappingEditor
            api={draft.api}
            mappings={mappings}
            binding={binding}
            paths={requestPaths(draft.lastRequest)}
            requestSchema={draft.lastRequest}
            onChange={(value) => draft.change("mappings", stringify(value))}
          />
        </div>
      </ConfigBlock>
    </ConfigSection>
  );
}
