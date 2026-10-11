package io.github.chenyilei2016.openplatform.infrastructure.signature.dal.dataobject;

import com.baomidou.mybatisplus.annotation.*;
import java.time.Instant;
import lombok.*;

@Getter @Setter @NoArgsConstructor @AllArgsConstructor
@TableName("platform_signing_key")
public class SigningKeyDO {
    @TableId(type = IdType.INPUT) private String applicationId;
    private String keyId;
    private Long revision;
    private String status;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String wrappingKeyId;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String encryptedSecret;
    private Instant createdAt;
    private Instant changedAt;
}
