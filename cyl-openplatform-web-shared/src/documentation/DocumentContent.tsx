import { CopyOutlined } from "@ant-design/icons";
import { Button, Radio } from "antd";
import { useId, useState, type ReactNode } from "react";
import LifecycleDetails, {
  lifecycleStatusNames,
} from "../lifecycle/LifecycleDetails";
import { stringifyJson } from "../json";
import SchemaView from "./SchemaView";
import {
  curlExample,
  documentOperation,
  invocationExampleProblem,
  javaExample,
  okhttpJavaExample,
  okhttpMavenDependency,
  javascriptExample,
  phpExample,
  pythonExample,
  type DocumentOperation,
  type ExampleAuthentication,
  type InvocationLanguage,
} from "./invocationExamples";
import type { ApiDocument } from "./types";
import "./documents.css";

const exampleLanguages = {
  JSON: { label: "JSON", title: "业务请求示例", runtime: "JSON" },
  CURL: { label: "cURL", title: "cURL 调用示例", runtime: "SHELL · TOKEN" },
  JAVASCRIPT: {
    label: "JavaScript",
    title: "JavaScript 调用示例",
    runtime: "NODE.JS 20+",
  },
  PYTHON: {
    label: "Python",
    title: "Python 调用示例",
    runtime: "PYTHON 3 · 标准库",
  },
  PHP: { label: "PHP", title: "PHP 调用示例", runtime: "PHP 8+ · cURL 扩展" },
  JAVA: {
    label: "Java 8+",
    title: "Java 调用示例",
    runtime: "JDK 8+ · OkHttp",
  },
} satisfies Record<
  "JSON" | InvocationLanguage,
  { label: string; title: string; runtime: string }
>;

const responseViews = { BUSINESS: "业务 JSON", COMPLETE: "完整响应 JSON" };

export function CodeExample({
  title,
  language,
  content,
  toolbar,
  problem,
}: {
  title: string;
  language: string;
  content: string;
  toolbar?: ReactNode;
  problem?: string;
}) {
  const [notice, setNotice] = useState<{
    content: string;
    message: string;
  } | null>(null);
  return (
    <div className="op-doc-code">
      <div className="op-doc-code__bar">
        {toolbar ?? <h3 className="op-doc-code__title">{title}</h3>}
        <div className="op-doc-code__meta">
          <span className="op-doc-code__runtime">{language}</span>
          <button
            type="button"
            className="op-doc-code__copy"
            aria-label={`复制${title}`}
            disabled={!!problem}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(content);
                setNotice({ content, message: "已复制。" });
              } catch {
                setNotice({
                  content,
                  message: "复制失败，请选中下方代码手动复制。",
                });
              }
            }}
          >
            <CopyOutlined aria-hidden />
            复制
          </button>
        </div>
      </div>
      {problem ? (
        <p className="op-doc-code__problem" role="status">
          {problem}
        </p>
      ) : (
        <pre className="op-doc-code__pre" tabIndex={0} aria-label={title}>
          <code>{content}</code>
        </pre>
      )}
      {notice?.content === content && !problem && (
        <p className="op-doc-code__notice" role="status">
          {notice.message}
        </p>
      )}
    </div>
  );
}

/** 代码区页签：在深色代码条上切换语言或响应视图，按 aria-pressed 表达当前项。 */
function CodeTabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="op-doc-code__tabs" role="group" aria-label={label}>
      {(Object.keys(options) as T[]).map((key) => (
        <button
          key={key}
          type="button"
          className="op-doc-code__tab"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
        >
          {options[key]}
        </button>
      ))}
    </div>
  );
}

const methodTone = (method: string) => {
  const value = method.toUpperCase();
  return ["GET", "POST", "PUT", "DELETE", "PATCH"].includes(value)
    ? value.toLowerCase()
    : "other";
};

export default function DocumentContent({
  document,
  operation,
  showRawSchema = false,
  showTitle = true,
}: {
  showTitle?: boolean;
  document: ApiDocument;
  operation?: DocumentOperation;
  showRawSchema?: boolean;
}) {
  const authenticationLabel = useId();
  const [pathNotice, setPathNotice] = useState("");
  const [language, setLanguage] = useState<"JSON" | InvocationLanguage>("CURL");
  const [responseView, setResponseView] =
    useState<keyof typeof responseViews>("BUSINESS");
  const [authentication, setAuthentication] =
    useState<ExampleAuthentication>("BEARER");
  const selectedOperation = documentOperation(document, operation);
  const request = stringifyJson(document.requestExample, 2);
  const exampleProblem =
    language === "JSON"
      ? undefined
      : invocationExampleProblem(request, language);
  const selectedLanguage = exampleLanguages[language];
  let example = request;
  if (!exampleProblem) {
    switch (language) {
      case "CURL":
        example = curlExample(document);
        break;
      case "JAVASCRIPT":
        example = javascriptExample(document);
        break;
      case "PYTHON":
        example = pythonExample(document);
        break;
      case "PHP":
        example = phpExample(document);
        break;
      case "JAVA":
        example =
          authentication === "BEARER"
            ? okhttpJavaExample(document)
            : selectedOperation
              ? javaExample(document, selectedOperation, authentication)
              : "";
        break;
    }
  }
  const response = stringifyJson(
    responseView === "COMPLETE"
      ? {
          code: 200,
          resultMsg: "成功",
          data: document.responseExample,
          requestId: "<本次请求标识>",
        }
      : document.responseExample,
    2,
  );
  const lifecycle = document.lifecycle;
  const showLifecycle =
    lifecycle &&
    (lifecycle.status !== "ACTIVE" ||
      lifecycle.compatibility !== "UNSPECIFIED" ||
      [
        lifecycle.compatibilityNotes,
        lifecycle.deprecationNotice,
        lifecycle.replacementVersion,
        lifecycle.sunsetDate,
      ].some((value) => value?.trim()));

  const languageLabels = Object.fromEntries(
    Object.entries(exampleLanguages).map(([key, value]) => [key, value.label]),
  ) as Record<keyof typeof exampleLanguages, string>;
  const fullPath = (document.baseUrl ?? "") + document.path;

  return (
    <div className="op-doc-reader">
      <section
        id="document-overview"
        className="op-doc-reader__section op-doc-reader__overview"
        aria-label="接口概览"
      >
        {showTitle && <h2>{document.title}</h2>}
        {document.description && (
          <p className="op-doc-reader__description">{document.description}</p>
        )}
        <div className="op-doc-reader__endpoint">
          <span className={`op-doc-method op-doc-method--${methodTone(document.httpMethod)}`}>
            {document.httpMethod}
          </span>
          <code>{fullPath}</code>
          <Button
            size="small"
            type="text"
            icon={<CopyOutlined aria-hidden />}
            aria-label="复制请求路径"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(fullPath);
                setPathNotice("请求路径已复制。");
              } catch {
                setPathNotice("复制失败，请选中请求路径手动复制。");
              }
            }}
          >
            复制 URL
          </Button>
        </div>
        {pathNotice && (
          <p role="status" className="op-doc-reader__help">
            {pathNotice}
          </p>
        )}
        <div className="op-doc-reader__facts">
          <span>
            Content-Type：<code>application/json</code>
          </span>
          <span className="op-doc-reader__scopes">
            权限组
            {document.scopeCodes.length ? (
              document.scopeCodes.map((code) => <code key={code}>{code}</code>)
            ) : (
              <span>未声明，请联系维护者确认</span>
            )}
          </span>
        </div>
        <p className="op-doc-reader__help">
          <strong>调用身份要求：</strong>
          {document.employeeRequired
            ? "必须指定调用员工。先在“我的接入”中建立人员委托，再用工号申请人员 Token 或使用人员签名；业务正文中的工号不能代替可信身份。"
            : "允许租户级或人员级调用；仍须满足应用、租户及权限组授权。"}
        </p>
        {showLifecycle && (
          <details
            className="op-doc-reader__lifecycle"
            open={
              lifecycle.status === "DEPRECATED" ||
              lifecycle.status === "RETIRED"
            }
          >
            <summary>
              维护与迁移 · {lifecycleStatusNames[lifecycle.status]}
            </summary>
            <LifecycleDetails lifecycle={lifecycle} />
          </details>
        )}
      </section>

      <section
        id="document-request"
        className="op-doc-reader__section"
        aria-label="请求参数"
      >
        <div className="op-doc-reader__heading">
          <h2>请求参数</h2>
          <span className="op-doc-reader__format">application/json</span>
        </div>
        <SchemaView
          title="请求结构"
          schema={document.requestSchema}
          showRawSchema={showRawSchema}
        />
      </section>

      <section
        id="document-examples"
        className="op-doc-reader__section"
        aria-label="请求示例"
      >
        <div className="op-doc-reader__heading">
          <h2>请求示例</h2>
          <a
            className="op-doc-reader__guide-link"
            href="/portal/?section=guide#guide-sdk"
          >
            接入说明 ↗
          </a>
        </div>
        {language === "JAVA" && (
          <>
            <div className="op-doc-reader__options">
              <span id={authenticationLabel}>认证方式</span>
              <Radio.Group
                size="small"
                optionType="button"
                aria-labelledby={authenticationLabel}
                value={authentication}
                onChange={(event) =>
                  setAuthentication(event.target.value as ExampleAuthentication)
                }
                options={[
                  { value: "BEARER", label: "OkHttp · Bearer Token（推荐）" },
                  { value: "HMAC", label: "HMAC 签名（可选）" },
                ]}
              />
            </div>
            <details className="op-doc-reader__dependency">
              <summary>Maven 依赖 · OkHttp 4.12.0 / JDK 8+</summary>
              <CodeExample
                title="OkHttp Maven 依赖"
                language="XML"
                content={okhttpMavenDependency}
              />
              <p className="op-doc-reader__help">
                加入 pom.xml 的 dependencies。直接使用 OkHttp 接入，无需下载平台
                SDK。
              </p>
            </details>
          </>
        )}
        {language === "JAVA" && authentication === "HMAC" && (
          <p className="op-doc-reader__help">
            保存为 HmacExample.java；JDK 标准库生成签名，OkHttp发送原始正文。使用独立 SigningSecret，核对 HTTP 和业务 code。
            <a href="/portal/?section=guide#hmac-guide">配置与运行步骤 ↗</a>
          </p>
        )}
        <CodeExample
          toolbar={
            <CodeTabs
              label="示例语言"
              value={language}
              options={languageLabels}
              onChange={setLanguage}
            />
          }
          title={selectedLanguage.title}
          language={
            language === "JAVA" && authentication === "HMAC"
              ? "JDK 8+ · OkHttp / HMAC"
              : selectedLanguage.runtime
          }
          problem={
            exampleProblem
              ? `${exampleProblem} 可切换 JSON 查看完整请求。`
              : language === "JAVA" &&
                  authentication === "HMAC" &&
                  !selectedOperation
                ? "当前文档缺少可核对的 POST 操作标识，无法生成 Java 调用。请先确认文档路径与外部服务、版本和操作。"
                : undefined
          }
          content={example}
        />
      </section>

      <section
        id="document-response"
        className="op-doc-reader__section"
        aria-label="响应体"
      >
        <div className="op-doc-reader__heading">
          <h2>响应体</h2>
          <span className="op-doc-reader__format">application/json</span>
        </div>
        <p className="op-doc-reader__help">
          以下为 <code>data</code> 内的业务字段。
          <a href="/portal/?section=guide#guide-response">公共响应格式 →</a>
        </p>
        <SchemaView
          title="业务响应结构"
          schema={document.responseSchema}
          showRawSchema={showRawSchema}
        />
        <CodeExample
          title={responseViews[responseView]}
          language="JSON"
          content={response}
          toolbar={
            <CodeTabs
              label="响应视图"
              value={responseView}
              options={responseViews}
              onChange={setResponseView}
            />
          }
        />
        {responseView === "COMPLETE" && (
          <p className="op-doc-reader__help">
            成功响应的格式示例，并非实际调用结果。<code>code</code> 为 200
            表示本次 API 调用成功；<code>resultMsg</code>{" "}
            仅作说明，请勿通过比较其文案判断成功。
          </p>
        )}
      </section>

      {document.errorDefinitions.length > 0 && (
        <section
          id="document-errors"
          className="op-doc-reader__section"
          aria-label="错误说明"
        >
          <div className="op-doc-reader__heading">
            <h2>错误说明</h2>
          </div>
          <div className="op-doc-reader__table">
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
