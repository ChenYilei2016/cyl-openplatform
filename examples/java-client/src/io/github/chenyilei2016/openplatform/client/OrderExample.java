package io.github.chenyilei2016.openplatform.client;

import java.net.URI;

/** 认证材料经环境注入；外部操作相同调用方式适用于内部HTTP/Dubbo。 */
public final class OrderExample {
    private OrderExample() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 3) throw new IllegalArgumentException("参数：service version method");
        String base = System.getenv("OPEN_PLATFORM_BASE_URL");
        if (base == null) throw new IllegalArgumentException("请设置OPEN_PLATFORM_BASE_URL");
        String authentication = System.getenv("OPEN_PLATFORM_AUTH");
        if (authentication != null && !authentication.equals("BEARER") && !authentication.equals("SIGNATURE")) {
            throw new IllegalArgumentException("OPEN_PLATFORM_AUTH必须是BEARER或SIGNATURE");
        }
        try (OpenPlatformClient client = "SIGNATURE".equals(authentication)
                ? OpenPlatformClient.signed(URI.create(base), System.getenv("OPEN_PLATFORM_KEY_ID"),
                    System.getenv("OPEN_PLATFORM_SIGNING_SECRET"), System.getenv("OPEN_PLATFORM_TENANT_ID"),
                    System.getenv("OPEN_PLATFORM_EMPLOYEE_NO"))
                : new OpenPlatformClient(URI.create(base), System.getenv("OPEN_PLATFORM_TOKEN"))) {
            OpenPlatformClient.Response result = client.invoke(args[0], args[1], args[2], "{\"orderNo\":\"COMMON-001\"}");
            if (result.statusCode() != 200) throw new IllegalStateException("调用未成功，HTTP=" + result.statusCode() + ",requestId=" + result.requestId());
            System.out.println(result.body());
        }
    }
}
