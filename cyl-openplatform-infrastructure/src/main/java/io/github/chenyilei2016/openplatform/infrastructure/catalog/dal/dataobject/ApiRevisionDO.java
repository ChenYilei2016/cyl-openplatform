package io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiRevisionSummary;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiRevisionSource;
import java.time.Instant;
import lombok.Data;

@Data
public class ApiRevisionDO {
    private String environmentId;
    private String apiId;
    private Long revision;
    private String source;
    private String operatorTenantId;
    private String operatorEmployeeNo;
    private Instant recordedAt;
    private boolean historyStart;
    private String contentDigest;
    private String digestVersion;
    private String snapshotJson;
    private Long restoredFromRevision;

    public ApiRevisionSummary summary() {
        ApiRevisionSource revisionSource = ApiRevisionSource.valueOf(source);
        return new ApiRevisionSummary(apiId, revision, revisionSource, restoredFromRevision == null ? revisionSource.summary() : "从 r" + restoredFromRevision + " 恢复草稿", operatorTenantId, operatorEmployeeNo,
                recordedAt, historyStart, contentDigest, digestVersion, restoredFromRevision);
    }
}
