package io.github.chenyilei2016.openplatform.infrastructure.publication.dal.dataobject;

import com.baomidou.mybatisplus.annotation.*;

import lombok.Data;

@Data
@TableName("publication_state")
public class PublicationStateDO {
    private String environmentId;
    @TableId(type = IdType.INPUT)
    private String apiId;

    private Long stateVersion;
    private Boolean enabled;
    private String liveReleaseId;
    private String pendingReleaseId;
}
