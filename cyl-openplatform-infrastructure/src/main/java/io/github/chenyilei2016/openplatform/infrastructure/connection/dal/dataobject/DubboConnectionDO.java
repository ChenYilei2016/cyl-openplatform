package io.github.chenyilei2016.openplatform.infrastructure.connection.dal.dataobject;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("dubbo_connection")
public class DubboConnectionDO {
    @TableId(type = IdType.INPUT)
    private String id;
    private String name;
    private String environmentId;
    private String description;
    private Long draftRevision;
    private Long activeRevision;
    private Boolean enabled;
    private Long stateVersion;
    private Instant updatedAt;
}
