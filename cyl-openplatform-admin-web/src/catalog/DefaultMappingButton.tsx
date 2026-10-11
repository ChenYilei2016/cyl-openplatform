import { useState } from "react";
import { Button, Select } from "antd";
import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import type { Binding } from "./BindingEditor";
import type { Mapping } from "./SchemaEditor";
import "./editors.css";
import {
  appendMappings,
  argumentKind,
  proposeMappings,
  schemaPaths,
} from "./defaultMappings";

export default function DefaultMappingButton({
  schema,
  binding,
  mappings,
  onChange,
  blockedReason,
}: {
  schema: SchemaNode;
  blockedReason?: string;
  binding: Binding;
  mappings: Mapping[];
  onChange: (value: Mapping[]) => void;
}) {
  const [choosing, setChoosing] = useState(false),
    [choices, setChoices] = useState<Record<string, string>>({}),
    [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<{
    before: Mapping[];
    after: string;
    context: string;
  } | null>(null);
  const context = stringifyJson([schema, binding]);
  const [choiceContext, setChoiceContext] = useState(context);
  const plan = proposeMappings(
    schema,
    binding,
    choiceContext === context ? choices : {},
  );
  const pending = plan.pending.filter(
    (target) => !mappings.some((item) => item.target === target),
  );
  function apply() {
    try {
      const result = appendMappings(mappings, plan.mappings, binding);
      setError("");
      setChoosing(false);
      setNotice(
        `新增 ${result.added} 条，保留已有 ${mappings.length} 条${result.skipped.length ? `；${result.skipped.length} 个已有或重叠目标未覆盖` : ""}`,
      );
      if (result.added) {
        setUndo({
          before: mappings,
          after: stringifyJson(result.mappings),
          context,
        });
        onChange(result.mappings);
      }
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  return (
    <div className="default-mapping-tools">
      <Button
        disabled={!!blockedReason}
        title={blockedReason}
        size="small"
        onClick={() => {
          if (pending.length) {
            setChoices(choiceContext === context ? choices : {});
            setChoiceContext(context);
            setChoosing(true);
          } else apply();
        }}
      >
        补齐默认映射
      </Button>
      {notice && (
        <span role="status">
          {notice}{" "}
          {undo &&
            undo.after === stringifyJson(mappings) &&
            undo.context === context && (
              <Button
                type="link"
                size="small"
                onClick={() => {
                  onChange(undo.before);
                  setUndo(null);
                  setNotice("已撤销补齐");
                }}
              >
                撤销补齐
              </Button>
            )}
        </span>
      )}
      {blockedReason && <small>{blockedReason}</small>}
      {choosing && !blockedReason && (
        <div className="mapping-choices">
          <strong>选择要传给内部服务的数据</strong>
          {(binding.dubbo?.parameterTypes ?? []).map((type, index) => {
            const target = `arg${index}`,
              allowed = argumentKind(type),
              covered = mappings.some((item) => item.target === target);
            return (
              <div key={target} className="mapping-choice-field">
                <div className="mapping-argument">
                  <strong>
                    第 {index + 1} 个参数 <code>{target}</code>
                  </strong>
                  <small>{type}</small>
                </div>
                {covered ? (
                  <span>已有映射，保留</span>
                ) : (
                  <Select
                    aria-label={`${target} 默认来源`}
                    value={
                      choiceContext === context ? choices[target] : undefined
                    }
                    placeholder="选择全部请求或其中一个字段"
                    onChange={(value) => {
                      setChoiceContext(context);
                      setChoices((current) => ({
                        ...(choiceContext === context ? current : {}),
                        [target]: value,
                      }));
                    }}
                    options={[
                      ...(allowed.includes("OBJECT")
                        ? [{ value: "$", label: "使用全部请求字段" }]
                        : []),
                      ...schemaPaths(schema)
                        .filter((item) => allowed.includes(item.type))
                        .map((item) => ({
                          value: item.path,
                          label: `${item.path} · ${item.type}`,
                        })),
                    ]}
                  />
                )}
              </div>
            );
          })}
          <div>
            <Button
              type="primary"
              size="small"
              disabled={pending.length > 0}
              onClick={apply}
            >
              应用映射
            </Button>{" "}
            <Button size="small" onClick={() => setChoosing(false)}>
              取消
            </Button>
          </div>
        </div>
      )}
      <ErrorFeedback error={error} />
    </div>
  );
}
