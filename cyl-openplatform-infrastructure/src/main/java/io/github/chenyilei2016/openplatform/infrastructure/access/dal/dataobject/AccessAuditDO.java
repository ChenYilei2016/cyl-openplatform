package io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import java.time.Instant;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@TableName("access_audit")
public class AccessAuditDO {
    @TableId(type = IdType.INPUT)
    private String id;
    private String applicationId;
    private String action;
    private String operatorTenantId;
    private String operatorEmployeeNo;
    private String targetTenantId;
    private String targetId;
    private String outcome;
    private String summary;
    private String requestId;
    private Instant occurredAt;
    private String operatorUserId;
    private String operatorEmployeeId;
    private String tenantGrantId;
    private String targetUserId;
    private String targetEmployeeId;
    private String targetEmployeeNo;
}
