package io.github.chenyilei2016.openplatform.domain.access;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.util.Collection;

/** 112：草稿调试“选凭据代换身份”的只读查询；不读取凭据密钥。 */
public interface DebugIdentityRepository {
    /** 启用凭据、有效租户授权，且凭据拥有任一给定（已启用的）权限组。 */
    PageResult<CallableGrant> callableGrants(Collection<String> scopeCodes, AccessPageQuery query);
    /** 某租户授权下的有效人员授权，按工号或姓名包含搜索。 */
    PageResult<UserGrant> activeUsers(String tenantGrantId, AccessPageQuery query);
}
