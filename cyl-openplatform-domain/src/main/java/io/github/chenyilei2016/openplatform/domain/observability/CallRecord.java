package io.github.chenyilei2016.openplatform.domain.observability;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiProtocol;
import java.time.Instant;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision;
import lombok.Builder;

/** 只保存可信身份与调用元数据，禁止增加正文、凭据或原始异常字段。 */
@Builder
public record CallRecord(String id, String requestId, CallMode mode,
                         String apiId, String service, String version, String method, ApiProtocol protocol,
                         String applicationId, String tenantId, String userId, String employeeId, String employeeNo,
                         String clientIp, String releaseId, Long draftRevision,
                         String operatorTenantId, String operatorEmployeeNo, String outcome,
                         Integer errorCode, int httpStatus, long durationMillis, Instant occurredAt, GovernanceDecision governance,
                         CallChannel channel, String toolName) {
    public CallRecord { channel = channel == null ? CallChannel.API : channel; }
    public CallIdentityKind identityKind() { return CallIdentityKind.of(this); }
}
