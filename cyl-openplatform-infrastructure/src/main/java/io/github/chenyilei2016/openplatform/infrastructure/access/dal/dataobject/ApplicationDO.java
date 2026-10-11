package io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableField;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@TableName("access_application")
public class ApplicationDO {
    @TableId(type = IdType.INPUT)
    private String id;
    private String appKey;
    private String name;
    private String ownerTenantId;
    private String status;
    private Long authorizationVersion;
    @TableField(select = false)
    private String secretDigest;
    private String kind;
}
