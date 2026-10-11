package io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject;

import lombok.Getter;
import lombok.Setter;

/** 当前页凭据的有界关系预览与数据库汇总。 */
@Getter
@Setter
public class ApplicationGrantSummaryDO {
    private String applicationId;
    private String tenantId;
    private String status;
    private boolean matched;
    private long totalCount;
    private long matchedCount;
}
