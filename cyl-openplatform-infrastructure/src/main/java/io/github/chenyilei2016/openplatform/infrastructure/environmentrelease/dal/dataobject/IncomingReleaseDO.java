package io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.dal.dataobject;

import com.baomidou.mybatisplus.annotation.*;

import lombok.Data;

@Data
@TableName("environment_release_receipt")
public class IncomingReleaseDO {
    private String environmentId;
    @TableId(type = IdType.INPUT)
    private String id;

    private String sourceEnvironment;
    private String transferId;
    private String requestDigest;
    private String apiId;
    private String releaseId;
    private String sourceReleaseId;
    private String operatorTenantId;
    private String operatorEmployeeNo;
    private String beforeJson;
    private String afterJson;
    private String changedFieldsJson;
}
