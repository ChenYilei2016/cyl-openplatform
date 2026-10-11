package io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject;

import lombok.Data;

/** 分页列表投影；正文仅在当前页内比较内容差异，不对外返回。 */
@Data
public class ApiSummaryDO {
    private String definitionJson;
    private String internalClass;
    private String internalMethod;
    /** 当前草稿是否打开MCP工具，供列表服务端筛选的派生列。 */
    private boolean mcpToolEnabled;
    private boolean portalVisible;
    private String liveSnapshotJson;
    private String id;
    private String service;
    private String version;
    private String method;
    private String name;
    private String category;
    private String owner;
    private String ownerName;
    private boolean ownerProfileLinked;
    private String ownerEmployeeNo;
    private String ownerTenantId;
    private String ownerTenantName;
    private String protocol;
    private Long draftRevision;
    private Long liveDraftRevision;
    private boolean enabled;
    private String pendingReleaseId;
    private String latestReviewStatus;
    private Long latestReviewDraftRevision;
    private java.time.Instant updatedAt;
}
