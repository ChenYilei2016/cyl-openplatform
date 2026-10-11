import LifecycleDetails, { lifecycleStatusNames } from "@cyl/open-platform-web-shared/lifecycle";
import SchemaView from "@cyl/open-platform-web-shared/documentation/SchemaView";
import {
  curlExample,
  documentOperation,
  invocationExampleProblem,
  javaExample,
  javascriptExample,
  okhttpJavaExample,
  okhttpMavenDependency,
  phpExample,
  pythonExample,
  type InvocationLanguage,
} from "@cyl/open-platform-web-shared/documentation/invocationExamples";
import type { ApiDocument } from "@cyl/open-platform-web-shared/documentation/types";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import CodeBlock, { type CodeSample } from "../shell/CodeBlock";

export const documentSections = [
  { id: "document-overview", title: "概览" },
  { id: "document-request", title: "请求参数" },
  { id: "document-examples", title: "请求与响应示例" },
  { id: "document-response", title: "响应参数" },
  { id: "document-errors", title: "错误码" },
] as const;

type Operation = { service: string; version: string; method: string };

/**
 * 按接口生成可运行示例：网关地址优先用文档声明，其次用平台公开地址，都没有时保留环境变量占位。
 * 示例只引用 OPEN_PLATFORM_TOKEN 等环境变量，不写入任何真实凭据。
 */
export function invocationSamples(document: ApiDocument, gatewayBaseUrl: string, operation?: Operation, withHmac = false): { samples: CodeSample[]; problem?: string } {
  const filled = { ...document, baseUrl: document.baseUrl || gatewayBaseUrl || null };
  const request = stringifyJson(document.requestExample, 2);
  const builders: [string, CodeSample["language"], InvocationLanguage, () => string][] = [
    ["cURL", "bash", "CURL", () => curlExample(filled)],
    ["Java", "java", "JAVA", () => okhttpJavaExample(filled)],
    ["Python", "python", "PYTHON", () => pythonExample(filled)],
    ["JavaScript", "javascript", "JAVASCRIPT", () => javascriptExample(filled)],
    ["PHP", "text", "PHP", () => phpExample(filled)],
  ];
  const selected = withHmac ? documentOperation(filled, operation) : undefined;
  if (selected) builders.push(["Java · HMAC", "java", "JAVA", () => javaExample(filled, selected, "HMAC")]);
  const samples: CodeSample[] = [];
  let problem: string | undefined;
  for (const [label, language, kind, build] of builders) {
    const reason = invocationExampleProblem(request, kind);
    if (reason) problem ??= reason;
    else samples.push({ label, language, code: build() });
  }
  return { samples, problem };
}

/** 门户 API 文档正文（115）：概览、参数表、并排的请求与响应示例、错误码。阅读区随浅/深色主题切换，代码块保持深色。 */
export default function PortalDocumentBody({ document, operation, gatewayBaseUrl }: { document: ApiDocument; operation: Operation; gatewayBaseUrl: string }) {
  const request = invocationSamples(document, gatewayBaseUrl, operation, true);
  // 业务 JSON 放在最前，默认仍打开 cURL（与管理端文档预览一致）。
  const requestSamples: CodeSample[] = [{ label: "JSON", language: "json", code: stringifyJson(document.requestExample, 2) }, ...request.samples];
  const responseSamples: CodeSample[] = [
    { label: "业务 JSON", language: "json", code: stringifyJson(document.responseExample, 2) },
    { label: "完整响应", language: "json", code: stringifyJson({ code: 200, resultMsg: "成功", data: document.responseExample, requestId: "<本次请求标识>" }, 2) },
  ];
  const lifecycle = document.lifecycle;
  const showLifecycle =
    lifecycle &&
    (lifecycle.status !== "ACTIVE" ||
      lifecycle.compatibility !== "UNSPECIFIED" ||
      [lifecycle.compatibilityNotes, lifecycle.deprecationNotice, lifecycle.replacementVersion, lifecycle.sunsetDate].some((value) => value?.trim()));
  return (
    <div className="op-doc__body">
      <section id="document-overview" className="op-doc__section" aria-label="接口概览">
        <h2>概览</h2>
        {document.description && <p className="op-doc__description">{document.description}</p>}
        <dl className="op-doc__facts">
          <div>
            <dt>Content-Type</dt>
            <dd>
              <code>application/json</code>
            </dd>
          </div>
          <div>
            <dt>权限组</dt>
            <dd>{document.scopeCodes.length ? document.scopeCodes.map((code) => <code key={code}>{code}</code>) : "未声明，请联系维护者确认"}</dd>
          </div>
          <div>
            <dt>{document.mcp ? "普通 API 调用身份" : "调用身份"}</dt>
            <dd>
              {document.employeeRequired
                ? "必须指定调用员工：先在“我的接入”建立人员委托，再用工号申请人员 Token 或使用人员签名；业务正文中的工号不能代替可信身份。"
                : "租户级或人员级调用均可；仍须满足应用、租户及权限组授权。"}
            </dd>
          </div>
        </dl>
        {showLifecycle && (
          <details className="op-doc__lifecycle" open={lifecycle.status !== "ACTIVE"}>
            <summary>维护与迁移 · {lifecycleStatusNames[lifecycle.status]}</summary>
            <LifecycleDetails lifecycle={lifecycle} />
          </details>
        )}
      </section>

      <section id="document-request" className="op-doc__section" aria-label="请求参数">
        <div className="op-doc__section-heading">
          <h2>请求参数</h2>
          <code className="op-doc__format">application/json</code>
        </div>
        <SchemaView title="请求结构" schema={document.requestSchema} showRawSchema={false} />
      </section>

      <section id="document-examples" className="op-doc__section" aria-label="请求与响应示例">
        <div className="op-doc__section-heading">
          <h2>请求与响应示例</h2>
          <a href="?section=guide#guide-sdk">接入说明 ↗</a>
        </div>
        {!gatewayBaseUrl && !document.baseUrl && <p className="op-doc__help">示例中的网关地址读取 OPEN_PLATFORM_BASE_URL 环境变量；Token 均读取 OPEN_PLATFORM_TOKEN。</p>}
        <div className="op-doc__examples">
          <CodeBlock title="请求" samples={requestSamples} initialLabel="cURL" maxHeight={480} />
          <CodeBlock title="响应" samples={responseSamples} maxHeight={480} />
        </div>
        {request.problem && (
          <p className="op-doc__help" role="status">
            {request.problem} 可切换 JSON 查看完整请求。
          </p>
        )}
        <p className="op-doc__help">“完整响应”是成功响应的格式示例，并非实际调用结果。code 为 200 表示调用成功；请勿通过比较 resultMsg 文案判断成功。</p>
        <details className="op-doc__dependency">
          <summary>Java 依赖：OkHttp 4.12.0 / JDK 8+</summary>
          <CodeBlock samples={[{ label: "Maven", language: "text", code: okhttpMavenDependency }]} />
          <p className="op-doc__help">
            加入 pom.xml 的 dependencies，直接使用 OkHttp 接入，无需下载平台 SDK。HMAC 签名请使用独立 SigningSecret，见 <a href="?section=guide#hmac-guide">配置与运行步骤</a>。
          </p>
        </details>
      </section>

      <section id="document-response" className="op-doc__section" aria-label="响应参数">
        <div className="op-doc__section-heading">
          <h2>响应参数</h2>
          <code className="op-doc__format">application/json</code>
        </div>
        <p className="op-doc__help">
          以下为 <code>data</code> 内的业务字段。<a href="?section=guide#guide-response">公共响应格式 →</a>
        </p>
        <SchemaView title="业务响应结构" schema={document.responseSchema} showRawSchema={false} />
      </section>

      {document.errorDefinitions.length > 0 && (
        <section id="document-errors" className="op-doc__section" aria-label="错误码">
          <h2>错误码</h2>
          <div className="op-doc__table">
            <table>
              <thead>
                <tr>
                  <th>业务错误码</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {document.errorDefinitions.map((error, index) => (
                  <tr key={index}>
                    <td>
                      <code>{error.code}</code>
                    </td>
                    <td>
                      {error.message}
                      {error.description && <p>{error.description}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
