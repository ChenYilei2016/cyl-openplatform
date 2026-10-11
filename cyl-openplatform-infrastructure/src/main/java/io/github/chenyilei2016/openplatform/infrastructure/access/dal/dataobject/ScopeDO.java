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
@TableName("access_scope")
public class ScopeDO {
    @TableId(type = IdType.INPUT)
    private String id;
    private String code;
    private String name;
    private Boolean enabled;
    private Boolean defaultForNewApplication;
    private Boolean publicAccess;
}
