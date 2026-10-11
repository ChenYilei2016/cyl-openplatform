package io.github.chenyilei2016.openplatform.domain.runtime;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/** 预检与泛化调用共用参数位置和精确类型规则，不加载提供方Java类。 */
public final class DubboArguments {
    private DubboArguments() {}
    public static Object[] prepare(Map<String, Object> parameters, List<String> types) {
        if (parameters.keySet().stream().anyMatch(name -> !name.matches("arg(?:0|[1-9][0-9]*)")
                || name.length() > 5 || Integer.parseInt(name.substring(3)) >= types.size()))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "Dubbo映射目标必须匹配参数位置argN");
        Object[] arguments = new Object[types.size()];
        for (int index = 0; index < arguments.length; index++) {
            try { arguments[index] = typedValue(parameters.get("arg" + index), types.get(index)); }
            catch (PlatformException failure) {
                throw new PlatformException(ErrorCode.INVALID_REQUEST, "提供方参数arg" + index + "（" + types.get(index) + "）：" + failure.getMessage());
            }
        }
        return arguments;
    }

    /** 基础类型在远程调用前精确转换，避免Dubbo自动窄化导致溢出或截断。 */
    private static Object typedValue(Object value, String type) {
        if (value == null) {
            if (!type.contains(".") && !type.endsWith("[]")) throw new PlatformException(ErrorCode.INVALID_REQUEST, "Dubbo基本类型参数不可缺失");
            return null;
        }
        if (type.endsWith("[]")) {
            if (!(value instanceof List<?> list)) throw new PlatformException(ErrorCode.INVALID_REQUEST, "Dubbo数组参数必须是JSON数组");
            return list.stream().map(item -> typedValue(item, type.substring(0, type.length() - 2))).toArray();
        }
        try {
            return switch (type) {
                case "java.lang.Object" -> value;
                case "java.lang.String" -> { if (!(value instanceof String)) throw new IllegalArgumentException(); yield value; }
                case "boolean", "java.lang.Boolean" -> { if (!(value instanceof Boolean)) throw new IllegalArgumentException(); yield value; }
                case "char", "java.lang.Character" -> { if (!(value instanceof String text) || text.length() != 1) throw new IllegalArgumentException(); yield ((String) value).charAt(0); }
                case "byte", "java.lang.Byte", "short", "java.lang.Short", "int", "java.lang.Integer", "long", "java.lang.Long", "float", "java.lang.Float", "double", "java.lang.Double", "java.math.BigDecimal", "java.math.BigInteger" -> {
                    if (!(value instanceof Number)) throw new IllegalArgumentException();
                    BigDecimal number = new BigDecimal(value.toString());
                    yield switch (type) {
                        case "byte", "java.lang.Byte" -> number.byteValueExact();
                        case "short", "java.lang.Short" -> number.shortValueExact();
                        case "int", "java.lang.Integer" -> number.intValueExact();
                        case "long", "java.lang.Long" -> number.longValueExact();
                        case "java.math.BigInteger" -> number.toBigIntegerExact();
                        case "float", "java.lang.Float" -> { float converted = number.floatValue(); if (!Float.isFinite(converted) || new BigDecimal(Float.toString(converted)).compareTo(number) != 0) throw new ArithmeticException(); yield converted; }
                        case "double", "java.lang.Double" -> { double converted = number.doubleValue(); if (!Double.isFinite(converted) || BigDecimal.valueOf(converted).compareTo(number) != 0) throw new ArithmeticException(); yield converted; }
                        default -> number;
                    };
                }
                default -> {
                    if (!(value instanceof Map<?, ?> || value instanceof List<?> || value instanceof String)) throw new IllegalArgumentException();
                    yield value;
                }
            };
        } catch (IllegalArgumentException | ArithmeticException exception) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "Dubbo参数与声明类型不匹配或数值无法精确表示");
        }
    }

}
