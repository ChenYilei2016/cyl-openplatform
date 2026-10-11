package io.github.chenyilei2016.openplatform.infrastructure.connection.dal.dataobject;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("dubbo_connection_revision")
public class DubboConnectionRevisionDO {
    @TableId(type = IdType.INPUT)
    private String id;
    private String connectionId;
    private Long revision;
    private String configJson;
    private String metadataType;
    private String discoveryMode;
    private String providerMetadataMode;
    private Instant createdAt;
}
