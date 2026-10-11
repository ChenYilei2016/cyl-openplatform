import { Alert, Form, Input, Modal, Radio } from "antd";
import { useEffect, useState } from "react";
import { LoadFeedback } from "@cyl/open-platform-web-shared/components";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { defaultLifecycle } from "@cyl/open-platform-web-shared/lifecycle";
import { PersonTag } from "@cyl/open-platform-web-shared/ui/components";
import type { AdminApi } from "../../access/api";
import type { ApiDefinition, ApiSummary } from "../CatalogPanel";
import "./quick-create.css";

export interface ApiCopyPreview {
  sourceApiId: string;
  sourceKind: "DRAFT" | "EFFECTIVE";
  sourceRevision: number;
  sourceReleaseId?: string | null;
  snapshot: ApiDefinition;
  warnings: string[];
}
export interface ApiCopyDraft extends ApiCopyPreview {
  initialDefinition: ApiDefinition;
}

const identityFields = [
  { key: "name", label: "新接口名称", maxLength: 100, pattern: undefined },
  { key: "service", label: "新服务标识", maxLength: 64, pattern: "[a-z][a-z0-9_]{0,63}" },
  { key: "version", label: "新外部版本", maxLength: 32, pattern: "[a-zA-Z0-9][a-zA-Z0-9._\\-]{0,31}" },
  { key: "method", label: "新操作标识", maxLength: 64, pattern: "[a-z][a-z0-9_]{0,63}" },
] as const;

/** 复制为新 API：固定来源快照（已保存草稿或生效快照），填写新的调用标识后进入新建工作区；此时尚未创建。 */
export default function ApiCopyDialog({
  api,
  source,
  onClose,
  onConfirm,
}: {
  api: AdminApi;
  source: ApiSummary;
  onClose: () => void;
  onConfirm: (draft: ApiCopyDraft) => void;
}) {
  const [kind, setKind] = useState<"DRAFT" | "EFFECTIVE">("DRAFT");
  const [preview, setPreview] = useState<ApiCopyPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [identity, setIdentity] = useState({
    name: `${source.name}（副本）`,
    service: source.service,
    version: source.version,
    method: source.method,
  });
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);
    setError("");
    setLoading(true);
    void api<ApiCopyPreview>("/api-copies/preview", {
      method: "POST",
      body: {
        sourceApiId: source.id,
        sourceKind: kind,
      },
      signal: controller.signal,
    })
      .then((value) => {
        if (
          !value?.snapshot ||
          value.sourceApiId !== source.id ||
          value.sourceKind !== kind
        )
          throw new Error("复制来源快照不完整，请重试。");
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, source.id, kind, retry]);
  const changed =
    preview &&
    (["service", "version", "method"] as const).some(
      (key) => identity[key].trim() !== preview.snapshot[key],
    );
  const valid = identityFields.every((field) => {
    const value = identity[field.key].trim();
    return value && (!field.pattern || new RegExp(`^${field.pattern}$`).test(value));
  });
  const confirm = () => {
    if (!preview || !changed || !valid) return;
    const snapshot = preview.snapshot;
    // 只将契约字段交给新建工作区；运行状态和历史引用不随来源传递。
    const initialDefinition: ApiDefinition = {
      id: "",
      draftRevision: 0,
      ...identity,
      owner: snapshot.owner,
      category: snapshot.category,
      description: snapshot.description,
      protocol: snapshot.protocol,
      scopeCodes: snapshot.scopeCodes,
      employeeRequired: snapshot.employeeRequired === true,
      operationKind: snapshot.operationKind,
      idempotencyField: snapshot.idempotencyField,
      mcpTool: snapshot.mcpTool,
      requestSchema: snapshot.requestSchema,
      responseSchema: snapshot.responseSchema,
      responseAdapter: snapshot.responseAdapter,
      binding: snapshot.binding,
      mappings: snapshot.mappings,
      errorDefinitions: snapshot.errorDefinitions,
      lifecycle: { ...defaultLifecycle },
    };
    onConfirm({ ...preview, initialDefinition });
  };
  return (
    <Modal
      open
      width={720}
      title={`复制为新 API · ${source.name}`}
      okText="确认并进入新建工作区"
      cancelText="取消"
      cancelButtonProps={{ autoInsertSpace: false }}
      okButtonProps={{ disabled: loading || !preview || !changed || !valid }}
      onOk={confirm}
      onCancel={onClose}
      closable={{ "aria-label": "关闭复制窗口" }}
    >
      <div className="op-copy-dialog">
        <Form layout="vertical" component={false}>
          <Form.Item label="复制来源">
            <Radio.Group
              aria-label="复制来源"
              optionType="button"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              options={[
                { value: "DRAFT", label: "当前已保存草稿" },
                { value: "EFFECTIVE", label: "当前生效快照", disabled: source.liveDraftRevision == null },
              ]}
            />
          </Form.Item>
          <LoadFeedback loading={loading} error={error} retry={() => setRetry((value) => value + 1)} />
          {preview && (
            <p className="op-copy-dialog__note">
              已固定{kind === "DRAFT" ? "草稿" : "生效"} r{stringifyJson(preview.sourceRevision)}
              {preview.sourceReleaseId ? ` · 发布记录 ${preview.sourceReleaseId}` : ""}
              。负责人默认为当前维护人：
              {preview.snapshot.owner === source.owner && source.ownerName ? (
                <PersonTag name={source.ownerName} employeeNo={source.ownerEmployeeNo} tenantName={source.ownerTenantName} />
              ) : (
                "原 API 负责人"
              )}
              。
            </p>
          )}
          <div className="op-copy-dialog__fields">
            {identityFields.map((field) => (
              <Form.Item key={field.key} label={field.label} htmlFor={`copy-${field.key}`} required className={field.key === "name" ? "op-copy-dialog__name" : undefined}>
                <Input
                  id={`copy-${field.key}`}
                  required
                  maxLength={field.maxLength}
                  pattern={field.pattern}
                  value={identity[field.key]}
                  onChange={(event) => setIdentity((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              </Form.Item>
            ))}
          </div>
        </Form>
        <div className="op-copy-dialog__path">
          <span className="op-muted">新调用路径</span>
          <code>
            /api/oauth/{identity.service.trim() || "服务标识"}/{identity.version.trim() || "外部版本"}/{identity.method.trim() || "操作标识"}
          </code>
        </div>
        <p className="op-muted">服务标识、外部版本、操作标识至少更换一项；只改名称不能产生新的调用地址。</p>
        <p className="op-muted">
          复制范围：保留分类、请求与响应结构、文档、示例和错误说明，以及内部绑定、参数映射与权限组（保存时重新核验）；负责人使用当前维护人。
          不复制 Secret、Token、调试原文、发布与审核、启停状态、历史和跨环境记录；生命周期重置为正常维护。
        </p>
        {preview?.warnings.length ? (
          <Alert
            type="warning"
            showIcon
            title={
              <ul className="op-copy-dialog__warnings">
                {preview.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            }
          />
        ) : null}
        <p className="op-muted">下一步进入新建工作区核对完整配置；保存后才创建，不会直接发布。</p>
      </div>
    </Modal>
  );
}
