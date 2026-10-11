package io.github.chenyilei2016.openplatform.domain.documentation;

/** 公开阅读、管理核查和客户授权是独立入口，匿名不借用空权限身份。 */
public enum DocumentAudience {
    PUBLIC, PORTAL, ADMINISTRATIVE, CUSTOMER;

    public boolean requiresScopes() {
        return this == CUSTOMER;
    }
    public boolean usesTenantPermissions() { return this == PUBLIC || this == PORTAL; }
}
