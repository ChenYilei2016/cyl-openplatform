import { DeleteOutlined, EyeOutlined, PlusOutlined } from "@ant-design/icons";
import SchemaView from "@cyl/open-platform-web-shared/documentation/SchemaView";
import type { ApiDocument, SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import { Alert, Button, Drawer, Form, Input } from "antd";
import { useState } from "react";
import { ConfigBlock, ConfigSection, issuesAt, IssueText } from "./ConfigSection";
import { errorsShape, parseSchema, stringify, tryParse } from "./draftModel";
import type { ApiDraft } from "./useApiDraft";

type ErrorItem = { code: string; message: string };

/** 文档与错误：接口说明、结构说明、错误码，以及草稿文档预览。 */
export default function DocSection({ draft }: { draft: ApiDraft }) {
  const { metadata, sections } = draft;
  const errors = tryParse(sections.errorDefinitions, errorsShape) ?? [];
  const setErrors = (next: ErrorItem[]) => draft.change("errorDefinitions", stringify(next));
  const [preview, setPreview] = useState<ApiDocument | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const descriptionIssue = issuesAt(draft.currentValidation, "/description")[0]?.message;
  const openPreview = async () => {
    draft.setError("");
    setPreviewing(true);
    try {
      const [requestSchema, responseSchema, errorDefinitions] = await Promise.all([
        draft.api<SchemaNode>("/apis/validate-json?kind=schema&request=true", { method: "POST", bodyText: sections.requestSchema }),
        draft.api<SchemaNode>("/apis/validate-json?kind=schema&request=false", { method: "POST", bodyText: sections.responseSchema }),
        draft.api<ErrorItem[]>("/apis/validate-json", { method: "POST", bodyText: sections.errorDefinitions }),
      ]);
      if (
        !Array.isArray(errorDefinitions) ||
        errorDefinitions.length > 50 ||
        errorDefinitions.some((item) => !item || typeof item.code !== "string" || !item.code.trim() || item.code.length > 64 || typeof item.message !== "string" || !item.message.trim() || item.message.length > 500) ||
        new Set(errorDefinitions.map((item) => item.code)).size !== errorDefinitions.length
      )
        throw new Error("请先补全错误码与对外说明。");
      setPreview({
        id: draft.definition.id,
        draftRevision: draft.definition.draftRevision,
        title: metadata.name,
        description: metadata.description,
        path: `/api/oauth/${metadata.service}/${metadata.version}/${metadata.method}`,
        httpMethod: "POST",
        scopeCodes: draft.codes,
        employeeRequired: draft.employeeRequired,
        requestSchema,
        responseSchema,
        errorDefinitions:
          draft.adapter.mode === "ENVELOPE"
            ? [...errorDefinitions.filter((item) => item.code !== "50200002"), { code: "50200002", message: "提供方业务拒绝；HTTP 502，data为null" }]
            : errorDefinitions,
        requestExample: requestSchema.example,
        responseExample: responseSchema.example,
        lifecycle: draft.lifecycle,
      });
    } catch (failure) {
      draft.setError((failure as Error).message);
    } finally {
      setPreviewing(false);
    }
  };
  return (
    <ConfigSection
      id="doc"
      scope="对外"
      title="文档与错误"
      description="让接入方照着文档就能调用：说明用途、结构含义和常见错误。"
      actions={
        <Button icon={<EyeOutlined aria-hidden />} loading={previewing} onClick={() => void openPreview()}>
          预览草稿文档
        </Button>
      }
    >
      <Form layout="vertical" component={false}>
        <Form.Item label="接口说明" htmlFor="config-description" validateStatus={descriptionIssue ? "error" : undefined} help={descriptionIssue}>
          <div data-field-path="/description">
            <Input.TextArea
              id="config-description"
              rows={4}
              maxLength={5000}
              showCount
              value={metadata.description}
              placeholder="如：根据订单号查询当前租户可访问的订单，适用于售后核对；只能查看已授权的数据。"
              onChange={(event) => draft.updateMetadata("description", event.target.value)}
            />
          </div>
        </Form.Item>
        <div className="op-config-grid">
          {(["requestSchema", "responseSchema"] as const).map((key) => {
            const schema = parseSchema(sections[key]);
            const label = key === "requestSchema" ? "请求结构说明" : "响应结构说明";
            return (
              <Form.Item key={key} label={label} htmlFor={`config-${key}-description`} extra={!schema ? "先在上方确定结构类型，再填写说明。" : undefined}>
                <Input.TextArea
                  id={`config-${key}-description`}
                  rows={2}
                  maxLength={500}
                  disabled={!schema}
                  value={schema?.description ?? ""}
                  placeholder={key === "requestSchema" ? "例如：传入需要查询的订单号，格式见字段示例。" : "例如：返回订单号与当前状态；订单不存在时返回 ORDER_NOT_FOUND。"}
                  onChange={(event) => draft.changeRootDescription(key, event.target.value)}
                />
              </Form.Item>
            );
          })}
        </div>
      </Form>
      <ConfigBlock
        path="/errorDefinitions"
        title="错误说明"
        actions={
          <Button size="small" icon={<PlusOutlined aria-hidden />} disabled={errors.length >= 50} onClick={() => setErrors([...errors, { code: "", message: "" }])}>
            添加错误码
          </Button>
        }
      >
        <IssueText result={draft.currentValidation} path="/errorDefinitions" />
        {errors.length ? (
          <div className="op-error-table" role="table" aria-label="错误说明">
            <div className="op-error-table__head" role="row">
              <span role="columnheader">错误码</span>
              <span role="columnheader">对外说明</span>
              <span role="columnheader" className="op-visually-hidden">
                操作
              </span>
            </div>
            {errors.map((item, index) => (
              <div key={index} className="op-error-table__row" role="row">
                <Input
                  aria-label={`错误码${index + 1}`}
                  maxLength={64}
                  value={item.code}
                  placeholder="ORDER_NOT_FOUND"
                  onChange={(event) => setErrors(errors.map((current, position) => (position === index ? { ...current, code: event.target.value } : current)))}
                />
                <Input
                  aria-label={`错误说明${index + 1}`}
                  maxLength={500}
                  value={item.message}
                  placeholder="订单不存在或不可访问，请核对订单号与授权范围"
                  onChange={(event) => setErrors(errors.map((current, position) => (position === index ? { ...current, message: event.target.value } : current)))}
                />
                <Button type="text" danger icon={<DeleteOutlined aria-hidden />} aria-label={`移除错误码${index + 1}`} onClick={() => setErrors(errors.filter((_, position) => position !== index))} />
              </div>
            ))}
          </div>
        ) : (
          <p className="op-muted">尚未声明业务错误。平台通用错误（鉴权、限流等）会自动出现在文档中。</p>
        )}
      </ConfigBlock>
      <Drawer open={preview !== null} onClose={() => setPreview(null)} size={720} title="草稿文档预览 · 未生效" destroyOnHidden>
        {preview && (
          <div className="op-doc-preview">
            <h2>{preview.title}</h2>
            <p className="op-muted">
              外部版本 {metadata.version} · {metadata.category}
            </p>
            {preview.description && <p className="op-doc-preview__text">{preview.description}</p>}
            <pre className="op-config-example">POST {preview.path}</pre>
            <p className="op-muted">HMAC 签名路径为 {preview.path.replace("/api/oauth/", "/api/sign/")}；凭据与可信租户 / 人员身份由平台校验。</p>
            {preview.requestSchema.description && <p>{preview.requestSchema.description}</p>}
            <SchemaView title="请求" schema={preview.requestSchema} />
            {preview.responseSchema.description && <p>{preview.responseSchema.description}</p>}
            <SchemaView title="响应" schema={preview.responseSchema} />
            {preview.responseExample != null && <pre className="op-config-example">{stringify(preview.responseExample)}</pre>}
            <h3>错误说明</h3>
            {preview.errorDefinitions.length ? (
              preview.errorDefinitions.map((item, index) => (
                <p key={index}>
                  {item.code}：{item.message}
                </p>
              ))
            ) : (
              <p className="op-muted">尚未声明业务错误。</p>
            )}
            <p className="op-muted">当前输入预览（含未保存修改，不会对外生效），不输出内部绑定、映射或凭据。</p>
          </div>
        )}
      </Drawer>
    </ConfigSection>
  );
}
