import io.github.chenyilei2016.openplatform.client.OpenPlatformClient;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.security.MessageDigest;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** 真实Java8运行，只验证公开客户端行为；不随交付ZIP打包。 */
public final class OpenPlatformClientCheck {
    public static void main(String[] args) throws Exception {
        if (!System.getProperty("java.specification.version").equals("1.8")) throw new AssertionError("必须使用真实JDK8");
        AtomicInteger redirects = new AtomicInteger();
        AtomicInteger unavailable = new AtomicInteger();
        Set<Integer> ports = new HashSet<Integer>();
        CountDownLatch arrived = new CountDownLatch(8);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService workers = Executors.newFixedThreadPool(8);
        ExecutorService callers = Executors.newFixedThreadPool(8);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(workers);
        server.createContext("/api/oauth/orders/v1/", exchange -> {
            try {
                String method = exchange.getRequestURI().getPath().substring("/api/oauth/orders/v1/".length());
                if (!"Bearer test-token".equals(exchange.getRequestHeaders().getFirst("Authorization"))) throw new AssertionError("Token未传递");
                byte[] requestBuffer = new byte[1024];
                while (exchange.getRequestBody().read(requestBuffer) != -1) { }
                exchange.getResponseHeaders().set("X-Request-Id", "client-check");
                if (method.equals("query")) synchronized (ports) { ports.add(exchange.getRemoteAddress().getPort()); }
                if (method.equals("redirect")) {
                    exchange.getResponseHeaders().set("Location", "/api/oauth/orders/v1/never"); exchange.sendResponseHeaders(302, -1); return;
                }
                if (method.equals("never")) redirects.incrementAndGet();
                if (method.equals("unavailable")) {
                    unavailable.incrementAndGet(); exchange.getResponseHeaders().set("Retry-After", "0");
                    exchange.sendResponseHeaders(503, -1); return;
                }
                if (method.equals("held")) {
                    arrived.countDown();
                    if (!release.await(8, TimeUnit.SECONDS)) throw new AssertionError("并发测试未释放");
                }
                if (method.equals("slow")) {
                    exchange.sendResponseHeaders(200, 0);
                    for (int n = 0; n < 6; n++) {
                        exchange.getResponseBody().write('a'); exchange.getResponseBody().flush(); Thread.sleep(2500);
                    }
                    return;
                }
                byte[] body = method.equals("large") ? new byte[512 * 1024 + 1] : "{\"code\":200}".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, method.equals("large") ? 0 : body.length);
                exchange.getResponseBody().write(body);
            } catch (IOException disconnected) { /* 超限与完整期限测试主动关闭连接。 */ }
            catch (InterruptedException stopped) { Thread.currentThread().interrupt(); }
            finally { exchange.close(); }
        });
        server.start();
        OpenPlatformClient client = new OpenPlatformClient(URI.create("http://127.0.0.1:" + server.getAddress().getPort()), "test-token");
        try {
            OpenPlatformClient.Response response = client.invoke("orders", "v1", "query", "{}");
            if (response.statusCode() != 200 || !"client-check".equals(response.requestId()) || !response.body().contains("200")) throw new AssertionError("正常响应或requestId缺失");
            client.invoke("orders", "v1", "query", "{}");
            if (ports.size() != 1) throw new AssertionError("连接未复用");
            if (client.invoke("orders", "v1", "redirect", "{}").statusCode() != 302 || redirects.get() != 0) throw new AssertionError("不应跟随重定向");
            if (client.invoke("orders", "v1", "unavailable", "{}").statusCode() != 503 || unavailable.get() != 1) throw new AssertionError("不应重发503业务调用");
            try { client.invoke("orders", "v1", "query", new String(new char[64 * 1024 + 1])); throw new AssertionError("请求超限未拒绝"); } catch (IllegalArgumentException expected) { }
            try { client.invoke("orders", "v1", "large", "{}"); throw new AssertionError("响应超限未拒绝"); } catch (IOException expected) { }
            List<Future<OpenPlatformClient.Response>> requests = new ArrayList<Future<OpenPlatformClient.Response>>();
            for (int n = 0; n < 8; n++) requests.add(callers.submit(() -> client.invoke("orders", "v1", "held", "{}")));
            if (!arrived.await(5, TimeUnit.SECONDS)) throw new AssertionError("8个并发请求未到达");
            try { client.invoke("orders", "v1", "query", "{}"); throw new AssertionError("第9个调用未拒绝"); } catch (IOException expected) { }
            release.countDown();
            for (Future<OpenPlatformClient.Response> request : requests) if (request.get(5, TimeUnit.SECONDS).statusCode() != 200) throw new AssertionError();
            long started = System.nanoTime();
            try { client.invoke("orders", "v1", "slow", "{}"); throw new AssertionError("完整正文期限未执行"); } catch (IOException expected) { }
            long elapsed = System.nanoTime() - started;
            if (elapsed < 9_000_000_000L || elapsed > 13_000_000_000L) throw new AssertionError("完整调用期限错误");
            if (client.invoke("orders", "v1", "query", "{}").statusCode() != 200) throw new AssertionError("失败未释放并发许可");
            client.close();
            try { client.invoke("orders", "v1", "query", "{}"); throw new AssertionError("关闭后调用未拒绝"); } catch (IOException expected) { }
        } finally {
            release.countDown(); client.close(); server.stop(0); workers.shutdownNow(); callers.shutdownNow();
        }
        checkSignature();
        System.out.println("SDK_CLIENT_CHECK_PASSED Java=" + System.getProperty("java.version") + " bearer+signature");
    }

    private static void checkSignature() throws Exception {
        byte[] rfcKey = new byte[20];
        Arrays.fill(rfcKey, (byte) 0x0b);
        if (!hmac(rfcKey, "Hi There").equals("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7")) {
            throw new AssertionError("RFC4231向量1失败");
        }
        byte[] secret = new byte[32];
        for (int n = 0; n < secret.length; n++) secret[n] = (byte) n;
        String encodedSecret = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
        String keyId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        String json = "{ \"orderNo\": \"中文订单\", \"a\":1 }";
        AtomicReference<Throwable> failure = new AtomicReference<Throwable>();
        AtomicInteger requests = new AtomicInteger();
        Set<String> nonces = new HashSet<String>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/.gateway~v1/api/sign/orders/v1/", exchange -> {
            try {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[1024];
                for (int size; (size = exchange.getRequestBody().read(buffer)) != -1;) output.write(buffer, 0, size);
                byte[] body = output.toByteArray();
                if (!Arrays.equals(body, json.getBytes(StandardCharsets.UTF_8))) throw new AssertionError("签名正文被重新序列化");
                String authorization = exchange.getRequestHeaders().getFirst("Authorization");
                if (authorization == null || !authorization.startsWith("SZ-HMAC-SHA256 " + keyId + ":")) throw new AssertionError("签名认证头错误");
                String timestamp = exchange.getRequestHeaders().getFirst("X-SZ-Timestamp");
                if (!timestamp.matches("[1-9][0-9]{0,10}") || Math.abs(Long.parseLong(timestamp) - System.currentTimeMillis() / 1000) > 5) throw new AssertionError("时间戳错误");
                String nonce = exchange.getRequestHeaders().getFirst("X-SZ-Nonce");
                if (!nonce.matches("[a-f0-9]{32}") || !nonces.add(nonce)) throw new AssertionError("nonce格式错误或SDK复用nonce");
                String employee = exchange.getRequestHeaders().getFirst("X-SZ-Employee");
                String tenant = exchange.getRequestHeaders().getFirst("X-SZ-Tenant");
                if (!"tenant-101".equals(tenant) || employee != null && !"staff@example.com".equals(employee)) throw new AssertionError("身份头错误");
                String path = exchange.getRequestURI().getRawPath();
                if (!path.startsWith("/.gateway~v1/api/sign/") || exchange.getRequestURI().getRawQuery() != null) throw new AssertionError("contextPath或无query约定错误");
                String[] fields = {"SZ-HMAC-SHA256", exchange.getRequestMethod(), path, keyId, tenant,
                        employee == null ? "" : employee, timestamp, nonce, hex(MessageDigest.getInstance("SHA-256").digest(body))};
                String actual = authorization.substring(authorization.indexOf(':') + 1);
                if (!MessageDigest.isEqual(hmac(secret, String.join("\n", fields)).getBytes(StandardCharsets.US_ASCII), actual.getBytes(StandardCharsets.US_ASCII))) {
                    throw new AssertionError("独立服务器验签失败");
                }
                for (int n = 0; n < fields.length; n++) {
                    String[] tampered = fields.clone(); tampered[n] += "x";
                    if (hmac(secret, String.join("\n", tampered)).equals(actual)) throw new AssertionError("篡改字段未改变签名");
                }
                if (nonces.add(nonce)) throw new AssertionError("验签服务器重放集合未拒绝重复nonce");
                requests.incrementAndGet();
                if (path.endsWith("unavailable")) {
                    exchange.getResponseHeaders().set("Retry-After", "0"); exchange.sendResponseHeaders(503, -1);
                } else if (path.endsWith("redirect")) {
                    exchange.getResponseHeaders().set("Location", "/.gateway~v1/api/sign/orders/v1/never"); exchange.sendResponseHeaders(302, -1);
                } else {
                    exchange.sendResponseHeaders(200, 2); exchange.getResponseBody().write("{}".getBytes(StandardCharsets.UTF_8));
                }
            } catch (Throwable problem) {
                failure.compareAndSet(null, problem); exchange.sendResponseHeaders(500, -1);
            } finally { exchange.close(); }
        });
        server.start();
        URI base = URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/.gateway~v1");
        try (OpenPlatformClient client = OpenPlatformClient.signed(base, keyId, encodedSecret, "tenant-101", "staff@example.com");
             OpenPlatformClient application = OpenPlatformClient.signed(base, keyId, encodedSecret, "tenant-101", null)) {
            if (client.invoke("orders", "v1", "query", json).statusCode() != 200
                    || client.invoke("orders", "v1", "query", json).statusCode() != 200
                    || application.invoke("orders", "v1", "query", json).statusCode() != 200) throw new AssertionError("签名调用失败", failure.get());
            if (client.invoke("orders", "v1", "unavailable", json).statusCode() != 503
                    || client.invoke("orders", "v1", "redirect", json).statusCode() != 302
                    || requests.get() != 5) throw new AssertionError("签名请求自动重试或重定向", failure.get());
            client.close();
            try { client.invoke("orders", "v1", "query", json); throw new AssertionError("签名客户端关闭后仍调用"); } catch (IOException expected) { }
            for (String invalid : Arrays.asList("", "a,b", "a b", "中文", "a\r\nb")) {
                try (OpenPlatformClient rejected = OpenPlatformClient.signed(base, keyId, encodedSecret, invalid, null)) {
                    throw new AssertionError("非法签名身份未拒绝");
                } catch (IllegalArgumentException expected) { }
            }
            try (OpenPlatformClient rejected = OpenPlatformClient.signed(base, keyId, encodedSecret.substring(0, 42) + "_", "tenant-101", null)) {
                throw new AssertionError("非规范密钥未拒绝");
            } catch (IllegalArgumentException expected) { }
            for (String path : Arrays.asList("/a//b", "/a/../b", "/a/%62", "/a;b")) {
                try (OpenPlatformClient rejected = OpenPlatformClient.signed(URI.create("http://localhost" + path), keyId, encodedSecret, "tenant-101", null)) {
                    throw new AssertionError("替代路径表示未拒绝");
                } catch (IllegalArgumentException expected) { }
            }
            try (OpenPlatformClient rejected = OpenPlatformClient.signed(URI.create("http://localhost/中文"), keyId, encodedSecret, "tenant-101", null)) {
                rejected.invoke("orders", "v1", "query", json);
                throw new AssertionError("HTTP客户端重新编码路径未拒绝");
            } catch (IllegalArgumentException expected) { }
            if (failure.get() != null) throw new AssertionError("签名服务器检查失败", failure.get());
        } finally { server.stop(0); }
    }

    private static String hmac(byte[] key, String text) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return hex(mac.doFinal(text.getBytes(StandardCharsets.UTF_8)));
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format("%02x", value & 0xff));
        return result.toString();
    }
}
