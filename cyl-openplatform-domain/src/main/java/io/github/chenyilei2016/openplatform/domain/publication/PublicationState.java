package io.github.chenyilei2016.openplatform.domain.publication;

public record PublicationState(
        String apiId,
        long stateVersion,
        boolean enabled,
        String liveReleaseId,
        String pendingReleaseId) {
    public static PublicationState initial(String apiId) {
        return new PublicationState(apiId, 0, true, null, null);
    }

    public PublicationState submitted(String id, boolean pending) {
        return new PublicationState(
                apiId,
                stateVersion + 1,
                enabled,
                pending ? liveReleaseId : id,
                pending ? id : null);
    }

    public PublicationState decided(String id, boolean applied) {
        return new PublicationState(
                apiId, stateVersion + 1, enabled, applied ? id : liveReleaseId, null);
    }

    public PublicationState enabled(boolean value) {
        return new PublicationState(
                apiId, stateVersion + 1, value, liveReleaseId, pendingReleaseId);
    }
}
