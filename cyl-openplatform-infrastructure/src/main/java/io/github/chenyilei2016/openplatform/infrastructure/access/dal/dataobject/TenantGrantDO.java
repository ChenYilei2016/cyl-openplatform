package io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@TableName("access_tenant_grant")
public class TenantGrantDO {
    @TableId(type = IdType.INPUT)
    private String id;
    private String applicationId;
    private String tenantId;
    private String status;
    private Long authorizationVersion;
    private String note;
    private Long noteRevision;
}
