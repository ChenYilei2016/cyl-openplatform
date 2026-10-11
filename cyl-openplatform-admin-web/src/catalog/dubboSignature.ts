const identifier = '[a-zA-Z_$][a-zA-Z0-9_$]*';
const className = new RegExp(`^${identifier}(?:\\.${identifier})+$`);
const javaType = new RegExp(`^(?:boolean|byte|short|int|long|float|double|char|${identifier}(?:\\.${identifier})+)(?:\\[\\])*$`);

/** 与已保存绑定相同的名称/类型/数量边界；解析不联网、不补版本或连接。 */
export function parseDubboSignature(text: string): { interfaceName: string; method: string; parameterTypes: string[] } {
  if (text.length > 5000) throw new Error('签名过长，请缩小到一个接口方法。');
  if (/[<>]/.test(text)) throw new Error('请先擦除泛型，例如使用 java.util.List，不填写 List<Order>。');
  const match = text.trim().match(/^(.+)[#.]([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^()]*)\)$/);
  if (!match || !className.test(match[1].trim())) throw new Error('使用全限定接口名#方法(类型, 类型) 或全限定接口名.方法(类型)。');
  const interfaceName = match[1].trim(), method = match[2];
  const parameterTypes = match[3].trim() ? match[3].split(',').map(value => value.trim()) : [];
  if (interfaceName.length > 200 || method.length > 100 || parameterTypes.length > 20)
    throw new Error('接口最多200字符、方法最多100字符、参数最多20项。');
  const invalid = parameterTypes.findIndex(value => value.length > 200 || !javaType.test(value));
  if (invalid >= 0) throw new Error(`arg${invalid} 类型不合法，请使用完整Java类型或基本类型；数组写作 java.lang.String[]。`);
  return { interfaceName, method, parameterTypes };
}
