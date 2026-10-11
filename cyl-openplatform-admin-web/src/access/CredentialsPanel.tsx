import { Button } from "antd";
import { IdText } from "@cyl/open-platform-web-shared/ui/components";
import type { Credential } from "./api";

/** AppSecret 一次性交付：只在本组件内存中显示，关闭后无法再次查看。 */
export default function CredentialsPanel({
  credential,
  onClose,
}: {
  credential: Credential;
  onClose: () => void;
}) {
  return (
    <section className="credential-secret" role="region" aria-label="一次性应用凭据">
      <h3>凭据已生成 · 请保存 AppSecret</h3>
      <p>AppSecret 仅本次显示；关闭后无法再次查看。保存后可继续绑定租户。</p>
      <dl>
        <dt>AppKey</dt>
        <dd>
          <IdText value={credential.appKey} label="AppKey" maxChars={64} />
        </dd>
        <dt>AppSecret</dt>
        <dd>
          <IdText value={credential.appSecret} label="AppSecret" maxChars={96} />
        </dd>
      </dl>
      <Button type="primary" className="credential-secret__close" onClick={onClose}>
        已妥善保存，关闭凭据
      </Button>
    </section>
  );
}
