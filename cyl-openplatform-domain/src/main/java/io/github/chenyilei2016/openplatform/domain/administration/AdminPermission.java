package io.github.chenyilei2016.openplatform.domain.administration;

import lombok.RequiredArgsConstructor;

/** 平台业务操作权限；总管理员的成员管理权单独表达，不自动授予这些业务权限。 */
@RequiredArgsConstructor
public enum AdminPermission {
    MANAGE_APPLICATIONS("管理调用应用"),
    MANAGE_APIS("管理开放接口"),
    MANAGE_CONNECTIONS("管理服务连接"),
    PUBLISH_APIS("发布开放接口"),
    REVIEW_APIS("审核开放接口"),
    MANAGE_OPERATIONS("管理平台运维"),
    VIEW_AUDIT("查看审计记录");

    private final String displayName;

    public String displayName() {
        return displayName;
    }
}
