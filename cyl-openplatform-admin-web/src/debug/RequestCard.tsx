import { forwardRef, useState } from "react";
import { Alert, Button, Dropdown, Input, Modal, Space } from "antd";
import { CopyOutlined, SaveOutlined } from "@ant-design/icons";
import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { httpTargetLabel } from "../catalog/httpMapping";
import { curlCommand } from "./curl";
import RequestEditor from "./RequestEditor";
import { readSamples, removeSample, saveSample, type DebugSample } from "./samples";
import type { DebugDefinition } from "./types";

/** 左栏：请求参数（表单 / JSON 同一份原文）、样例、请求示例、复制 cURL、调用目标摘要。 */
const RequestCard = forwardRef<
  HTMLElement,
  {
    definition: DebugDefinition;
    schema?: SchemaNode;
    input: string;
    onInput: (value: string) => void;
    onInvalid: (invalid: boolean, incomplete: boolean) => void;
    busy: boolean;
    preparing: boolean;
    dirty: boolean;
    onFillExample: () => void;
    candidate: string | null;
    onCandidate: (accept: boolean) => void;
    onConfigureTarget?: () => void;
  }
>(function RequestCard({ definition, schema, input, onInput, onInvalid, busy, preparing, dirty, onFillExample, candidate, onCandidate, onConfigureTarget }, ref) {
  const [samples, setSamples] = useState<DebugSample[]>(() => readSamples(definition.id));
  const [naming, setNaming] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const revision = stringifyJson(definition.draftRevision);
  const binding = definition.binding as
    | { protocol?: string; http?: { url?: string; method?: string }; dubbo?: { interfaceName?: string; method?: string; connectionRevision?: number } }
    | undefined;
  const target = binding?.http
    ? `${binding.http.method} ${httpTargetLabel(binding.http)}`
    : binding?.dubbo
      ? `${binding.dubbo.interfaceName}.${binding.dubbo.method} · 连接r${binding.dubbo.connectionRevision == null ? "未关联" : stringifyJson(binding.dubbo.connectionRevision)}`
      : "未配置目标";
  return (
    <section ref={ref} className="op-debug__card" aria-label="测试请求">
      <header className="op-debug__card-head">
        <h3>请求</h3>
        <Space size={4} wrap>
          <Dropdown
            trigger={["click"]}
            disabled={busy}
            menu={{
              items: [
                ...samples.map((sample) => ({
                  key: `use:${sample.name}`,
                  label: sample.name,
                  extra: (
                    <Button
                      type="link"
                      size="small"
                      danger
                      aria-label={`删除样例 ${sample.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSamples(removeSample(definition.id, sample.name));
                      }}
                    >
                      删除
                    </Button>
                  ),
                })),
                ...(samples.length ? [{ type: "divider" as const }] : []),
                { key: "save", label: "把当前参数存为样例…", icon: <SaveOutlined /> },
              ],
              onClick: ({ key }) => {
                if (key === "save") return setNaming("");
                const sample = samples.find((item) => `use:${item.name}` === key);
                if (sample) onInput(sample.input);
              },
            }}
          >
            <Button size="small">样例{samples.length ? `（${samples.length}）` : ""}</Button>
          </Dropdown>
          <Button size="small" disabled={busy || preparing} onClick={onFillExample}>
            {preparing ? "读取示例中…" : "填入已保存请求示例"}
          </Button>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => {
              void navigator.clipboard?.writeText(curlCommand(window.location.origin, definition, input));
              setCopied(true);
            }}
          >
            {copied ? "已复制 cURL" : "复制 cURL"}
          </Button>
        </Space>
      </header>
      <p className="op-debug__revision">
        调试草稿 r{revision} {dirty && <StatusBadge tone="warning">有未保存修改</StatusBadge>}
        {copied && <small className="op-muted">cURL 中 Token 为占位符，请换成真实业务 Token。</small>}
      </p>
      <RequestEditor text={input} schema={schema} disabled={busy} onInvalid={onInvalid} onChange={onInput} />
      {candidate !== null && (
        <Alert
          type="info"
          showIcon
          title="已有输入，是否用示例替换？"
          action={
            <Space orientation="vertical" size={4}>
              <Button size="small" type="primary" onClick={() => onCandidate(true)}>
                确认替换测试输入
              </Button>
              <Button size="small" onClick={() => onCandidate(false)}>
                取消，保留输入
              </Button>
            </Space>
          }
        />
      )}
      <details className="op-debug__target">
        <summary>
          调用目标与映射 <span>{binding?.protocol}</span>
        </summary>
        <p className="op-debug__target-address">{target}</p>
        <p>{definition.mappings?.length ?? 0} 条映射；预检后可查看实际提供方参数。</p>
        {onConfigureTarget && (
          <Button size="small" disabled={busy} onClick={onConfigureTarget}>
            到配置页编辑目标与参数映射
          </Button>
        )}
      </details>
      <Modal
        open={naming !== null}
        title="存为调试样例"
        okText="保存样例"
        cancelText="取消"
        okButtonProps={{ disabled: !naming?.trim() }}
        onCancel={() => setNaming(null)}
        onOk={() => {
          setSamples(saveSample(definition.id, naming ?? "", input));
          setNaming(null);
        }}
        destroyOnHidden
      >
        <Input aria-label="样例名称" maxLength={40} value={naming ?? ""} placeholder="例如：正常订单、订单不存在" onChange={(event) => setNaming(event.target.value)} />
        <p className="op-muted">样例只存在当前浏览器，不含 Token、Secret 等秘密字段；同名会覆盖。</p>
      </Modal>
    </section>
  );
});
export default RequestCard;
