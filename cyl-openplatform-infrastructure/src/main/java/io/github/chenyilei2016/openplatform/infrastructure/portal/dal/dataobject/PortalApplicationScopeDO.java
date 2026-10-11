package io.github.chenyilei2016.openplatform.infrastructure.portal.dal.dataobject;

/** 当前页凭据的权限组展示投影，不包含其他租户或权限组管理配置。 */
public record PortalApplicationScopeDO(String applicationId, String code, String name, boolean enabled) {}
