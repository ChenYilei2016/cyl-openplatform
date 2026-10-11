import { FieldLabel, ReadonlyField } from "@cyl/open-platform-web-shared/ui/components";
import { Checkbox, Form, Input, Radio } from "antd";
import { useState } from "react";
import { CatalogScopes } from "../CatalogPanel";
import { CategoryPicker, OwnerPicker } from "../CatalogReferenceFields";
import { ConfigBlock, ConfigSection, issuesAt, IssueText } from "./ConfigSection";
import type { DraftMetadata, OperationKind } from "./draftModel";
import { operationKindNames } from "./mcpTool";
import type { ApiDraft } from "./useApiDraft";

const lockReason = "调用地址创建后固定；需要新路径或新版本时，请新建 API。";
type IdentityKey = "service" | "method" | "version";
/** 尚未创建的草稿可编辑调用标识；规则与服务端一致，失焦后才提示。 */
const identityFields: { key: IdentityKey; label: string; placeholder: string; maxLength: number; pattern: RegExp; rule: string; help: string }[] = [
  { key: "service", label: "服务标识", placeholder: "如：order", maxLength: 64, pattern: /^[a-z][a-z0-9_]{0,63}$/, rule: "小写字母开头，只含小写字母、数字和下划线", help: "同类业务的英文名称，如 order；会出现在调用地址中，创建后不能改。" },
  { key: "method", label: "操作标识", placeholder: "如：get", maxLength: 64, pattern: /^[a-z][a-z0-9_]{0,63}$/, rule: "小写字母开头，只含小写字母、数字和下划线", help: "该接口的英文动作，如 get 或 query_detail；与服务标识、外部版本共同定位 API。" },
  { key: "version", label: "外部版本", placeholder: "如：1.0", maxLength: 32, pattern: /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/, rule: "字母或数字开头，只含字母、数字、点、下划线和短横线", help: "客户看到的契约版本，如 1.0；与内部 Dubbo 服务版本分开。" },
];

/** 基本信息：名称、分类、负责人、调用标识（已创建时锁定）、调用身份与权限组（维护声明在“版本与生命周期”页签）。 */
export default function BasicSection({ draft }: { draft: ApiDraft }) {
  const { api, metadata, currentValidation: result } = draft;
  const status = (path: string) => (issuesAt(result, path).length ? "error" : undefined);
  const help = (path: string) => issuesAt(result, path)[0]?.message;
  return (
    <ConfigSection
      id="basic"
      title="基本信息"
      description={draft.creation ? "客户在文档中看到的名称与归属；调用标识创建后锁定，请在此核对。" : "客户在文档中看到的名称与归属；调用标识创建后锁定。"}
    >
      <Form layout="vertical" component={false}>
        <div className="op-config-grid">
          <Form.Item label="接口名称" htmlFor="config-name" required validateStatus={status("/name")} help={help("/name")}>
            <div data-field-path="/name">
            <Input
              id="config-name"
              maxLength={100}
              placeholder="如：查询订单详情"
              value={metadata.name}
              status={status("/name")}
              onChange={(event) => draft.updateMetadata("name", event.target.value)}
            />
            </div>
          </Form.Item>
          <Form.Item label="展示分类" htmlFor="config-category" required validateStatus={status("/category")} help={help("/category")}>
            <div data-field-path="/category">
            <CategoryPicker api={api} hideLabel id="config-category" status={status("/category")} value={metadata.category} onChange={(value) => draft.updateMetadata("category", value)} />
            </div>
          </Form.Item>
          <Form.Item label="负责人" htmlFor="config-owner" required validateStatus={status("/owner")} help={help("/owner")}>
            <div data-field-path="/owner">
            <OwnerPicker
              api={api}
              hideLabel
              id="config-owner"
              status={status("/owner")}
              value={metadata.owner}
              onDefault={draft.defaultOwner}
              onChange={(value) => draft.updateMetadata("owner", value)}
            />
            </div>
          </Form.Item>
          {draft.creation ? (
            <EditableIdentity metadata={metadata} serverIssue={help} onChange={(key, value) => draft.updateMetadata(key, value)} />
          ) : (
            <div className="op-config-identity" data-field-path="/service">
              <ReadonlyField label="service" value={metadata.service} code reason={lockReason} />
              <ReadonlyField label="method" value={metadata.method} code reason={lockReason} />
              <ReadonlyField label="外部版本" value={metadata.version} code reason={lockReason} />
            </div>
          )}
        </div>
        {!draft.creation && (
          <>
            <IssueText result={result} path="/service" />
            <IssueText result={result} path="/method" />
            <IssueText result={result} path="/version" />
          </>
        )}
      </Form>
      <ConfigBlock title="调用性质" path="/operationKind">
        <div className="op-config-access">
          <Radio.Group
            aria-label="调用性质"
            value={draft.operationKind}
            onChange={(event) => draft.setOperationKind(event.target.value as OperationKind)}
            options={(["QUERY", "MUTATION"] as const).map((value) => ({ value, label: operationKindNames[value] }))}
          />
          <span className="op-muted">
            {draft.operationKind === "QUERY" ? "只读取数据，重复调用不产生副作用。" : "会新增、修改或删除数据；未标注的 API 默认按此处理。"}
          </span>
        </div>
        <IssueText result={result} path="/operationKind" />
      </ConfigBlock>
      <ConfigBlock title="谁可以调用" path="/scopeCodes">
        <div className="op-config-access">
          <Checkbox
            checked={draft.employeeRequired}
            onChange={(event) => draft.setEmployeeRequired(event.target.checked)}
          >
            必须指定调用员工
          </Checkbox>
          <span className="op-muted">{draft.employeeRequired ? "仅允许携带有效员工身份的调用。" : "未开启时，租户级 Token 也可调用。"}</span>
        </div>
        <IssueText result={result} path="/scopeCodes" />
        <CatalogScopes api={api} codes={draft.codes} onChange={draft.setCodes} disabled={draft.busy || draft.locked} />
      </ConfigBlock>
    </ConfigSection>
  );
}

function EditableIdentity({ metadata, serverIssue, onChange }: { metadata: DraftMetadata; serverIssue: (path: string) => string | undefined; onChange: (key: IdentityKey, value: string) => void }) {
  const [touched, setTouched] = useState<Partial<Record<IdentityKey, boolean>>>({});
  return (
    <div className="op-config-identity op-config-identity--editable">
      {identityFields.map((field) => {
        const value = metadata[field.key];
        const local = touched[field.key] && value.trim() && !field.pattern.test(value.trim()) ? field.rule : undefined;
        const message = serverIssue(`/${field.key}`) ?? local;
        return (
          // 标签不用 <label> 包住帮助按钮，避免按钮也被当作同名字段。
          <Form.Item key={field.key} validateStatus={message ? "error" : undefined} help={message}>
            <div className="op-config-identity__field" data-field-path={`/${field.key}`}>
              <FieldLabel label={field.label} help={field.help} required />
              <Input
                id={`config-${field.key}`}
                aria-label={field.label}
                aria-required
                className="op-config-identity__input"
                maxLength={field.maxLength}
                placeholder={field.placeholder}
                value={value}
                status={message ? "error" : undefined}
                onBlur={() => setTouched((current) => ({ ...current, [field.key]: true }))}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            </div>
          </Form.Item>
        );
      })}
    </div>
  );
}
