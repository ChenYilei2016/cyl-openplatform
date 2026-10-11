package io.github.chenyilei2016.openplatform.domain.environmentrelease;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.publication.ReleaseStatus;
import java.time.Instant;
import java.util.List;

/** 环境传输协议与观测结果，不携带机器凭据。 */
public final class EnvironmentReleaseModels {
    private EnvironmentReleaseModels() {}

    public enum DeliveryState { READY, ACCEPTED, UNKNOWN, REJECTED }
    public record ConnectionOption(String id, String name, String description, long revision) {}
    public record ConnectionDirectory(String environmentId, String nodeId, List<ConnectionOption> items,
                                      long total, int page, int pageSize) {}
    public record Target(String id, String name, List<String> nodeIds) {}
    public record PreviewRequest(String sourceEnvironment, String targetEnvironment, ApiDefinition definition) {}
    public record Preview(String environmentId, String nodeId, ApiDefinition definition, ApiDefinition before,
                          String change, long expectedRevision, List<String> changedFields, String previewDigest,
                          boolean auditRequired, String pendingReleaseId) {}
    public record SendRequest(String transferId, String sourceEnvironment, String targetEnvironment,
                              String sourceReleaseId, String operatorTenantId, String operatorEmployeeNo,
                              long expectedRevision, String previewDigest, ApiDefinition definition, String comment) {}
    public record Receipt(String environmentId, String nodeId, String sourceEnvironment, String transferId,
                          String apiId, String releaseId, long draftRevision, ReleaseStatus status,
                          boolean auditRequired, String liveReleaseId, boolean enabled, long stateVersion,
                          Instant observedAt) {}
    public record DeliveryResult(Receipt receipt, boolean rejected, String error) {}
    public record NodeObservation(String nodeId, Receipt receipt, String error, Instant observedAt) {}
    public record IncomingReview(String sourceEnvironment, String sourceReleaseId, String operatorTenantId,
                                 String operatorEmployeeNo, ApiDefinition before, ApiDefinition after,
                                 List<String> changedFields) {}
    public record TransferSummary(String id, String sourceEnvironment, String sourceReleaseId, String targetId, String service,
                                  String version, String method, DeliveryState deliveryState, String error,
                                  Receipt receipt, List<NodeObservation> observations, Instant createdAt, Instant updatedAt) {}
    public record OutgoingTransfer(String id, SendRequest request, DeliveryState deliveryState, String error,
                                   Receipt receipt, List<NodeObservation> observations, Instant createdAt,
                                   Instant updatedAt, long version) {}
}
