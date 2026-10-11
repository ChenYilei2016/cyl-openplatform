package io.github.chenyilei2016.openplatform.domain.access;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.util.List;

/** 应用授权事实；凭据摘要独立读取，避免被列表或详情序列化。 */
public record ClientApplication(String id, String appKey, String name, String ownerTenantId,
                                ApplicationStatus status, long authorizationVersion, List<String> scopeCodes,
                                ApplicationKind kind) {
    public ClientApplication {
        scopeCodes = List.copyOf(scopeCodes);
    }

    /** 管理入口只处理本类型凭据；类型不符按不存在处理，普通凭据管理不能改动 MCP 网关凭据，反之亦然。 */
    public ClientApplication requireKind(ApplicationKind expected) {
        if (kind != expected) throw new PlatformException(ErrorCode.NOT_FOUND, "应用不存在");
        return this;
    }
}
