package io.github.chenyilei2016.openplatform.infrastructure.observability.dal.dataobject;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiProtocol;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import java.time.Instant;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@TableName("platform_call_record")
public class CallRecordDO {
    @TableId(type = IdType.INPUT)
    private String id;
    private String requestId;
    private CallMode mode;
    private String apiId;
    private String service;
    private String version;
    private String method;
    private ApiProtocol protocol;
    private String applicationId;
    private String tenantId;
    private String userId;
    private String employeeId;
    private io.github.chenyilei2016.openplatform.domain.observability.CallIdentityKind identityKind;
    private boolean governanceRejected;
    private boolean observed;
    private GovernanceDecision.Reason governanceDenialReason;
    private String employeeNo;
    private String clientIp;
    private String releaseId;
    private Long draftRevision;
    private String operatorTenantId;
    private String operatorEmployeeNo;
    private String outcome;
    private Integer errorCode;
    private int httpStatus;
    private long durationMillis;
    private Instant occurredAt;
    private String governanceJson;
    private io.github.chenyilei2016.openplatform.domain.observability.CallChannel channel;
    private String toolName;
}
