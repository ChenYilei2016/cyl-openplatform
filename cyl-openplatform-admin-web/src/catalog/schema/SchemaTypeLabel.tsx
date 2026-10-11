/** 字段类型：中文名 + 等宽小图标，不再“文本 · STRING”双写。 */
export const schemaTypeMeta: Record<string, { name: string; icon: string }> = {
  OBJECT: { name: "对象", icon: "{ }" },
  ARRAY: { name: "数组", icon: "[ ]" },
  STRING: { name: "文本", icon: "Aa" },
  INTEGER: { name: "整数", icon: "12" },
  NUMBER: { name: "数值", icon: "1.5" },
  BOOLEAN: { name: "是/否", icon: "✓✗" },
};

export default function SchemaTypeLabel({ type }: { type: string }) {
  const meta = schemaTypeMeta[type] ?? { name: type, icon: "?" };
  return (
    <span className="op-schema-type" title={type}>
      <span className={`op-schema-type__icon op-schema-type__icon--${type.toLowerCase()}`} aria-hidden>
        {meta.icon}
      </span>
      {meta.name}
    </span>
  );
}
