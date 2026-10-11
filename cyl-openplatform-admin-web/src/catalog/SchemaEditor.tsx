import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import SchemaTable from "./schema/SchemaTable";

/**
 * 111b：字段表交互已迁到 ./schema/SchemaTable；本模块保留类型与工具函数的原有导出，
 * 让配置页、新建页与调试页继续从这里引用。
 */
export default SchemaTable;

export interface Mapping {
  target: string;
  source: "REQUEST" | "FIXED" | "CONTEXT";
  path?: string | null;
  value?: unknown;
  location?: "PATH" | "QUERY" | "BODY" | null;
}
export const schemaTypes = [
  "OBJECT",
  "ARRAY",
  "STRING",
  "INTEGER",
  "NUMBER",
  "BOOLEAN",
];
export const schemaTypeNames: Record<string, string> = {
  OBJECT: "对象",
  ARRAY: "数组",
  STRING: "文本",
  INTEGER: "整数",
  NUMBER: "数值",
  BOOLEAN: "是/否",
};
export function requestPaths(node: SchemaNode, prefix = ""): string[] {
  if (!node || typeof node !== "object") return [];
  return Object.entries(node.properties ?? {}).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...requestPaths(child, path)];
  });
}
export function clearExamples(node: SchemaNode): SchemaNode {
  return {
    ...node,
    example: null,
    ...(node.properties
      ? {
          properties: Object.fromEntries(
            Object.entries(node.properties).map(([key, child]) => [
              key,
              clearExamples(child),
            ]),
          ),
        }
      : {}),
    ...(node.items ? { items: clearExamples(node.items) } : {}),
  };
}
