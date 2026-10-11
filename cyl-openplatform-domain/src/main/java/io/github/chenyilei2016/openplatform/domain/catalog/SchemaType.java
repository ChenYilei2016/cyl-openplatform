package io.github.chenyilei2016.openplatform.domain.catalog;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

public enum SchemaType {
    OBJECT, ARRAY, STRING, INTEGER, NUMBER, BOOLEAN;

    public boolean accepts(Object value) {
        return switch (this) {
            case OBJECT -> value instanceof Map<?, ?>;
            case ARRAY -> value instanceof List<?>;
            case STRING -> value instanceof String;
            case INTEGER -> value instanceof Number number
                    && new BigDecimal(number.toString()).stripTrailingZeros().scale() <= 0;
            case NUMBER -> value instanceof Number;
            case BOOLEAN -> value instanceof Boolean;
        };
    }
}
