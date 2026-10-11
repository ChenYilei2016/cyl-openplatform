package io.github.chenyilei2016.openplatform.domain.catalog;

import java.time.Instant;

/** 完整草稿的归档元数据；旧数据归档时间不冒充原保存时间或原作者。 */
public record ApiRevisionSummary(String apiId, long revision, ApiRevisionSource source, String summary,
                                 String operatorTenantId, String operatorEmployeeNo,
                                 Instant recordedAt, boolean historyStart,
                                 String contentDigest, String digestVersion, Long restoredFromRevision) {}
