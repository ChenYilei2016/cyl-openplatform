import type { ApiDocument } from '@cyl/open-platform-web-shared/documentation/types';
import { curlExample, javascriptExample, okhttpJavaExample, okhttpMavenDependency, pythonExample, shellLiteral } from '@cyl/open-platform-web-shared/documentation/invocationExamples';
import type { CodeSample } from '../shell/CodeBlock';

/** 指南示例统一使用的虚构订单查询；实际接入请复制对应 API 文档中的示例。 */
const sampleBody = { orderNo: 'COMMON-001' };

const tokenPayload = (employee: boolean) => ({ appKey: '<AK>', appSecret: '<APP_SECRET>', tenantId: '<TENANT_ID>', ...(employee ? { employeeNo: '<EMPLOYEE_NO>' } : {}) });

export const tokenRequest = (employee = false) => JSON.stringify(tokenPayload(employee), null, 2);

export const tokenResponse = (employee = false) => JSON.stringify({
  code: 200,
  resultMsg: '成功',
  data: {
    accessToken: '<TOKEN>',
    tokenType: 'Bearer',
    expiresAt: '<UTC 到期时间>',
    expiresIn: 604800,
    context: { tenantId: '<TENANT_ID>', scopeCodes: ['orders.read'], ...(employee ? { employeeNo: '<EMPLOYEE_NO>', employeeId: '<服务端核验的人员 ID>', userId: '<服务端核验的账号 ID>' } : {}) },
  },
  requestId: '<本次请求标识>',
}, null, 2);

/** OkHttp 4.12.0：Java 示例、HMAC 示例与平台 SDK 共用的运行依赖。Maven 文本复用共享生成函数。 */
export const okhttpCoordinates: CodeSample[] = [
  { label: 'Maven', language: 'text', code: okhttpMavenDependency },
  { label: 'Gradle (Kotlin)', language: 'text', code: 'implementation("com.squareup.okhttp3:okhttp:4.12.0")' },
  { label: 'Gradle (Groovy)', language: 'text', code: "implementation 'com.squareup.okhttp3:okhttp:4.12.0'" },
];

const sampleDocument = (baseUrl: string, path: string): ApiDocument => ({
  id: 'guide-sample', draftRevision: 1, title: '订单查询（示例）', path, httpMethod: 'POST', scopeCodes: ['orders.read'],
  requestSchema: { type: 'OBJECT' }, responseSchema: { type: 'OBJECT' }, errorDefinitions: [],
  requestExample: sampleBody, responseExample: {}, baseUrl: baseUrl || null,
});

/** 网关地址可读时直接写入示例；读不到时保留 OPEN_PLATFORM_BASE_URL 环境变量占位。 */
export function guideExamples(baseUrl = '', employee = false) {
  const base = baseUrl.replace(/\/+$/, '');
  const endpoint = (path: string) => base ? shellLiteral(base + path) : `"\${OPEN_PLATFORM_BASE_URL%/}${path}"`;
  const pythonBase = base ? JSON.stringify(base) : 'os.environ["OPEN_PLATFORM_BASE_URL"]';
  const javascriptBase = base ? JSON.stringify(base) : 'process.env.OPEN_PLATFORM_BASE_URL';
  const invokeDocument = sampleDocument(base, '/api/oauth/orders/v1/query');

  const environment = `# 由安全运行配置注入，不要写进源码或提交到代码仓库。
export OPEN_PLATFORM_BASE_URL=${base ? shellLiteral(base) : "'<网关基地址，向平台维护者确认>'"}
export OPEN_PLATFORM_APP_KEY='<AK>'
export OPEN_PLATFORM_APP_SECRET='<APP_SECRET>'
export OPEN_PLATFORM_TENANT_ID='<TENANT_ID>'
# 用户级 Token 另需已获委托员工的工号：
# export OPEN_PLATFORM_EMPLOYEE_NO='<EMPLOYEE_NO>'`;

  const curlToken = `# token-request.json 填写上面的请求正文；不要提交到代码仓库。
curl --silent --show-error --connect-timeout 3 --max-time 10 \\
  --request POST ${endpoint('/api/token')} \\
  --header 'Content-Type: application/json' \\
  --data-binary @token-request.json`;

  const pythonToken = `# Python 3，仅使用标准库；凭据由安全运行配置提供。
import http.client
import json
import os
from urllib.parse import urlsplit


def main():
    url = urlsplit(${pythonBase}.rstrip("/") + "/api/token")
    payload = {
        "appKey": os.environ["OPEN_PLATFORM_APP_KEY"],
        "appSecret": os.environ["OPEN_PLATFORM_APP_SECRET"],
        "tenantId": os.environ["OPEN_PLATFORM_TENANT_ID"],
    }${employee ? `
    payload["employeeNo"] = os.environ["OPEN_PLATFORM_EMPLOYEE_NO"]` : ''}
    connection_type = http.client.HTTPSConnection if url.scheme == "https" else http.client.HTTPConnection
    connection = connection_type(url.hostname, url.port, timeout=10)
    try:
        connection.request("POST", url.path, body=json.dumps(payload).encode("utf-8"),
                           headers={"Content-Type": "application/json"})
        response = connection.getresponse()
        result = json.loads(response.read().decode("utf-8"))
    finally:
        connection.close()
    if response.status != 200 or result.get("code") != 200:
        raise SystemExit("获取 Token 未成功，HTTP=%s code=%s requestId=%s"
                         % (response.status, result.get("code"), result.get("requestId")))
    access_token = result["data"]["accessToken"]
    # 在可信进程内缓存并复用 access_token；不要打印或写入日志。


if __name__ == "__main__":
    main()`;

  const javascriptToken = `// Node.js 20+，仅在服务端运行；凭据由安全运行配置提供。
async function main() {
  const baseUrl = ${javascriptBase};
  const response = await fetch(baseUrl.replace(/\\/+$/, "") + "/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appKey: process.env.OPEN_PLATFORM_APP_KEY,
      appSecret: process.env.OPEN_PLATFORM_APP_SECRET,
      tenantId: process.env.OPEN_PLATFORM_TENANT_ID,${employee ? `
      employeeNo: process.env.OPEN_PLATFORM_EMPLOYEE_NO,` : ''}
    }),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  const result = await response.json();
  if (response.status !== 200 || result.code !== 200) {
    throw new Error(\`获取 Token 未成功，HTTP=\${response.status} code=\${result.code} requestId=\${result.requestId}\`);
  }
  const accessToken = result.data.accessToken;
  // 在可信进程内缓存并复用 accessToken；不要打印或写入日志。
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});`;

  const bearerRequest = `POST ${base || '<网关基地址>'}/api/oauth/orders/v1/query
Authorization: Bearer <TOKEN>
Content-Type: application/json

{ "orderNo": "COMMON-001" }`;

  const signedRequest = `POST ${base || '<网关基地址>'}/api/sign/orders/v1/query
Authorization: SZ-HMAC-SHA256 <KEY_ID>:<SIGNATURE>
X-SZ-Tenant: <TENANT_ID>
X-SZ-Timestamp: <UTC_SECONDS>
X-SZ-Nonce: <RANDOM_NONCE>
Content-Type: application/json

{ "orderNo": "COMMON-001" }`;

  const javaExample = okhttpJavaExample({ baseUrl: base, path: '/api/oauth/orders/v1/query', httpMethod: 'POST', requestExample: sampleBody });
  const hmacJavaExample = okhttpJavaExample({ baseUrl: base, path: '/api/sign/orders/v1/query', httpMethod: 'POST', requestExample: sampleBody }, 'HMAC');

  const tokenSamples: CodeSample[] = [
    { label: '请求 JSON', language: 'json', code: tokenRequest(employee) },
    { label: 'cURL', language: 'bash', code: curlToken },
    { label: 'Python', language: 'python', code: pythonToken },
    { label: 'Node.js', language: 'javascript', code: javascriptToken },
  ];
  const invokeSamples: CodeSample[] = [
    { label: 'cURL', language: 'bash', code: curlExample(invokeDocument) },
    { label: 'Java', language: 'java', code: javaExample },
    { label: 'Python', language: 'python', code: pythonExample(invokeDocument) },
    { label: 'Node.js', language: 'javascript', code: javascriptExample(invokeDocument) },
    { label: 'HTTP', language: 'text', code: bearerRequest },
  ];
  const signatureSamples: CodeSample[] = [
    { label: 'Java', language: 'java', code: hmacJavaExample },
    { label: 'HTTP', language: 'text', code: signedRequest },
  ];
  return { environment, curlToken, tokenSamples, invokeSamples, signatureSamples, bearerRequest, javaExample, hmacJavaExample };
}

/** 依赖准备好后在已有 Maven 项目目录中编译运行（类名对应示例）。 */
export const runCommands = (className: string) => `mvn dependency:copy-dependencies
javac -encoding UTF-8 -cp "target/dependency/*" ${className}.java
java -cp ".:target/dependency/*" ${className}`;
