package io.github.chenyilei2016.openplatform.provider;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/** 双端共用的有限线协议，长度前缀消除拼接歧义；不包含业务正文。 */
final class OpenPlatformProof {
    static final String VERSION = "3";
    static final String PREFIX = "x-open-platform-";
    static final String ALGORITHM = "SHA256withRSA";
    static final long LIFETIME_SECONDS = 30;
    static final long CLOCK_SKEW_SECONDS = 5;
    static final List<String> SIGNED_HEADERS = Arrays.asList(
            PREFIX + "key-id", PREFIX + "environment-id", PREFIX + "issued-at", PREFIX + "expires-at", "x-request-id",
            PREFIX + "application-id", PREFIX + "app-key", PREFIX + "tenant-id",
            PREFIX + "user-id", PREFIX + "employee-id", PREFIX + "employee-no");

    private OpenPlatformProof() {}

    static Map<String, String> read(Function<String, String> source) {
        Map<String, String> values = new LinkedHashMap<>();
        for (String name : SIGNED_HEADERS) {
            String value = source.apply(name);
            if (value != null) {
                if (value.length() > 128 || value.chars().anyMatch(c -> Character.isISOControl(c) || Character.isWhitespace(c)
                        || Character.isSurrogate((char) c) || c == ',')) throw rejected();
                values.put(name, value);
            }
        }
        return values;
    }

    static byte[] encode(Map<String, String> headers, OpenPlatformTarget target) {
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            DataOutputStream output = new DataOutputStream(bytes);
            write(output, "open-platform-proof-v3");
            for (String name : SIGNED_HEADERS) write(output, headers.getOrDefault(name, ""));
            for (String value : target.fields()) write(output, value);
            output.flush();
            return bytes.toByteArray();
        } catch (IOException impossible) { throw new IllegalStateException("无法编码内存身份证明", impossible); }
    }

    static void requireId(String value, int max) {
        if (value == null || value.length() > max || !value.matches("[a-zA-Z0-9._-]+"))
            throw new IllegalArgumentException("环境或密钥标识不合法");
    }

    static OpenPlatformIdentity identity(Map<String, String> values, String traceId) {
        String application = required(values, PREFIX + "application-id");
        String appKey = required(values, PREFIX + "app-key");
        String tenant = required(values, PREFIX + "tenant-id");
        String request = required(values, "x-request-id");
        if (request.chars().anyMatch(c -> c < 33 || c > 126))
            throw new OpenPlatformException(OpenPlatformException.Reason.INVALID_IDENTITY);
        String user = values.get(PREFIX + "user-id");
        String employee = values.get(PREFIX + "employee-id");
        String number = values.get(PREFIX + "employee-no");
        if ((user == null) != (employee == null) || (user == null) != (number == null)
                || user != null && (user.isEmpty() || employee.isEmpty() || number.isEmpty()))
            throw new OpenPlatformException(OpenPlatformException.Reason.INVALID_IDENTITY);
        return new OpenPlatformIdentity(application, appKey, tenant, user, employee, number, request, traceId);
    }

    static OpenPlatformException rejected() { return new OpenPlatformException(OpenPlatformException.Reason.INVALID_CREDENTIAL); }

    private static String required(Map<String, String> values, String name) {
        String value = values.get(name);
        if (value == null || value.isEmpty()) throw new OpenPlatformException(OpenPlatformException.Reason.INVALID_IDENTITY);
        return value;
    }

    private static void write(DataOutputStream output, String value) throws IOException {
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        output.writeInt(bytes.length);
        output.write(bytes);
    }
}
