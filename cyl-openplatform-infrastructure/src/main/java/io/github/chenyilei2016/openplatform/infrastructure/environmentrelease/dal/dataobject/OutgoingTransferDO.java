package io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.dal.dataobject;

import com.baomidou.mybatisplus.annotation.*;
import java.time.Instant;
import lombok.Data;

@Data
@TableName("environment_release_transfer")
public class OutgoingTransferDO {
    private String environmentId;
    @TableId(type = IdType.INPUT)
    private String id;
    private String sourceReleaseId;
    private String sourceEnvironment;
    private String targetId;
    private String service;
    private String version;
    private String method;
    private String requestJson;
    private String deliveryState;
    private String error;
    private String receiptJson;
    private String observationsJson;
    private Instant createdAt;
    private Instant updatedAt;
    private Long recordVersion;
}
