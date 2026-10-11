import { Alert, Button, Checkbox, Input } from 'antd';
import { useRef, useState } from 'react';
import type { AdminApi } from '../access/api';
import type { SchemaNode } from '@cyl/open-platform-web-shared/documentation/types';
import { parseJson, stringifyJson } from '@cyl/open-platform-web-shared/json';
import { clearExamples } from './SchemaEditor';
import './editors.css';

export default function ResponseExampleEditor({
  api,
  schema,
  schemaText: suppliedSchemaText,
  source,
  onApply,
  onCancel,
}: {
  api: AdminApi;
  schema: SchemaNode;
  schemaText?: string;
  source: unknown;
  onApply: (schema: SchemaNode) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<{
    text: string;
    schemaText: string;
    value: SchemaNode;
  } | null>(null);
  const [fields, setFields] = useState<
    { path: (string | number)[]; value: unknown; required: boolean }[]
  >([]);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(0);
  const edit = (next: string) => {
    active.current++;
    setText(next);
    setPreview(null);
    setConfirmed(false);
    setFields([]);
    setError('');
  };
  const sourceFields =
    source &&
    typeof source === 'object' &&
    !Array.isArray(source) &&
    !(JSON as typeof JSON & { isRawJSON?: (value: unknown) => boolean }).isRawJSON?.(source)
      ? Object.entries(source)
      : [];
  const schemaText = suppliedSchemaText ?? stringifyJson(schema);
  const readFields = async () => {
    setBusy(true);
    setError('');
    const attempt = ++active.current;
    try {
      const value = await api<unknown>('/apis/validate-json', { method: 'POST', bodyText: text });
      if (attempt !== active.current) return;
      const rows: typeof fields = [];
      const visit = (item: unknown, node: SchemaNode, path: (string | number)[] = []) => {
        if (path.length && !Array.isArray(item))
          rows.push({ path, value: item, required: Boolean(node.required) });
        if (node.type === 'OBJECT' && item && typeof item === 'object')
          Object.entries(item).forEach(([key, child]) => {
            if (node.properties?.[key]) visit(child, node.properties[key], [...path, key]);
          });
        if (node.type === 'ARRAY' && Array.isArray(item) && node.items)
          item.forEach((child, index) => visit(child, node.items!, [...path, index]));
      };
      visit(value, schema);
      setFields(rows);
    } catch (failure) {
      if (attempt === active.current) setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const updateField = async (path: (string | number)[], replacement?: string) => {
    setBusy(true);
    setError('');
    const attempt = ++active.current;
    try {
      const candidate = parseJson<Record<string, unknown>>(text);
      let parent: Record<string | number, unknown> = candidate;
      for (const segment of path.slice(0, -1))
        parent = parent[segment] as Record<string | number, unknown>;
      if (replacement === undefined) delete parent[path.at(-1)!];
      else
        parent[path.at(-1)!] = await api('/apis/validate-json', {
          method: 'POST',
          bodyText: replacement,
        });
      if (attempt === active.current) edit(stringifyJson(candidate, 2));
    } catch (failure) {
      if (attempt === active.current) setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="dialog-body sample-editor">
        <Alert
          type="info"
          showIcon
          role="note"
          title="只编辑这个 API 的文档示例，不会改变原始测试结果或服务返回值。写入后仍需保存草稿，再按发布流程生效。"
        />
        {sourceFields.length > 0 ? (
          <details open>
            <summary>1. 从业务 data 选择起点（默认不选）</summary>
            <div className="sample-fields">
              {sourceFields.map(([key, value]) => (
                <Checkbox
                  key={key}
                  className="checkbox-label"
                  checked={selected.includes(key)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, key]
                        : current.filter((item) => item !== key),
                    )
                  }
                >
                  {key}
                  <code>{stringifyJson(value)}</code>
                </Checkbox>
              ))}
            </div>
            <Button
              disabled={!selected.length}
              onClick={() =>
                edit(
                  stringifyJson(
                    Object.fromEntries(sourceFields.filter(([key]) => selected.includes(key))),
                    2,
                  ),
                )
              }
            >
              用所选字段替换编辑区
            </Button>
          </details>
        ) : (
          <p>请手工填写符合响应结构的公开业务值。原始值可在测试结果中核对，不会自动复制。</p>
        )}
        <h3>{sourceFields.length ? '2. ' : ''}修改示例内容</h3>
        <label>
          公开业务 data（JSON）
          <Input.TextArea
            aria-label="公开业务 data（JSON）"
            className="public-example-json"
            rows={6}
            maxLength={262144}
            spellCheck={false}
            value={text}
            onChange={(event) => edit(event.target.value)}
          />
        </label>
        <p className="help-text">
          可追加已声明字段、替换为符合类型及枚举的虚构值，或移除可选字段。不要加入 code / resultMsg
          / requestId 外壳、Token、密钥或个人资料。
        </p>
        <details className="sample-tools">
          <summary>逐字段编辑 / 辅助脱敏</summary>
          <Button disabled={busy || !text.trim()} onClick={() => void readFields()}>
            读取可编辑字段
          </Button>
          {fields.map((field) => (
            <ExampleField
              key={field.path.join('.')}
              field={field}
              disabled={busy}
              onReplace={(replacement) => void updateField(field.path, replacement)}
              onRemove={() => void updateField(field.path)}
            />
          ))}
          <p className="help-text">
            工具只辅助替换，不自动判断所有敏感信息；每次修改后必须重新校验和确认。
          </p>
        </details>
        {error && (
          <p className="error-note" role="alert">
            {error}
          </p>
        )}
        <Button
          type="primary"
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true);
            setError('');
            setPreview(null);
            setConfirmed(false);
            const attempt = ++active.current;
            try {
              const example = await api<unknown>('/apis/validate-json', {
                method: 'POST',
                bodyText: text,
              });
              const currentSchema =
                suppliedSchemaText !== undefined
                  ? await api<SchemaNode>('/apis/validate-json?kind=schema&request=false', {
                      method: 'POST',
                      bodyText: suppliedSchemaText,
                    })
                  : schema;
              const value = await api<SchemaNode>('/apis/validate-json?kind=schema&request=false', {
                method: 'POST',
                bodyText: stringifyJson({ ...clearExamples(currentSchema), example }),
              });
              if (value.example == null)
                throw new Error('公开示例不能是 null；不需要示例时请取消。');
              if (attempt === active.current) setPreview({ text, schemaText, value });
            } catch (failure) {
              if (attempt === active.current) setError((failure as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          校验并预览公开内容
        </Button>
        {preview && preview.schemaText === schemaText && (
          <section className="sample-preview">
            <h4>客户将看到的业务响应示例</h4>
            <pre>{stringifyJson(preview.value.example, 2)}</pre>
            <Checkbox className="checkbox-label" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}>
              我已逐项核对，确认内容适合公开，并替换当前草稿的响应示例（清除旧字段示例，避免残留）。
            </Checkbox>
          </section>
        )}
      </div>
      <div className="dialog-actions">
        <Button disabled={busy} onClick={onCancel}>
          取消，保留原示例
        </Button>
        <Button
          type="primary"
          disabled={
            busy ||
            !confirmed ||
            !preview ||
            preview.text !== text ||
            preview.schemaText !== schemaText
          }
          onClick={() => {
            if (preview && confirmed && preview.text === text && preview.schemaText === schemaText)
              onApply(preview.value);
          }}
        >
          确认写入当前草稿
        </Button>
      </div>
    </>
  );
}
function ExampleField({
  field,
  disabled,
  onReplace,
  onRemove,
}: {
  field: { path: (string | number)[]; value: unknown; required: boolean };
  disabled: boolean;
  onReplace: (text: string) => void;
  onRemove: () => void;
}) {
  const [text, setText] = useState(stringifyJson(field.value));
  return (
    <div className="example-field">
      <label>
        {field.path.join('.')} {field.required ? '（必填）' : '（可选）'}
        <Input
          aria-label={`替换 ${field.path.join('.')}`}
          value={text}
          maxLength={262144}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <Button type="link" size="small" disabled={disabled} onClick={() => onReplace(text)}>
        应用 JSON 值
      </Button>
      <Button
        type="link"
        size="small"
        danger
        disabled={disabled || field.required || typeof field.path.at(-1) === 'number'}
        onClick={onRemove}
      >
        移除可选字段
      </Button>
    </div>
  );
}
