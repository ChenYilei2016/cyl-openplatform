package io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@TableName("access_application_scope")
public class ApplicationScopeDO {
    private String applicationId;
    private String scopeCode;
}
