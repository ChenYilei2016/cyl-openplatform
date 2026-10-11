package io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@TableName("access_user_grant")
public class UserGrantDO {
    @TableId(type = IdType.INPUT)
    private String id;
    private String tenantGrantId;
    private String tenantId;
    private String userId;
    private String employeeId;
    private String employeeNo;
    private String displayName;
    private String status;
    private Long authorizationVersion;
}
