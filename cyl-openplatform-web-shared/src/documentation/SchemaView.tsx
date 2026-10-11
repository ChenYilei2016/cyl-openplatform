import { useMemo, useState } from 'react';
import { CaretDownOutlined, CaretRightOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { stringifyJson } from '../json';
import type { SchemaNode } from './types';
import './schema-view.css';

type FieldRow = {
  key: string;
  path: string;
  node: SchemaNode;
  depth: number;
  ancestors: string[];
  expandable: boolean;
};

/** 展开状态只影响阅读，原始Schema、取值及复制内容始终保持完整。 */
export default function SchemaView({
  title,
  schema,
  showRawSchema = true,
}: {
  title: string;
  schema: SchemaNode;
  showRawSchema?: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['root']));
  const rows = useMemo(() => {
    const result: FieldRow[] = [];
    const visit = (node: SchemaNode, path: string, key: string, depth: number, ancestors: string[]) => {
      const children = Object.entries(node.properties ?? {});
      const hasDetails = (value: SchemaNode) =>
        !!(
          value.required ||
          value.nullable ||
          value.description ||
          value.enumValues?.length ||
          value.defaultValue != null ||
          value.example != null
        );
      const structuralItem =
        key.endsWith('/items') && node.type === 'OBJECT' && children.length > 0 && !hasDetails(node);
      const meaningfulItems =
        node.items && (node.items.type === 'OBJECT' || node.items.type === 'ARRAY' || hasDetails(node.items));
      const emptyRoot =
        !showRawSchema &&
        depth === 0 &&
        node.type === 'OBJECT' &&
        children.length > 0 &&
        !node.required &&
        !node.nullable &&
        !node.description &&
        !node.enumValues?.length &&
        node.defaultValue == null &&
        node.example == null;
      if (!emptyRoot && !structuralItem)
        result.push({ key, path, node, depth, ancestors, expandable: children.length > 0 || !!meaningfulItems });
      const parents = emptyRoot || structuralItem ? ancestors : [...ancestors, key];
      children.forEach(([name, child]) =>
        visit(
          child,
          `${path}.${name}`,
          `${key}/properties/${JSON.stringify(name)}`,
          depth + (structuralItem ? 0 : 1),
          parents,
        ),
      );
      if (meaningfulItems && node.items) visit(node.items, `${path}[]`, `${key}/items`, depth + 1, parents);
    };
    visit(schema, '$', 'root', 0, []);
    return result;
  }, [schema, showRawSchema]);
  const branches = rows.filter((row) => row.expandable);
  const visible = rows.filter((row) => row.ancestors.every((key) => expanded.has(key)));
  const baseDepth = rows[0]?.depth ?? 0;
  return (
    <section className="schema-view" aria-label={title}>
      <div className="schema-heading">
        <h3>{title}</h3>
        {branches.length > 0 && (
          <div className="schema-actions">
            <Button
              size="small"
              disabled={branches.every((row) => expanded.has(row.key))}
              onClick={() => setExpanded(new Set(branches.map((row) => row.key)))}
            >
              全部展开
            </Button>
            <Button
              size="small"
              disabled={!branches.some((row) => row.key !== 'root' && expanded.has(row.key))}
              onClick={() => setExpanded(new Set(['root']))}
            >
              收起嵌套
            </Button>
          </div>
        )}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th><span className="schema-path-heading">字段路径</span></th>
              <th>必填</th>
              <th>类型</th>
              <th>说明及取值</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ key, path, node, depth, expandable }) => (
              <tr key={key}>
                <td>
                  <div className="schema-field" style={{ paddingLeft: (depth - baseDepth) * 16 }}>
                    {expandable ? (
                      <button
                        type="button"
                        className="schema-toggle"
                        aria-label={`${expanded.has(key) ? '收起' : '展开'} ${path}`}
                        aria-expanded={expanded.has(key)}
                        onClick={() =>
                          setExpanded((previous) => {
                            const next = new Set(previous);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          })
                        }
                      >
                        {expanded.has(key) ? <CaretDownOutlined aria-hidden /> : <CaretRightOutlined aria-hidden />}
                      </button>
                    ) : (
                      <span className="schema-toggle-space" aria-hidden="true" />
                    )}
                    <code>{path}</code>
                  </div>
                </td>
                <td>
                  <span className={node.required ? 'schema-required' : 'schema-optional'}>
                    {node.required ? '必填' : '可选'}
                  </span>
                </td>
                <td>
                  <small>
                    {node.type === 'ARRAY' && node.items
                      ? `array[${node.items.type?.toLowerCase() ?? '未定义'}]`
                      : node.type?.toLowerCase() ?? '未定义'}
                    {node.nullable ? ' · 可为 null' : ''}
                    {node.type === 'OBJECT' && !Object.keys(node.properties ?? {}).length ? ' · 空对象' : ''}
                  </small>
                </td>
                <td>
                  {node.description && <p>{node.description}</p>}
                  {node.enumValues && node.enumValues.length > 0 && (
                    <div>
                      枚举：<code>{stringifyJson(node.enumValues)}</code>
                    </div>
                  )}
                  {node.defaultValue !== undefined && node.defaultValue !== null && (
                    <div>
                      默认值：<code>{stringifyJson(node.defaultValue)}</code>
                    </div>
                  )}
                  {node.example !== undefined && node.example !== null && (
                    <div>
                      显式示例：<code>{stringifyJson(node.example)}</code>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showRawSchema && (
        <details>
          <summary>{title}原始 JSON</summary>
          <pre>{stringifyJson(schema, 2)}</pre>
        </details>
      )}
    </section>
  );
}
