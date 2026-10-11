package io.github.chenyilei2016.openplatform.infrastructure.publication.dal.dataobject;

import com.baomidou.mybatisplus.annotation.*;

import lombok.Data;

import java.time.Instant;

@Data
@TableName("publication_release")
public class PublicationReleaseDO {
    private String environmentId;
    @TableField(exist = false)
    private Long effectiveStateVersion;

    @TableField(exist = false)
    private Boolean effectiveEnabled;

    @TableId(type = IdType.INPUT)
    private String id;

    private String apiId;
    private String name;
    private String category;
    private String lifecycleStatus;
    private Boolean mcpToolEnabled;
    private String service;
    private String version;
    private String method;
    private Long draftRevision;
    private String dubboConnectionId;
    private Long dubboConnectionRevision;
    private String status;
    private Boolean auditRequired;
    private Instant submittedAt;
    private String submittedByTenantId;
    private String submittedByEmployeeNo;
    private Instant reviewedAt;
    private String reviewedByTenantId;
    private String reviewedByEmployeeNo;
    private String failureReason;
    private String submissionKey;
    private String comment;
    private String reviewComment;
    private String snapshotJson;
    private String baselineJson;
    private Boolean baselineKnown;
    private String kind;
    private String sourceReleaseId;
    private String baselineReleaseId;
    private Long baselineStateVersion;
}
