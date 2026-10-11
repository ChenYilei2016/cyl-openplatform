package io.github.chenyilei2016.openplatform.domain.portal;

import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.GrantStatus;

/** 本租户凭据筛选；旧query、精确AK和备注字面包含同时存在时取交集。 */
public record PortalApplicationQuery(AccessPageQuery pageQuery, String appKey, String name, GrantStatus status) {}
