package io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject;

import lombok.Getter;
import lombok.Setter;

/** 管理列表查询投影，不参与凭据写入。 */
@Getter
@Setter
public class ApplicationSummaryDO extends ApplicationDO {
    private String selectedTenantGrantStatus;
}
