package io.github.chenyilei2016.openplatform.infrastructure.publication.dal.dataobject;

import com.baomidou.mybatisplus.annotation.*;

import lombok.Data;

import java.time.Instant;

@Data
@TableName("publication_audit")
public class PublicationAuditDO {
    private String environmentId;
    @TableId(type = IdType.INPUT)
    private String id;

    private String apiId;
    private String releaseId;
    private String action;
    private String operatorTenantId;
    private String operatorEmployeeNo;
    private String outcome;
    private String summary;
    private String requestId;
    private Instant occurredAt;
}
