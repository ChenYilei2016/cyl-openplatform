package io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.Instant;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@TableName("access_tenant_scope_grant")
public class TenantScopeGrantDO {
    @TableId(type = IdType.INPUT)
    private String id;
    private String tenantId;
    private String scopeCode;
    private String status;
    private String grantedByTenantId;
    private String grantedByEmployeeNo;
    private Instant createdAt;
    private Instant updatedAt;
    private Long revision;
}
