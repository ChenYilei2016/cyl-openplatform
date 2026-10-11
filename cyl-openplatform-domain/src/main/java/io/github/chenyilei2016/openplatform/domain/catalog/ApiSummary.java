package io.github.chenyilei2016.openplatform.domain.catalog;

public record ApiSummary(String id, String service, String version, String method, String name,
                         String category, String owner, String ownerName, boolean ownerProfileLinked,
                         String ownerEmployeeNo, String ownerTenantId, String ownerTenantName, ApiProtocol protocol, long draftRevision,
                         Long liveDraftRevision, boolean enabled, String pendingReleaseId, ApiCatalogFilter.Review latestReviewStatus, Long latestReviewDraftRevision, boolean hasUnpublishedChanges,
                         String internalClass, String internalMethod, java.time.Instant updatedAt, boolean mcpToolEnabled, boolean portalVisible) {}
