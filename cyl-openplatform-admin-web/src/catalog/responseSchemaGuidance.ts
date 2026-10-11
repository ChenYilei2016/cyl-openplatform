import { parseJson } from '@cyl/open-platform-web-shared/json';
import type { SchemaNode } from '@cyl/open-platform-web-shared/documentation/types';
import type { AdapterForm } from './ResponseAdapterEditor';

function schemaAt(root: SchemaNode, path: string): SchemaNode | undefined {
  let node: SchemaNode | undefined = root;
  for (const part of path.split('.')) {
    if (node?.type !== 'OBJECT' || !node.properties || !Object.hasOwn(node.properties, part)) return;
    node = node.properties[part];
  }
  return node;
}
function exampleAt(value: unknown, path: string): unknown {
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** 仅提出可识别的外壳层级建议；业务也可能有同名字段，不能自动改写或作为保存阻断。 */
export function responseSchemaSuggestion(form: AdapterForm, text: string) {
  if (form.mode !== 'ENVELOPE' || !form.dataPath || !form.successPath || !text.trim()) return null;
  try {
    const root = parseJson<SchemaNode>(text);
    const data = schemaAt(root, form.dataPath);
    if (!data || !schemaAt(root, form.successPath) || form.dataPath === form.successPath) return null;
    // 服务端未设置的节点示例也序列化为 null；优先保留非空内层示例，否则提取完整样例。
    const example = data.example ?? exampleAt(root.example, form.dataPath);
    return {
      path: form.dataPath,
      beforeFields: Object.keys(root.properties ?? {}),
      fields: Object.keys(data.properties ?? {}),
      schema: { ...data, ...(example === undefined ? {} : { example }) },
    };
  } catch { return null; } // 无效高级JSON保留原文，由既有严格校验显示错误。
}
