package io.github.chenyilei2016.openplatform.infrastructure.token.dal.dataobject;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import java.time.Instant;

@Getter
@Setter
@TableName("platform_token")
public class TokenDO {
    @TableId(type = IdType.INPUT)
    private String id;
    @TableField(select = false)
    private String tokenDigest;
    private String applicationId;
    private String appKey;
    private String tenantGrantId;
    private String tenantId;
    private String userGrantId;
    private String userId;
    private String employeeId;
    private String employeeNo;
    private Long applicationVersion;
    private Long tenantVersion;
    private Long userVersion;
    private String scopeCodes;
    private String status;
    private Instant issuedAt;
    private Instant expiresAt;
    @TableField(exist = false)
    private Boolean authorizationValid;
}
