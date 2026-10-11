package io.github.chenyilei2016.openplatform.infrastructure.administration.dal.dataobject;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@TableName("platform_administrator_audit")
public class AdministratorAuditDO {
    @TableId(type = IdType.INPUT)
    private String id;

    private String administratorId;
    private String operatorTenantId;
    private String operatorEmployeeNo;
    private String action;
    private String reason;
    private String beforeJson;
    private String afterJson;
    private String requestId;
    private java.time.Instant occurredAt;
}
