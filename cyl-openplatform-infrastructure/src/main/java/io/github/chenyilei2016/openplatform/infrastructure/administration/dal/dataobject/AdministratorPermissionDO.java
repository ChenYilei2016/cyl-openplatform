package io.github.chenyilei2016.openplatform.infrastructure.administration.dal.dataobject;

import com.baomidou.mybatisplus.annotation.TableName;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@TableName("platform_administrator_permission")
public class AdministratorPermissionDO {
    private String administratorId;
    private String permissionCode;
}
