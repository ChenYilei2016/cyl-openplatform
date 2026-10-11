package io.github.chenyilei2016.openplatform.infrastructure.administration.dal.dataobject;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@TableName("platform_administrator")
public class AdministratorDO {
    @TableId(type = IdType.INPUT)
    private String id;

    private String tenantId;
    private String userId;
    private String employeeId;
    private String employeeNo;
    private String displayName;
    private Boolean enabled;
    private Boolean superAdministrator;
    private Long revision;
}
