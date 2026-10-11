package io.github.chenyilei2016.openplatform.infrastructure.mcp.dal.dataobject;

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
@TableName("mcp_tenant_activation")
public class McpTenantActivationDO {
    @TableId(type = IdType.INPUT)
    private String id;
    private String tenantId;
    private String keyCode;
    private String status;
    private Boolean disabledByPlatform;
    private String activatedByEmployeeNo;
    private Instant createdAt;
    private Instant updatedAt;
    private Long revision;
}
