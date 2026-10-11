package io.github.chenyilei2016.openplatform.domain.governance;

import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import java.util.Objects;

/** 仅由已认证执行链构造；业务正文不能覆盖这些身份和调用模式。 */
public record GovernanceRequest(String applicationId, String tenantId, String apiId, String clientIp, CallMode mode) {
    public GovernanceRequest {
        if (applicationId == null || applicationId.isBlank() || tenantId == null || tenantId.isBlank()
                || apiId == null || apiId.isBlank() || clientIp == null || clientIp.isBlank()) {
            throw new IllegalArgumentException("治理请求缺少可信身份或来源IP");
        }
        Objects.requireNonNull(mode, "治理调用模式不能为空");
    }
}
