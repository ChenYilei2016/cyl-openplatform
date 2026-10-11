import { stringifyJson } from '../json';
import type { ApiDocument } from './types';

export interface DocumentOperation { service: string; version: string; method: string }
export type ExampleAuthentication = 'BEARER' | 'HMAC';
export type InvocationLanguage = 'CURL' | 'JAVA' | 'JAVASCRIPT' | 'PYTHON' | 'PHP';

/** 不截断业务示例；过大的示例须先由调用方缩小为一次请求。 */
export function invocationExampleProblem(request: string, language: InvocationLanguage): string | undefined {
  if (new TextEncoder().encode(request).byteLength > 64 * 1024) {
    return '当前业务请求示例超过 64 KiB，无法生成可执行调用示例。请先缩小业务参数或批量规模；上方原始示例完整保留。';
  }
  if (language === 'JAVA') {
    let constantBytes = 0;
    for (let index = 0; index < request.length; index++) {
      const unit = request.charCodeAt(index);
      constantBytes += unit >= 1 && unit <= 0x7f ? 1 : unit <= 0x7ff ? 2 : 3;
    }
    // Java 常量池使用 modified UTF-8，补充字符的计数与请求 UTF-8 不同。
    if (constantBytes > 60 * 1024) return '当前请求超出 Java 示例的内联字符串安全范围，无法生成代码。请先缩小业务示例，或在应用中从文件读取请求；上方原始示例完整保留。';
  }
}

/** 旧的后台调用方只有文档路径；仅接受 SDK 支持的完整操作标识。 */
export function documentOperation(document: ApiDocument, operation?: DocumentOperation): DocumentOperation | undefined {
  const match = /^\/api\/oauth\/([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,31})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,63})$/.exec(document.path);
  if (document.httpMethod !== 'POST' || !match) return undefined;
  const result = { service: match[1], version: match[2], method: match[3] };
  return !operation || (operation.service === result.service && operation.version === result.version && operation.method === result.method) ? result : undefined;
}

export const shellLiteral = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;

export function curlExample(document: ApiDocument): string {
  const problem = invocationExampleProblem(stringifyJson(document.requestExample, 2), 'CURL');
  if (problem) throw new Error(problem);
  const url = document.baseUrl ? shellLiteral(document.baseUrl.replace(/\/+$/, '') + document.path) : `"\${OPEN_PLATFORM_BASE_URL%/}"${shellLiteral(document.path)}`;
  return `# 将 OPEN_PLATFORM_TOKEN 设置为已获取的 accessToken。
printf '%s' ${shellLiteral(stringifyJson(document.requestExample, 2))} | \\
  curl --silent --show-error --connect-timeout 3 --max-time 10 \\
    --request ${shellLiteral(document.httpMethod)} \\
    --url ${url} \\
    --header "Authorization: Bearer \${OPEN_PLATFORM_TOKEN}" \\
    --header 'Content-Type: application/json' \\
    --include --data-binary @-`;
}

export function javascriptExample(document: ApiDocument): string {
  const request = stringifyJson(document.requestExample, 2);
  const problem = invocationExampleProblem(request, 'JAVASCRIPT');
  if (problem) throw new Error(problem);
  return `// Node.js 20+，仅在服务端运行；通过安全运行配置提供网关地址和业务 Token。
async function main() {
  const baseUrl = ${document.baseUrl ? stringifyJson(document.baseUrl) : "process.env.OPEN_PLATFORM_BASE_URL"};
  const token = process.env.OPEN_PLATFORM_TOKEN;
  if (!baseUrl || !token || /[\\r\\n]/.test(token)) {
    throw new Error("请配置有效的 OPEN_PLATFORM_BASE_URL 和 OPEN_PLATFORM_TOKEN");
  }
  const url = new URL(baseUrl.replace(/\\/+$/, "") + ${stringifyJson(document.path)});
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("网关地址只允许 HTTP(S) 地址及 contextPath");
  }
  // 直接发送 JSON 文本，避免 JavaScript 数值转换损失精度。
  const body = ${stringifyJson(request)};
  const response = await fetch(url, {
    method: ${stringifyJson(document.httpMethod)},
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(10_000),
    redirect: "error"
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    console.error("调用未成功，HTTP=" + response.status);
    process.exitCode = 1;
    return;
  }
  const responseJson = await response.text();
  // 按本页响应契约处理 responseJson，业务结果位于 data 中。
}

main().catch(() => {
  console.error("调用失败，请检查安全运行配置、网络及超时；请勿直接重试写操作。");
  process.exitCode = 1;
});`;
}

export function pythonExample(document: ApiDocument): string {
  const request = stringifyJson(document.requestExample, 2);
  const problem = invocationExampleProblem(request, 'PYTHON');
  if (problem) throw new Error(problem);
  return `# Python 3，仅使用标准库；通过安全运行配置提供网关地址和业务 Token。
import http.client
import os
from urllib.parse import urlsplit


def main():
    base_url = ${document.baseUrl ? stringifyJson(document.baseUrl) : 'os.environ["OPEN_PLATFORM_BASE_URL"]'}
    token = os.environ["OPEN_PLATFORM_TOKEN"]
    if not base_url or not token or "\\r" in token or "\\n" in token:
        raise ValueError("请配置有效的网关地址和业务 Token")
    url = urlsplit(base_url.rstrip("/") + ${stringifyJson(document.path)})
    if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError("网关地址只允许 HTTP(S) 地址及 contextPath")
    # 直接发送 JSON 文本，保留大整数和小数的原始精度。
    body = ${stringifyJson(request)}.encode("utf-8")
    connection_type = http.client.HTTPSConnection if url.scheme == "https" else http.client.HTTPConnection
    connection = connection_type(url.hostname, url.port, timeout=10)
    try:
        # 单次连接/读写超时 10 秒；不自动跟随重定向或重试。
        connection.request(${stringifyJson(document.httpMethod)}, url.path, body=body, headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        })
        response = connection.getresponse()
        if response.status != 200:
            raise SystemExit("调用未成功，HTTP=" + str(response.status))
        response_json = response.read().decode("utf-8")
        # 按本页响应契约处理 response_json，业务结果位于 data 中。
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("调用失败，请检查安全运行配置、网络及超时；请勿直接重试写操作。") from None`;
}

export function phpExample(document: ApiDocument): string {
  const request = stringifyJson(document.requestExample, 2);
  const problem = invocationExampleProblem(request, 'PHP');
  if (problem) throw new Error(problem);
  const phpLiteral = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  return `<?php
// PHP 8+，需启用 cURL 扩展；通过安全运行配置提供网关地址和业务 Token。
$baseUrl = ${document.baseUrl ? phpLiteral(document.baseUrl) : "getenv('OPEN_PLATFORM_BASE_URL')"};
$token = getenv('OPEN_PLATFORM_TOKEN');
if ($baseUrl === false || $baseUrl === '' || $token === false || $token === '' || strpbrk($token, "\\r\\n") !== false) {
    throw new RuntimeException('请配置有效的 OPEN_PLATFORM_BASE_URL 和 OPEN_PLATFORM_TOKEN');
}
$url = rtrim($baseUrl, '/') . ${phpLiteral(document.path)};
$parts = parse_url($url);
if ($parts === false || !in_array($parts['scheme'] ?? '', ['http', 'https'], true) || empty($parts['host'])
    || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) {
    throw new RuntimeException('网关地址只允许 HTTP(S) 地址及 contextPath');
}
// 直接发送 JSON 文本，保留原始数值；单引号字符串不会展开业务参数。
$body = ${phpLiteral(request)};
$client = curl_init($url);
if ($client === false) {
    throw new RuntimeException('无法初始化 HTTP 客户端');
}
try {
    if (!curl_setopt_array($client, [
        CURLOPT_CUSTOMREQUEST => ${phpLiteral(document.httpMethod)},
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token, 'Content-Type: application/json'],
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,
    ])) {
        throw new RuntimeException('无法配置 HTTP 请求');
    }
    $responseJson = curl_exec($client);
    if ($responseJson === false) {
        throw new RuntimeException('调用失败，请检查网络及超时；请勿直接重试写操作。');
    }
    $status = curl_getinfo($client, CURLINFO_HTTP_CODE);
    if ($status !== 200) {
        throw new RuntimeException('调用未成功，HTTP=' . $status);
    }
    // 按本页响应契约处理 $responseJson，业务结果位于 data 中。
} finally {
    curl_close($client);
}`;
}

export const okhttpMavenDependency = `<dependency>
    <groupId>com.squareup.okhttp3</groupId>
    <artifactId>okhttp</artifactId>
    <version>4.12.0</version>
</dependency>`;

export function okhttpJavaExample(document: Pick<ApiDocument, 'path' | 'httpMethod' | 'requestExample' | 'baseUrl'>, authentication: ExampleAuthentication = 'BEARER'): string {
  const hmac = authentication === 'HMAC';
  const request = stringifyJson(document.requestExample, 2);
  const problem = invocationExampleProblem(request, 'JAVA');
  if (problem) throw new Error(problem);
  const body = request.split('\n')
    .map((line, index, lines) => stringifyJson(line + (index < lines.length - 1 ? '\n' : ''))).join('\n                + ');
  const credentials = hmac ? `String keyId = System.getenv("OPEN_PLATFORM_KEY_ID");
            String signingSecret = System.getenv("OPEN_PLATFORM_SIGNING_SECRET");
            String tenantId = System.getenv("OPEN_PLATFORM_TENANT_ID");
            String employeeNo = System.getenv("OPEN_PLATFORM_EMPLOYEE_NO");
            if (employeeNo != null && employeeNo.isEmpty()) employeeNo = null;
            String subjectPattern = "[\\\\x21-\\\\x2B\\\\x2D-\\\\x7E]{1,64}";
            if (keyId == null || !keyId.matches("[a-f0-9]{32}")
                    || signingSecret == null || !signingSecret.matches("[A-Za-z0-9_-]{43}")
                    || tenantId == null || !tenantId.matches(subjectPattern)
                    || employeeNo != null && !employeeNo.matches(subjectPattern)) {
                throw new IllegalArgumentException("请配置有效的 KEY_ID、SIGNING_SECRET、TENANT_ID 和可选员工号");
            }
            byte[] secret = Base64.getUrlDecoder().decode(signingSecret);
            if (secret.length != 32 || !Base64.getUrlEncoder().withoutPadding().encodeToString(secret).equals(signingSecret)) {
                throw new IllegalArgumentException("SigningSecret 必须是32字节的规范Base64URL");
            }` : `String token = System.getenv("OPEN_PLATFORM_TOKEN");
            if (token == null || token.isEmpty() || token.contains("\\r") || token.contains("\\n")) {
                throw new IllegalArgumentException("请配置有效的 OPEN_PLATFORM_TOKEN");
            }`;
  const signing = hmac ? `
            String bodyHash = String.format("%064x", new BigInteger(1, MessageDigest.getInstance("SHA-256").digest(bodyBytes)));
            String timestamp = Long.toString(Instant.now().getEpochSecond());
            String nonce = UUID.randomUUID().toString().replace("-", "");
            // 无员工时保留空行；路径包含部署前缀，正文摘要取自实际发送的UTF-8字节。
            String canonical = String.join("\\n", "SZ-HMAC-SHA256", "POST", url.encodedPath(), keyId,
                    tenantId, employeeNo == null ? "" : employeeNo, timestamp, nonce, bodyHash);
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            String signature = String.format("%064x", new BigInteger(1, mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8))));` : '';
  return `${hmac ? `import java.math.BigInteger;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
` : ''}import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okio.BufferedSink;

// JDK 8+；添加 OkHttp Maven 依赖即可运行。
public final class ${hmac ? 'HmacExample' : 'ApiExample'} {
    // 应用服务中由 Bean 等方式管理并复用客户端，在应用关闭时统一释放资源。
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
            .connectTimeout(3, TimeUnit.SECONDS)
            .callTimeout(10, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .followRedirects(false)
            .followSslRedirects(false)
            .build();

    public static void main(String[] args) throws Exception {
        try {
            String baseUrl = ${document.baseUrl ? stringifyJson(document.baseUrl) : 'System.getenv("OPEN_PLATFORM_BASE_URL")'};
            if (baseUrl == null || baseUrl.isEmpty()) {
                throw new IllegalArgumentException("请配置 OPEN_PLATFORM_BASE_URL");
            }
            ${credentials}
            HttpUrl url = HttpUrl.get(baseUrl.replaceAll("/+$", "") + ${stringifyJson(document.path)});
            if (!url.username().isEmpty() || !url.password().isEmpty()
                    || url.query() != null || url.fragment() != null) {
                throw new IllegalArgumentException("网关地址只允许 HTTP(S) 地址及 contextPath");
            }
            // 直接发送 JSON 文本，保留大整数、小数和正文空白。
            String json = ${body};
            byte[] bodyBytes = json.getBytes(StandardCharsets.UTF_8);${signing}
            Request.Builder builder = new Request.Builder()
                    .url(url)
                    ${hmac ? `.header("Authorization", "SZ-HMAC-SHA256 " + keyId + ":" + signature)
                    .header("X-SZ-Tenant", tenantId)
                    .header("X-SZ-Timestamp", timestamp)
                    .header("X-SZ-Nonce", nonce)` : '.header("Authorization", "Bearer " + token)'}
                    .method(${stringifyJson(document.httpMethod)}, new RequestBody() {
                        @Override public MediaType contentType() { return MediaType.get("application/json; charset=utf-8"); }
                        @Override public long contentLength() { return bodyBytes.length; }
                        // 禁用503 Retry-After: 0等HTTP层跟进重发；写请求须显式核对执行结果。
                        @Override public boolean isOneShot() { return true; }
                        @Override public void writeTo(BufferedSink sink) throws IOException { sink.write(bodyBytes); }
                    });
            ${hmac ? 'if (employeeNo != null) builder.header("X-SZ-Employee", employeeNo);\n            ' : ''}Request request = builder.build();
            try (Response response = CLIENT.newCall(request).execute()) {
                if (response.code() != 200) {
                    throw new IllegalStateException("调用未成功，HTTP=" + response.code());
                }
                String responseJson = response.body().string();
                // 按本页响应契约处理 responseJson，业务结果位于 data 中；避免直接打印敏感数据。
                ${hmac ? 'System.out.println("平台响应 HTTP " + response.code() + "；请用项目JSON工具校验responseJson的code和data。");' : ''}
            }
        } finally {
            // 仅供独立 main 示例退出使用，应用服务中不要每次请求后关闭共享客户端。
            CLIENT.dispatcher().executorService().shutdown();
            CLIENT.connectionPool().evictAll();
        }
    }
}`;
}

export function javaExample(document: ApiDocument, operation: DocumentOperation, authentication: ExampleAuthentication): string {
  if (authentication === 'HMAC') return okhttpJavaExample({ ...document,
    path: `/api/sign/${operation.service}/${operation.version}/${operation.method}`, httpMethod: 'POST' }, 'HMAC');
  const problem = invocationExampleProblem(stringifyJson(document.requestExample, 2), 'JAVA');
  if (problem) throw new Error(problem);
  const constructor = `new OpenPlatformClient(URI.create(baseUrl),\n                System.getenv("OPEN_PLATFORM_TOKEN"))`;
  // 按 JSON 文本逐行转义为 Java 字面量，保留原始大数及正文空白。
  const body = stringifyJson(document.requestExample, 2).split('\n')
    .map((line, index, lines) => stringifyJson(line + (index < lines.length - 1 ? '\n' : ''))).join('\n                + ');
  return `import io.github.chenyilei2016.openplatform.client.OpenPlatformClient;
import java.net.URI;

public final class ApiExample {
    public static void main(String[] args) throws Exception {
        String baseUrl = ${document.baseUrl ? stringifyJson(document.baseUrl) : 'System.getenv("OPEN_PLATFORM_BASE_URL")'};
        if (baseUrl == null || baseUrl.isEmpty()) {
            throw new IllegalArgumentException("请配置 OPEN_PLATFORM_BASE_URL");
        }
        String json = ${body};
        // 应用服务中复用客户端；此独立示例结束时释放连接。
        try (OpenPlatformClient client = ${constructor}) {
            OpenPlatformClient.Response result = client.invoke(
                    ${stringifyJson(operation.service)}, ${stringifyJson(operation.version)}, ${stringifyJson(operation.method)}, json);
            if (result.statusCode() != 200) {
                throw new IllegalStateException("调用未成功，HTTP=" + result.statusCode()
                        + ", requestId=" + result.requestId());
            }
            String responseJson = result.body();
            // 按本页响应契约处理 responseJson，业务结果位于 data 中。
        }
    }
}`;
}
