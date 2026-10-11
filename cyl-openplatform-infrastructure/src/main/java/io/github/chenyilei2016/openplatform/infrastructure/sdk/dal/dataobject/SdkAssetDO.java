package io.github.chenyilei2016.openplatform.infrastructure.sdk.dal.dataobject;

import com.baomidou.mybatisplus.annotation.*;
import java.time.Instant;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@TableName("sdk_asset")
public class SdkAssetDO {
    @TableId(type = IdType.INPUT)
    private String id;
    private String kind;
    private String apiId;
    private String releaseId;
    private String service;
    private String version;
    private String method;
    private String name;
    private String sdkVersion;
    private String language;
    private String gatewayProtocol;
    private String runtime;
    private String releaseNotes;
    private String status;
    private Long revision;
    private String sha256;
    private Long sizeBytes;
    private Instant createdAt;
    private Instant publishedAt;
    @TableField(select = false)
    private byte[] payload;
}
