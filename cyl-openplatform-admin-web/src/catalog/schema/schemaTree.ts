import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import type { Mapping } from "../SchemaEditor";
import { isIdentityField } from "../sampleSchema";

/**
 * 111b：字段表的纯函数树操作。路径用字段名数组表示，"[]" 表示数组元素。
 * 所有操作返回新树；失败时抛出可直接展示给用户的中文错误。
 */

export type SchemaPath = string[];
export const MAX_LEVELS = 8;
export const MAX_NODES = 200;
export const MAX_FIELDS = 50;

export const pathLabel = (path: SchemaPath) => path.join(".").replaceAll(".[]", "[]");
export const pathKey = (path: SchemaPath) => JSON.stringify(path);

/** 与服务端字段问题一致的 JSON Pointer。 */
export const fieldPointer = (path: SchemaPath, request: boolean) =>
  `${request ? "/requestSchema" : "/responseSchema"}${path
    .map((part) => (part === "[]" ? "/items" : `/properties/${part.replaceAll("~", "~0").replaceAll("/", "~1")}`))
    .join("")}`;

export function nodeAt(root: SchemaNode, path: SchemaPath): SchemaNode {
  let node = root;
  for (const part of path) {
    const next = part === "[]" ? node.items : node.properties?.[part];
    if (!next) throw new Error(`字段 ${pathLabel(path)} 不存在，请刷新后重试。`);
    node = next;
  }
  return node;
}

export function updateAt(root: SchemaNode, path: SchemaPath, update: (node: SchemaNode) => SchemaNode): SchemaNode {
  if (!path.length) return update(root);
  const [head, ...rest] = path;
  if (head === "[]") return { ...root, items: updateAt(root.items!, rest, update) };
  return { ...root, properties: { ...root.properties, [head]: updateAt(root.properties![head], rest, update) } };
}

export function countNodes(node: SchemaNode): number {
  return 1 + Object.values(node.properties ?? {}).reduce((sum, child) => sum + countNodes(child), 0) + (node.items ? countNodes(node.items) : 0);
}
/** 子树层数（叶子为 1）。 */
export function height(node: SchemaNode): number {
  return 1 + Math.max(0, ...Object.values(node.properties ?? {}).map(height), node.items ? height(node.items) : 0);
}
/** 节点所在层（根为 1）。 */
export const levelOf = (path: SchemaPath) => path.length + 1;

export function newNode(type: string): SchemaNode {
  return {
    type,
    description: "",
    ...(type === "OBJECT" ? { properties: {} } : type === "ARRAY" ? { items: { type: "STRING" } } : {}),
  };
}

/** 类型改变：子字段/元素只保留与新类型兼容的部分；默认值、枚举、示例保留，交给服务端校验。 */
export const retype = (node: SchemaNode, type: string): SchemaNode => ({
  ...node,
  type,
  properties: type === "OBJECT" ? (node.type === "OBJECT" ? node.properties : {}) : undefined,
  items: type === "ARRAY" ? (node.type === "ARRAY" ? node.items : { type: "STRING" }) : undefined,
});

export function uniqueName(properties: Record<string, unknown> | undefined, base = "field") {
  for (let index = 1; ; index++) if (!Object.hasOwn(properties ?? {}, `${base}${index}`)) return `${base}${index}`;
}

export function nameError(name: string, siblings: string[], request: boolean, current?: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)) return "以英文字母开头，只含字母、数字、下划线，最多 64 位";
  if (name !== current && siblings.includes(name)) return `同一层已有字段 ${name}`;
  if (request && isIdentityField(name)) return "可信身份字段不能来自业务请求，请在参数映射中使用平台身份";
  return "";
}

/** 字段的父对象路径；数组元素不是可移动的字段。 */
const parentOf = (path: SchemaPath) => {
  if (!path.length || path.at(-1) === "[]") throw new Error("数组元素不能单独移动或删除。");
  return path.slice(0, -1);
};

/** 在 entries 中重建对象属性，保持顺序。 */
const withProperties = (node: SchemaNode, entries: [string, SchemaNode][]): SchemaNode => ({ ...node, properties: Object.fromEntries(entries) });

function assertRoom(root: SchemaNode, adding: number) {
  if (countNodes(root) + adding > MAX_NODES) throw new Error(`结构最多 ${MAX_NODES} 个节点，请先精简。`);
}

export function canAddChild(root: SchemaNode, objectPath: SchemaPath) {
  const node = nodeAt(root, objectPath);
  return node.type === "OBJECT" && levelOf(objectPath) + 1 <= MAX_LEVELS && Object.keys(node.properties ?? {}).length < MAX_FIELDS && countNodes(root) < MAX_NODES;
}
/** 数组还需要一个元素节点：所在层需留出一层，且总节点留出两个。 */
export function canBeContainer(root: SchemaNode, path: SchemaPath, type: string, current?: SchemaNode) {
  if (type !== "ARRAY") return true;
  if (current?.type === "ARRAY") return true;
  return levelOf(path) + 1 <= MAX_LEVELS && countNodes(root) + 1 <= MAX_NODES;
}

export function addField(root: SchemaNode, objectPath: SchemaPath, options: { after?: string; type?: string; name?: string } = {}) {
  const parent = nodeAt(root, objectPath);
  if (parent.type !== "OBJECT") throw new Error("只有对象可以添加子字段。");
  if (levelOf(objectPath) + 1 > MAX_LEVELS) throw new Error(`结构最多 ${MAX_LEVELS} 层。`);
  const entries = Object.entries(parent.properties ?? {});
  if (entries.length >= MAX_FIELDS) throw new Error(`每个对象最多 ${MAX_FIELDS} 个字段。`);
  const type = options.type ?? "STRING";
  assertRoom(root, type === "ARRAY" ? 2 : 1);
  const name = options.name ?? uniqueName(parent.properties);
  const index = options.after == null ? entries.length : entries.findIndex(([key]) => key === options.after) + 1;
  entries.splice(index, 0, [name, newNode(type)]);
  return { schema: updateAt(root, objectPath, (node) => withProperties(node, entries)), path: [...objectPath, name] };
}

export function renameField(root: SchemaNode, path: SchemaPath, name: string): SchemaNode {
  const parentPath = parentOf(path);
  return updateAt(root, parentPath, (node) =>
    withProperties(node, Object.entries(node.properties ?? {}).map(([key, value]) => [key === path.at(-1) ? name : key, value])),
  );
}

export function removeField(root: SchemaNode, path: SchemaPath): SchemaNode {
  return updateAt(root, parentOf(path), (node) => withProperties(node, Object.entries(node.properties ?? {}).filter(([key]) => key !== path.at(-1))));
}

/** 同级内移动到 targetKey 前（或后）。 */
export function moveField(root: SchemaNode, path: SchemaPath, targetKey: string, after = false): SchemaNode {
  const parentPath = parentOf(path);
  const name = path.at(-1)!;
  if (name === targetKey) return root;
  return updateAt(root, parentPath, (node) => {
    const entries = Object.entries(node.properties ?? {});
    const moving = entries.find(([key]) => key === name)!;
    const rest = entries.filter(([key]) => key !== name);
    const index = rest.findIndex(([key]) => key === targetKey);
    if (index < 0) return node;
    rest.splice(after ? index + 1 : index, 0, moving);
    return withProperties(node, rest);
  });
}

/** 上移 / 下移一位；到边界时返回 null。 */
export function shiftField(root: SchemaNode, path: SchemaPath, delta: -1 | 1): SchemaNode | null {
  const keys = Object.keys(nodeAt(root, parentOf(path)).properties ?? {});
  const index = keys.indexOf(path.at(-1)!);
  const target = keys[index + delta];
  if (target == null) return null;
  return moveField(root, path, target, delta > 0);
}

function placeInto(root: SchemaNode, path: SchemaPath, targetPath: SchemaPath, after?: string) {
  const name = path.at(-1)!;
  const moving = nodeAt(root, path);
  const target = nodeAt(root, targetPath);
  if (target.type !== "OBJECT") throw new Error("只能放入对象字段。");
  if (Object.hasOwn(target.properties ?? {}, name)) throw new Error(`${pathLabel(targetPath) || "顶层"} 已有字段 ${name}，请先改名。`);
  if (Object.keys(target.properties ?? {}).length >= MAX_FIELDS) throw new Error(`每个对象最多 ${MAX_FIELDS} 个字段。`);
  if (levelOf(targetPath) + height(moving) > MAX_LEVELS) throw new Error(`移动后超过 ${MAX_LEVELS} 层。`);
  const removed = removeField(root, path);
  // 目标路径在移出前后不变：目标不会是被移动字段的后代（调用方保证）。
  const schema = updateAt(removed, targetPath, (node) => {
    const entries = Object.entries(node.properties ?? {});
    const index = after == null ? entries.length : entries.findIndex(([key]) => key === after) + 1;
    entries.splice(index, 0, [name, moving]);
    return withProperties(node, entries);
  });
  return { schema, path: [...targetPath, name] };
}

/** 成为上一个同级对象字段的最后一个子字段。 */
export function indentField(root: SchemaNode, path: SchemaPath) {
  const parentPath = parentOf(path);
  const keys = Object.keys(nodeAt(root, parentPath).properties ?? {});
  const previous = keys[keys.indexOf(path.at(-1)!) - 1];
  if (previous == null || nodeAt(root, [...parentPath, previous]).type !== "OBJECT")
    throw new Error("上方需要一个对象字段才能缩进为其子字段。");
  return placeInto(root, path, [...parentPath, previous]);
}

/** 提升到所属对象（或所属数组字段）之后。 */
export function outdentField(root: SchemaNode, path: SchemaPath) {
  let anchor = parentOf(path);
  while (anchor.at(-1) === "[]") anchor = anchor.slice(0, -1);
  if (!anchor.length) throw new Error("已经在最外层。");
  return placeInto(root, path, anchor.slice(0, -1), anchor.at(-1));
}

/** 引用该字段（或其子字段）的客户请求映射。 */
export function affectedMappings(mappings: Mapping[], path: SchemaPath) {
  const field = path.join(".");
  return mappings.filter((mapping) => mapping.source === "REQUEST" && mapping.path && (mapping.path === field || mapping.path.startsWith(`${field}.`)));
}

export interface SchemaRow {
  path: SchemaPath;
  key: string;
  node: SchemaNode;
  depth: number;
  hasChildren: boolean;
  /** 同级位置，用于上移/下移可用性。 */
  first: boolean;
  last: boolean;
}

/** 展平为可见行；根不是行，根的子字段（或数组元素）从第 0 层开始。 */
export function visibleRows(root: SchemaNode, collapsed: Set<string>): SchemaRow[] {
  const rows: SchemaRow[] = [];
  const walk = (node: SchemaNode, path: SchemaPath, depth: number) => {
    const children: [string, SchemaNode][] = [...Object.entries(node.properties ?? {}), ...(node.items ? [["[]", node.items] as [string, SchemaNode]] : [])];
    children.forEach(([name, child], index) => {
      const childPath = [...path, name];
      const hasChildren = Boolean(child.items || Object.keys(child.properties ?? {}).length);
      const key = pathKey(childPath);
      rows.push({ path: childPath, key, node: child, depth, hasChildren, first: index === 0, last: index === children.length - 1 });
      if (hasChildren && !collapsed.has(key)) walk(child, childPath, depth + 1);
    });
  };
  walk(root, [], 0);
  return rows;
}

/** 所有可折叠节点的 key，供“折叠全部”。 */
export function containerKeys(root: SchemaNode): string[] {
  const keys: string[] = [];
  const walk = (node: SchemaNode, path: SchemaPath) => {
    for (const [name, child] of [...Object.entries(node.properties ?? {}), ...(node.items ? [["[]", node.items] as const] : [])]) {
      const childPath = [...path, name];
      if (child.items || Object.keys(child.properties ?? {}).length) keys.push(pathKey(childPath));
      walk(child, childPath);
    }
  };
  walk(root, []);
  return keys;
}

/** JSON Pointer → 路径（只识别 properties / items 段）。 */
export function pathFromPointer(pointer: string, request: boolean): SchemaPath | null {
  const prefix = request ? "/requestSchema" : "/responseSchema";
  if (pointer !== prefix && !pointer.startsWith(prefix + "/")) return null;
  const parts = pointer.slice(prefix.length).split("/").slice(1);
  const path: SchemaPath = [];
  for (let index = 0; index < parts.length; index++) {
    if (parts[index] === "items") path.push("[]");
    else if (parts[index] === "properties" && index + 1 < parts.length) path.push(parts[++index].replaceAll("~1", "/").replaceAll("~0", "~"));
    else break;
  }
  return path;
}
