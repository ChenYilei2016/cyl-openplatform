import io.github.chenyilei2016.openplatform.client.OpenPlatformClient;
import java.net.URI;

/** 使用实际下载源码编译；每种认证复用一个客户端跨两个API，不输出认证材料。 */
public final class PlatformSdkMultiApiCheck {
    public static void main(String[] services) throws Exception {
        if (services.length != 2 && services.length != 3) throw new IllegalArgumentException("需要HTTP和Dubbo两个API服务标识");
        URI base = URI.create(System.getenv("OPEN_PLATFORM_BASE_URL"));
        if (services.length == 3) {
            int expectedStatus = Integer.parseInt(services[2]);
            try (OpenPlatformClient client = new OpenPlatformClient(base, System.getenv("OPEN_PLATFORM_TOKEN"))) {
                OpenPlatformClient.Response response = client.invoke(services[0], "v1", "query", "{\"orderNo\":\"COMMON-001\"}");
                if (response.statusCode() != expectedStatus) throw new AssertionError("下载未授予调用权限的校验失败：HTTP=" + response.statusCode());
                System.out.println("denied " + expectedStatus + " requestId=" + response.requestId());
            }
            return;
        }
        try (OpenPlatformClient bearer = new OpenPlatformClient(base, System.getenv("OPEN_PLATFORM_TOKEN"));
             OpenPlatformClient signed = OpenPlatformClient.signed(base, System.getenv("OPEN_PLATFORM_KEY_ID"),
                     System.getenv("OPEN_PLATFORM_SIGNING_SECRET"), "101", null)) {
            for (OpenPlatformClient client : new OpenPlatformClient[]{bearer, signed}) {
                for (String service : services) {
                    OpenPlatformClient.Response response = client.invoke(service, "v1", "query", "{\"orderNo\":\"COMMON-001\"}");
                    if (response.statusCode() != 200 || !response.body().contains("101.25") || response.requestId().isEmpty()) {
                        throw new AssertionError("跨API调用失败：" + service + "，HTTP=" + response.statusCode());
                    }
                    System.out.println("passed " + service + " requestId=" + response.requestId());
                }
            }
        }
    }
}
