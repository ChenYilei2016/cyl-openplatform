package io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** 草稿调试可选身份的查询投影，不包含凭据密钥摘要。 */
@Getter
@Setter
@NoArgsConstructor
public class CallableGrantDO {
    private String applicationId;
    private String applicationName;
    private String appKey;
    private String tenantGrantId;
    private String tenantId;
    private String note;
}
