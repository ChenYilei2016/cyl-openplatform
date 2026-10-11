import { Button, Popover } from "antd";
import { IdText } from "@cyl/open-platform-web-shared/ui/components";

/** 关系编号只用于排障：点开卡片逐项查看与复制，不占用表格与概览的主信息位置。 */
export default function CredentialTechnicalDetails({ records, label = "技术信息" }: { records: readonly (readonly [string, string])[]; label?: string }) {
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      content={
        <dl className="credential-tech" aria-label={label}>
          {records.map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd><IdText value={value} label={name} maxChars={40} /></dd>
            </div>
          ))}
        </dl>
      }
    >
      <Button type="link" size="small" className="credential-tech__trigger">{label}</Button>
    </Popover>
  );
}
