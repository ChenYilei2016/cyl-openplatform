package io.github.chenyilei2016.openplatform.client;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.MediaType;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.ResponseBody;
import okio.BufferedSink;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Java8+，复用一个客户端；认证信息固定于实例，不包含公司或提供方依赖。 */
public final class OpenPlatformClient implements AutoCloseable {
    private static final int MAX_REQUEST_BYTES = 64 * 1024;
    private static final int MAX_RESPONSE_BYTES = 512 * 1024;
    private final URI baseUri;
    private final String token;
    private final SigningCredentials signing;
    private final OkHttpClient client;
    private final AtomicBoolean closed = new AtomicBoolean();
    private final Semaphore calls = new Semaphore(8);

    public OpenPlatformClient(URI baseUri, String token) {
        this(baseUri, token, null);
    }

    /** 使用独立签名密钥；tenant/employee只选择目标授权范围，不能自行授予权限。 */
    public static OpenPlatformClient signed(URI baseUri, String keyId, String signingSecret, String tenantId, String employeeNo) {
        return new OpenPlatformClient(baseUri, null, new SigningCredentials(keyId, signingSecret, tenantId, employeeNo));
    }

    private OpenPlatformClient(URI baseUri, String token, SigningCredentials signing) {
        if (baseUri == null) throw new IllegalArgumentException("网关地址不能为空");
        String host = baseUri.getHost();
        boolean localHttp = host != null && "http".equals(baseUri.getScheme()) && Arrays.asList("127.0.0.1", "localhost", "[::1]").contains(host);
        if (host == null || !("https".equals(baseUri.getScheme()) || localHttp)
                || baseUri.getRawUserInfo() != null || baseUri.getRawQuery() != null || baseUri.getRawFragment() != null) {
            throw new IllegalArgumentException("网关地址必须为HTTPS或本机HTTP，不能含凭据、查询或片段");
        }
        if (signing == null && (token == null || !token.matches("[A-Za-z0-9._~-]{1,128}"))) throw new IllegalArgumentException("业务Token格式不合法");
        String path = baseUri.getRawPath();
        if (signing != null && (path.contains("%") || path.contains(";") || path.contains("//")
                || path.matches(".*(?:^|/)\\.\\.?(?:/|$).*"))) {
            throw new IllegalArgumentException("签名网关路径不能包含编码、空段或点段");
        }
        this.baseUri = URI.create(baseUri.toString().endsWith("/") ? baseUri.toString() : baseUri + "/");
        this.token = token;
        this.signing = signing;
        this.client = new OkHttpClient.Builder().connectTimeout(3, TimeUnit.SECONDS)
                .callTimeout(10, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false)
                .retryOnConnectionFailure(false).build();
    }

    /** 原样发送JSON，语义由网关验证；返回非2xx，调用方必须明确检查，SDK不安排业务重试。 */
    public Response invoke(String service, String version, String method, String json) throws IOException {
        if (service == null || !service.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")
                || version == null || !version.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,31}")
                || method == null || !method.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")) {
            throw new IllegalArgumentException("外部服务、版本或操作格式不合法");
        }
        if (json == null || json.length() > MAX_REQUEST_BYTES) throw new IllegalArgumentException("请求超过64KiB");
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        if (body.length > MAX_REQUEST_BYTES) throw new IllegalArgumentException("请求超过64KiB");
        if (!calls.tryAcquire()) throw new IOException("客户端同时调用已达到8个，请稍后显式调用");
        try {
            if (closed.get()) throw new IOException("客户端已关闭");
            URI uri = baseUri.resolve((signing == null ? "api/oauth/" : "api/sign/") + service + "/" + version + "/" + method);
            HttpUrl url = HttpUrl.get(uri);
            if (signing != null && !uri.getRawPath().equals(url.encodedPath())) {
                throw new IllegalArgumentException("签名路径不能经过HTTP客户端重新编码或规范化");
            }
            Request.Builder request = new Request.Builder().url(url);
            if (signing == null) request.header("Authorization", "Bearer " + token);
            else signing.authenticate(request, uri.getRawPath(), body);
            request.post(new RequestBody() {
                        @Override public MediaType contentType() { return MediaType.get("application/json"); }
                        @Override public long contentLength() { return body.length; }
                        // 连同503 Retry-After: 0等HTTP层跟进重发一起禁用。
                        @Override public boolean isOneShot() { return true; }
                        @Override public void writeTo(BufferedSink sink) throws IOException { sink.write(body); }
                    });
            try (okhttp3.Response response = client.newCall(request.build()).execute()) {
                ResponseBody responseBody = response.body();
                if (responseBody == null) throw new IOException("响应正文缺失");
                if (responseBody.contentLength() > MAX_RESPONSE_BYTES) throw new IOException("响应超过512KiB");
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                InputStream input = responseBody.byteStream();
                byte[] buffer = new byte[8192];
                for (int count; (count = input.read(buffer)) != -1;) {
                    if (count > MAX_RESPONSE_BYTES - output.size()) throw new IOException("响应超过512KiB");
                    output.write(buffer, 0, count);
                }
                return new Response(response.code(), response.header("X-Request-Id", ""),
                        new String(output.toByteArray(), StandardCharsets.UTF_8));
            } catch (IOException failure) {
                // 不携带底层请求对象或异常链，避免日志意外暴露认证信息。
                throw new IOException("网关调用或响应读取失败（完整期限10秒、响应512KiB），业务可能已执行，请核对状态后再决定是否重试");
            }
        } finally { calls.release(); }
    }

    private static final class SigningCredentials {
        private static final SecureRandom RANDOM = new SecureRandom();
        private final String keyId;
        private final byte[] secret;
        private final String tenantId;
        private final String employeeNo;

        private SigningCredentials(String keyId, String secret, String tenantId, String employeeNo) {
            if (keyId == null || !keyId.matches("[a-f0-9]{32}")) throw new IllegalArgumentException("签名keyId格式不合法");
            if (secret == null || !secret.matches("[A-Za-z0-9_-]{43}")) throw new IllegalArgumentException("SigningSecret格式不合法");
            byte[] decoded = Base64.getUrlDecoder().decode(secret);
            if (decoded.length != 32 || !Base64.getUrlEncoder().withoutPadding().encodeToString(decoded).equals(secret)) {
                throw new IllegalArgumentException("SigningSecret必须为规范Base64URL编码的32字节密钥");
            }
            if (tenantId == null || !tenantId.matches("[\\x21-\\x2B\\x2D-\\x7E]{1,64}")
                    || (employeeNo != null && !employeeNo.matches("[\\x21-\\x2B\\x2D-\\x7E]{1,64}"))) {
                throw new IllegalArgumentException("签名租户或人员标识格式不合法");
            }
            this.keyId = keyId;
            this.secret = decoded;
            this.tenantId = tenantId;
            this.employeeNo = employeeNo;
        }

        private void authenticate(Request.Builder request, String path, byte[] body) throws IOException {
            byte[] nonceBytes = new byte[16];
            RANDOM.nextBytes(nonceBytes);
            String nonce = hex(nonceBytes);
            String timestamp = Long.toString(System.currentTimeMillis() / 1000);
            try {
                String canonical = String.join("\n", "SZ-HMAC-SHA256", "POST", path, keyId, tenantId,
                        employeeNo == null ? "" : employeeNo, timestamp, nonce,
                        hex(MessageDigest.getInstance("SHA-256").digest(body)));
                Mac mac = Mac.getInstance("HmacSHA256");
                mac.init(new SecretKeySpec(secret, "HmacSHA256"));
                request.header("Authorization", "SZ-HMAC-SHA256 " + keyId + ":" + hex(mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8))))
                        .header("X-SZ-Tenant", tenantId).header("X-SZ-Timestamp", timestamp).header("X-SZ-Nonce", nonce);
                if (employeeNo != null) request.header("X-SZ-Employee", employeeNo);
            } catch (GeneralSecurityException failure) {
                throw new IOException("运行环境不支持SHA-256或HMAC-SHA256");
            }
        }

        private static String hex(byte[] bytes) {
            char[] text = new char[bytes.length * 2];
            char[] alphabet = "0123456789abcdef".toCharArray();
            for (int i = 0; i < bytes.length; i++) {
                text[i * 2] = alphabet[(bytes[i] & 0xff) >>> 4];
                text[i * 2 + 1] = alphabet[bytes[i] & 15];
            }
            return new String(text);
        }
    }

    @Override public void close() {
        if (closed.compareAndSet(false, true)) {
            client.dispatcher().cancelAll();
            client.connectionPool().evictAll();
            client.dispatcher().executorService().shutdown();
        }
    }

    public static final class Response {
        private final int statusCode;
        private final String requestId;
        private final String body;

        public Response(int statusCode, String requestId, String body) {
            this.statusCode = statusCode;
            this.requestId = requestId;
            this.body = body;
        }
        public int statusCode() { return statusCode; }
        public String requestId() { return requestId; }
        public String body() { return body; }
        @Override public String toString() { return "Response[statusCode=" + statusCode + ",requestId=" + requestId + "]"; }
    }
}
