import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import type { Binding } from "./BindingEditor";
import type { Mapping } from "./SchemaEditor";
import { mappingLocation, httpBindingTemplate, httpTemplate, hasJsonBody } from "./httpMapping";
import { isIdentityField } from "./sampleSchema";

const scalarTypes: Record<string, string[]> = {
  "java.lang.String": ["STRING"],
  char: ["STRING"],
  "java.lang.Character": ["STRING"],
  boolean: ["BOOLEAN"],
  "java.lang.Boolean": ["BOOLEAN"],
  byte: ["INTEGER"],
  short: ["INTEGER"],
  int: ["INTEGER"],
  long: ["INTEGER"],
  "java.lang.Byte": ["INTEGER"],
  "java.lang.Short": ["INTEGER"],
  "java.lang.Integer": ["INTEGER"],
  "java.lang.Long": ["INTEGER"],
  "java.math.BigInteger": ["INTEGER"],
  float: ["INTEGER", "NUMBER"],
  double: ["INTEGER", "NUMBER"],
  "java.lang.Float": ["INTEGER", "NUMBER"],
  "java.lang.Double": ["INTEGER", "NUMBER"],
  "java.math.BigDecimal": ["INTEGER", "NUMBER"],
};
export function argumentKind(type: string): string[] {
  if (Object.hasOwn(scalarTypes, type)) return scalarTypes[type];
  if (
    type.endsWith("[]") ||
    ["java.util.List", "java.util.Collection", "java.util.Set"].includes(type)
  )
    return ["ARRAY"];
  if (type === "java.lang.Object")
    return ["OBJECT", "ARRAY", "STRING", "INTEGER", "NUMBER", "BOOLEAN"];
  return ["OBJECT"];
}
export function schemaPaths(
  schema: SchemaNode,
  prefix = "",
): { path: string; type: string }[] {
  return Object.entries(schema.properties ?? {}).flatMap(([name, node]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    return [{ path, type: node.type }, ...schemaPaths(node, path)];
  });
}
const overlaps = (a: string, b: string) =>
  a === b || a.startsWith(b + ".") || b.startsWith(a + ".");
export function appendMappings(existing: Mapping[], proposed: Mapping[], binding: Binding) {
  const added: Mapping[] = [],
    skipped: string[] = [];
  for (const mapping of proposed) {
    if (
      mapping.target.split(".").some(isIdentityField) ||
      [...existing, ...added].some((item) =>
        overlaps(item.target, mapping.target) && (binding.protocol !== 'HTTP' || mappingLocation(item, binding.http?.method ?? 'POST') === mappingLocation(mapping, binding.http?.method ?? 'POST')),
      )
    )
      skipped.push(mapping.target);
    else added.push(mapping);
  }
  if (existing.length + added.length > 100)
    throw new Error("补齐后超过100条映射，请缩小范围。");
  return { mappings: [...existing, ...added], added: added.length, skipped };
}
export function proposeMappings(
  schema: SchemaNode,
  binding: Binding,
  selections: Record<string, string> = {},
) {
  const top = Object.keys(schema.properties ?? {});
  if (binding.protocol === "HTTP") {
    const method = binding.http?.method ?? 'POST';
    let variables: string[] = [];
    try { if (binding.http) variables = httpTemplate(httpBindingTemplate(binding.http)).names; } catch { /* 地址问题由绑定与只读预览就近提示。 */ }
    return { mappings: [
      ...variables.filter(name => top.includes(name) && !['OBJECT', 'ARRAY'].includes(schema.properties![name].type)).map(name => ({ target: name, source: 'REQUEST' as const, path: name, location: 'PATH' as const })),
      ...top.map(path => ({ target: path, source: 'REQUEST' as const, path, location: hasJsonBody(method) ? 'BODY' as const : 'QUERY' as const })),
    ], pending: [] as string[] };
  }
  const types = binding.dubbo?.parameterTypes ?? [],
    paths = schemaPaths(schema);
  const mappings: Mapping[] = [],
    pending: string[] = [];
  types.forEach((type, index) => {
    const target = `arg${index}`,
      allowed = argumentKind(type);
    const options = paths.filter((item) => allowed.includes(item.type));
    let selected = selections[target];
    if (
      !selected &&
      types.length === 1 &&
      !allowed.includes("OBJECT") &&
      options.length === 1
    )
      selected = options[0].path;
    if (selected === "$" && allowed.includes("OBJECT"))
      mappings.push(
        ...top.map((path) => ({
          target: `${target}.${path}`,
          source: "REQUEST" as const,
          path,
        })),
      );
    else if (options.some((item) => item.path === selected))
      mappings.push({ target, source: "REQUEST", path: selected });
    else pending.push(target);
  });
  return { mappings, pending };
}
