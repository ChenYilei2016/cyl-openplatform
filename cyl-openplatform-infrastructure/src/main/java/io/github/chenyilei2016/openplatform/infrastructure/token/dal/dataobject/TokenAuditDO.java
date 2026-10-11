package io.github.chenyilei2016.openplatform.infrastructure.token.dal.dataobject;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import java.time.Instant;

@Getter
@Setter
@TableName("token_audit")
public class TokenAuditDO {
    @TableId(type = IdType.INPUT)
    private String id;
    private String action;
    private String actorKind;
    private String operatorTenantId;
    private String operatorEmployeeNo;
    private String tokenId;
    private String applicationId;
    private String appKey;
    private String tenantId;
    private String userId;
    private String outcome;
    private String reason;
    private String requestId;
    private Instant occurredAt;
}
