package io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.Instant;

@Data
@TableName("catalog_audit")
public class CatalogAuditDO {
    private String environmentId;
    @TableId(type = IdType.INPUT)
    private String id;
    private String apiId;
    private Long draftRevision;
    private String action;
    private String operatorTenantId;
    private String operatorEmployeeNo;
    private String requestId;
    private Instant occurredAt;
}
