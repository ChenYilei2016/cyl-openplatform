package io.github.chenyilei2016.openplatform.domain.catalog;

import io.github.chenyilei2016.openplatform.domain.common.FieldValidation;

/** 目录分类独立于接口版本；历史名称通过别名保留到同一分类。 */
public record ApiCategory(String id, String name, boolean enabled, long revision) {
    public static String checkedName(String value) {
        String name = value == null ? "" : value.strip();
        if (name.isEmpty() || name.length() > 100)
            throw FieldValidation.invalid(
                    "/name", FieldValidation.Reason.REQUIRED, "分类名称必填且不超过100字符");
        return name;
    }
}
