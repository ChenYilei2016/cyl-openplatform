package io.github.chenyilei2016.openplatform.infrastructure.observability.dal.dataobject;

import java.time.Instant;
import lombok.Getter;
import lombok.Setter;

/** 凭据最近一次正式调用时间；没有保留中的调用记录时为空。 */
@Getter
@Setter
public class ApplicationLatestCallDO {
    private String applicationId;
    private Instant lastCalledAt;
}
