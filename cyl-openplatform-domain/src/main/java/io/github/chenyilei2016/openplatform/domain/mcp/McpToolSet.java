package io.github.chenyilei2016.openplatform.domain.mcp;

import io.github.chenyilei2016.openplatform.domain.common.FieldValidation;

/** 分类地址的稳定标识；成员仅筛选工具，不授予租户调用权限。 */
public record McpToolSet(String id, String code, String name, String description, boolean enabled, long revision) {
    public McpToolSet {
        description = description == null ? "" : description;
        FieldValidation checks = new FieldValidation();
        checks.check(code != null && code.matches("[a-z][a-z0-9_-]{0,63}"), "/code", "工具集代码须以小写字母开头，仅含小写字母、数字、下划线或短横线，最多64位");
        checks.check(name != null && !name.isBlank() && name.length() <= 100, "/name", "工具集名称必填且不超过100字");
        checks.check(description.length() <= 500, "/description", "工具集说明不超过500字");
        checks.requireValid();
    }
}
