package io.github.chenyilei2016.openplatform.domain.catalog;

import io.github.chenyilei2016.openplatform.domain.common.FieldValidation;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

/** 显式描述提供方外壳；不猜测成功码或转换标量类型。 */
public record ResponseAdapter(Mode mode, String successPath, List<Object> successValues,
                              String dataPath, String messagePath) {
    public enum Mode { DIRECT, ENVELOPE }
    public static final ResponseAdapter DIRECT = new ResponseAdapter(Mode.DIRECT, null, null, null, null);
    private static final Pattern PATH = Pattern.compile("[a-zA-Z][a-zA-Z0-9_]{0,63}(?:\\.[a-zA-Z][a-zA-Z0-9_]{0,63}){0,7}");

    public ResponseAdapter {
        // null 元素也须保留到 validate，给管理端可读错误，而非构造器 NPE。
        successValues = successValues == null ? List.of() : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(successValues));
    }

    public void validate() {
        if (mode == null) invalid("/mode", "请选择返回处理方式 DIRECT 或 ENVELOPE");
        if (mode == Mode.DIRECT) {
            if (successPath != null || !successValues.isEmpty() || dataPath != null || messagePath != null)
                invalid("/mode", "直接返回只需要 mode；请移除外壳提取字段");
            return;
        }
        FieldValidation paths = new FieldValidation();
        paths.check(validPath(successPath), "/successPath", "成功路径必须为最多8层的点分字段名");
        paths.check(dataPath != null && (dataPath.isEmpty() || validPath(dataPath)), "/dataPath", "数据路径须为字段名；留空表示根节点");
        paths.check(messagePath == null || validPath(messagePath), "/messagePath", "消息路径必须为最多8层的点分字段名");
        paths.requireValid();
        if (successValues.isEmpty() || successValues.size() > 10) invalid("/successValues", "请填写1至10个同类型的成功值");
        String type = scalarType(successValues.getFirst());
        if (type == null || successValues.stream().anyMatch(value -> !Objects.equals(type, scalarType(value))))
            invalid("/successValues", "成功值只支持同类型的非空字符串、数值或布尔值，不能混用0与\"0\"");
        if (successValues.stream().anyMatch(value -> value instanceof String text && text.length() > 500))
            invalid("/successValues", "成功值字符串不能超过500字符");
    }

    public boolean acceptsSuccess(Object value) {
        return successValues.stream().anyMatch(expected -> ApiDefinitionContent.sameValue(expected, value));
    }

    public static String scalarType(Object value) {
        if (value instanceof Number) return "NUMBER";
        if (value instanceof String) return "STRING";
        if (value instanceof Boolean) return "BOOLEAN";
        return null;
    }

    private static boolean validPath(String path) { return path != null && PATH.matcher(path).matches(); }
    private static void invalid(String path, String message) { throw FieldValidation.invalid(path, FieldValidation.Reason.INVALID_VALUE, message); }
}
