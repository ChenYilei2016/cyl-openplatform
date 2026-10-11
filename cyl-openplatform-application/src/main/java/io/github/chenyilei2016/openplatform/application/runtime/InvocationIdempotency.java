package io.github.chenyilei2016.openplatform.application.runtime;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.runtime.IdempotencyGuard;
import io.github.chenyilei2016.openplatform.domain.runtime.IdempotencyGuard.Reservation;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 按API声明从原始请求取业务唯一号；不允许用默认值补出一个调用方没有提交的幂等号。 */
@Service
@RequiredArgsConstructor
public class InvocationIdempotency {
    private final IdempotencyGuard guard;

    public Reservation prepare(ApiDefinition definition, InvocationContext context, Map<String, Object> input, String requestId) {
        if (definition.idempotencyField() == null) return null;
        Object value = input;
        for (String segment : definition.idempotencyField().split("\\.")) {
            value = value instanceof Map<?, ?> object ? object.get(segment) : null;
        }
        if (value == null || value instanceof String text && text.isBlank())
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "缺少幂等字段：" + definition.idempotencyField());
        if (!(value instanceof String) && !io.github.chenyilei2016.openplatform.domain.catalog.SchemaType.INTEGER.accepts(value))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "幂等字段必须为字符串或整数");
        // 请求结构已验证过类型；整数的 1、1.0、1e0 必须对应同一个业务唯一号。
        String normalized = value instanceof Number number
                ? new BigDecimal(number.toString()).stripTrailingZeros().toString() : (String) value;
        return new Reservation(context.tenantId(), definition.id(), digest(normalized), requestId);
    }

    public void reserve(Reservation reservation) { guard.reserve(reservation); }
    public void release(Reservation reservation) { guard.release(reservation); }

    private static String digest(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("JVM不支持SHA-256", impossible);
        }
    }
}
