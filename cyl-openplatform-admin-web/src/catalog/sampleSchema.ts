import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import { decimalContent, stringifyJson } from "@cyl/open-platform-web-shared/json";

export const identityFields = new Set([
  "applicationid",
  "appkey",
  "tenantid",
  "userid",
  "employeeid",
  "employeeno",
]);
export const isIdentityField = (name: string) =>
  identityFields.has(name.replaceAll("_", "").toLowerCase());
export interface SchemaQuestion {
  path: string;
  message: string;
  choices: string[];
}
export const fieldTypes = [
  "OBJECT",
  "ARRAY",
  "STRING",
  "INTEGER",
  "NUMBER",
  "BOOLEAN",
];
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  decimalContent(value) === null;

export function sampleAt(value: unknown, path: string): unknown {
  for (const part of path ? path.split(".") : []) {
    if (!isObject(value) || !Object.hasOwn(value, part))
      throw new Error(`样例中没有 ${path}，请检查选择的返回内容。`);
    value = value[part];
  }
  return value;
}
export function sampleObjectPaths(
  value: unknown,
  prefix = "",
  depth = 0,
): string[] {
  if (!isObject(value) || depth >= 7) return [];
  return Object.entries(value)
    .flatMap(([name, child]) => {
      const path = prefix ? `${prefix}.${name}` : name;
      return /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)
        ? [path, ...sampleObjectPaths(child, path, depth + 1)]
        : [];
    })
    .slice(0, 200);
}

/** 样例只推断形状，不推断业务必填/说明；类型不明留给用户原位选择。 */
export function inferSampleSchema(
  value: unknown,
  request: boolean,
  choices: Record<string, string> = {},
  existing?: SchemaNode,
  newFieldsRequired = false,
) {
  const questions: SchemaQuestion[] = [],
    excluded: string[] = [];
  let visited = 0;
  const clean = (input: unknown, path: string, depth: number): unknown => {
    if (++visited > 2000 || depth > 8)
      throw new Error("样例超过8层或2000个值，请缩小为代表性样例。");
    if (typeof input === "string" && input.length > 10_000)
      throw new Error(`${path} 字符串超过10000个字符。`);
    if (Array.isArray(input))
      return input.map((child) => clean(child, `${path}[]`, depth + 1));
    if (!isObject(input)) return input;
    const entries = Object.entries(input);
    if (entries.length > 50) throw new Error(`${path} 超过50个字段。`);
    return Object.fromEntries(
      entries
        .filter(([name]) => {
          if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name))
            throw new Error(`${path}.${name} 不是可用字段名。`);
          if (request && isIdentityField(name)) {
            excluded.push(`${path}.${name}`);
            return false;
          }
          return true;
        })
        .map(([name, child]) => [
          name,
          clean(child, `${path}.${name}`, depth + 1),
        ]),
    );
  };
  const sample = clean(value, "$", 1);
  if (request && !isObject(sample))
    throw new Error("请求样例需要是 JSON 对象，例如 {\"orderNo\":\"A001\"}，不能直接填写数组或单个值。");
  let nodes = 0;
  const infer = (
    values: unknown[],
    path: string,
    depth: number,
    previous?: SchemaNode,
  ): SchemaNode => {
    if (++nodes > 200 || depth > 8)
      throw new Error("生成结构超过8层或200个节点，请缩小样例。");
    const nonNull = values.filter((item) => item !== null);
    const types = new Set(
      nonNull.map((item) => {
        const decimal = decimalContent(item);
        return decimal !== null
          ? /^-?\d+$/.test(stringifyJson(item))
            ? "INTEGER"
            : "NUMBER"
          : Array.isArray(item)
            ? "ARRAY"
            : isObject(item)
              ? "OBJECT"
              : typeof item === "boolean"
                ? "BOOLEAN"
                : "STRING";
      }),
    );
    if (types.has("NUMBER")) types.delete("INTEGER");
    if (types.size > 1)
      throw new Error(
        `${path} 样例类型不一致（${[...types].join(" / ")}），请统一样例。`,
      );
    let type = [...types][0] ?? choices[path] ?? previous?.type;
    if (!type) {
      questions.push({
        path,
        message: "null 或空数组无法确定类型",
        choices: fieldTypes,
      });
      type = "STRING"; // 仅用于展示；questions 未解决时不允许采用。
    }
    const node: SchemaNode = {
      type,
      required: newFieldsRequired && depth > 1 && !path.endsWith("[]"),
      nullable: nonNull.length !== values.length,
    };
    if (type === "OBJECT") {
      const names = [
        ...new Set(
          nonNull.flatMap((item) => (isObject(item) ? Object.keys(item) : [])),
        ),
      ];
      if (names.length > 50) throw new Error(`${path} 合并后超过50个字段。`);
      node.properties = Object.fromEntries(
        names.map((name) => [
          name,
          infer(
            nonNull
              .filter((item) => isObject(item) && Object.hasOwn(item, name))
              .map((item) => (item as Record<string, unknown>)[name]),
            `${path}.${name}`,
            depth + 1,
            previous?.properties && Object.hasOwn(previous.properties, name)
              ? previous.properties[name]
              : undefined,
          ),
        ]),
      );
    }
    if (type === "ARRAY")
      node.items = infer(
        nonNull.flatMap((item) => (Array.isArray(item) ? item : [])),
        `${path}[]`,
        depth + 1,
        previous?.items ?? undefined,
      );
    return node;
  };
  return {
    schema: { ...infer([sample], "$", 1, existing), example: sample },
    questions,
    excluded: [...new Set(excluded)],
  };
}

/** 默认补齐缺少字段；已有业务约束保持，类型改变必须明确选择。 */
export function mergeSampleSchema(
  existing: SchemaNode | undefined,
  incoming: SchemaNode,
  resolutions: Record<string, string> = {},
  path = "$",
): { schema: SchemaNode; conflicts: SchemaQuestion[] } {
  if (!existing) return { schema: incoming, conflicts: [] };
  if (existing.type !== incoming.type) {
    const choice = resolutions[path];
    return {
      schema:
        choice === "sample"
          ? {
              ...incoming,
              description: existing.description,
              required: existing.required,
              nullable: existing.nullable,
              enumValues: existing.enumValues,
              defaultValue: existing.defaultValue,
              example: existing.example,
            }
          : existing,
      conflicts: choice
        ? []
        : [
            {
              path,
              message: `已有 ${existing.type}，样例 ${incoming.type}`,
              choices: ["existing", "sample"],
            },
          ],
    };
  }
  const conflicts: SchemaQuestion[] = [];
  const schema: SchemaNode = { ...existing };
  if (incoming.properties) {
    schema.properties = { ...existing.properties };
    for (const [name, child] of Object.entries(incoming.properties)) {
      const merged = mergeSampleSchema(
        existing.properties && Object.hasOwn(existing.properties, name)
          ? existing.properties[name]
          : undefined,
        child,
        resolutions,
        `${path}.${name}`,
      );
      schema.properties[name] = merged.schema;
      conflicts.push(...merged.conflicts);
    }
  }
  if (incoming.items) {
    const merged = mergeSampleSchema(
      existing.items ?? undefined,
      incoming.items,
      resolutions,
      `${path}[]`,
    );
    schema.items = merged.schema;
    conflicts.push(...merged.conflicts);
  }
  if (
    existing.example == null &&
    existing.type === "OBJECT" &&
    !Object.keys(existing.properties ?? {}).length
  )
    schema.example = incoming.example;
  return { schema, conflicts };
}

/** 类型变化后只清理不兼容的旧取值；完整枚举/必填等校验仍交给服务端。 */
export function reconcileSchemaValues(root: SchemaNode): {
  schema: SchemaNode;
  adjustments: string[];
} {
  const adjustments: string[] = [];
  const hasShape = (value: unknown, node: SchemaNode): boolean => {
    if (value === null) return !!node.nullable;
    const decimal = decimalContent(value);
    switch (node.type) {
      case "INTEGER":
        return decimal !== null && !/e-/.test(decimal);
      case "NUMBER":
        return decimal !== null;
      case "STRING":
        return typeof value === "string";
      case "BOOLEAN":
        return typeof value === "boolean";
      case "ARRAY":
        return (
          Array.isArray(value) &&
          !!node.items &&
          value.every((item) => hasShape(item, node.items!))
        );
      case "OBJECT":
        return (
          isObject(value) &&
          Object.entries(node.properties ?? {}).every(
            ([name, child]) =>
              !Object.hasOwn(value, name) || hasShape(value[name], child),
          )
        );
      default:
        return false;
    }
  };
  const visit = (node: SchemaNode, path: string): SchemaNode => {
    const schema: SchemaNode = { ...node };
    if (node.properties)
      schema.properties = Object.fromEntries(
        Object.entries(node.properties).map(([name, child]) => [
          name,
          visit(child, `${path}.${name}`),
        ]),
      );
    if (node.items) schema.items = visit(node.items, `${path}[]`);
    for (const key of ["example", "defaultValue"] as const) {
      if (schema[key] != null && !hasShape(schema[key], schema)) {
        schema[key] = null;
        adjustments.push(
          `${path} 的${key === "example" ? "旧示例" : "旧默认值"}`,
        );
      }
    }
    if (schema.enumValues?.some((value) => !hasShape(value, schema))) {
      schema.enumValues = schema.enumValues.filter((value) =>
        hasShape(value, schema),
      );
      adjustments.push(`${path} 的不兼容枚举项`);
    }
    return schema;
  };
  return { schema: visit(root, "$"), adjustments };
}
