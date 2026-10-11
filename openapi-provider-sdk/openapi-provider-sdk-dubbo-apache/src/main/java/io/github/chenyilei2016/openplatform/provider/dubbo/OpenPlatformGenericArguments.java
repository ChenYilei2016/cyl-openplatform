package io.github.chenyilei2016.openplatform.provider.dubbo;

import io.github.chenyilei2016.openplatform.provider.OpenPlatformException;

import java.util.List;
import java.util.Map;

/** 默认泛化仅接受有界数据树；禁止通过class提示替换已登记方法的参数类型。 */
final class OpenPlatformGenericArguments {
    private int remaining = 10000;

    void validate(Object value, int depth) {
        if (--remaining < 0 || depth > 16) reject();
        if (value == null || value instanceof Boolean || value instanceof Number) return;
        if (value instanceof String) {
            if (((String) value).length() > 262144) reject();
            return;
        }
        if (value instanceof Map<?, ?>) {
            Map<?, ?> map = (Map<?, ?>) value;
            if (map.size() > remaining) reject();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!(entry.getKey() instanceof String) || "class".equals(entry.getKey())) reject();
                validate(entry.getKey(), depth + 1);
                validate(entry.getValue(), depth + 1);
            }
        } else if (value instanceof List<?>) {
            List<?> list = (List<?>) value;
            if (list.size() > remaining) reject();
            for (Object item : list) validate(item, depth + 1);
        } else if (value instanceof Object[]) {
            Object[] array = (Object[]) value;
            if (array.length > remaining) reject();
            for (Object item : array) validate(item, depth + 1);
        } else reject();
    }

    private static void reject() {
        throw new OpenPlatformException(OpenPlatformException.Reason.INVALID_INVOCATION);
    }
}
