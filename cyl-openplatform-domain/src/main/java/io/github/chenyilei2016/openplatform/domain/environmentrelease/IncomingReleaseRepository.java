package io.github.chenyilei2016.openplatform.domain.environmentrelease;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.IncomingReview;

import java.util.Optional;

/** 目标回执与发布同事务提交，来源与传输号共同标识幂等事实。 */
public interface IncomingReleaseRepository {
    record IncomingRelease(
            String id,
            String sourceEnvironment,
            String transferId,
            String requestDigest,
            String apiId,
            String releaseId,
            IncomingReview review) {}

    Optional<IncomingRelease> find(String sourceEnvironment, String transferId);

    Optional<IncomingRelease> findRelease(String releaseId);

    void insert(IncomingRelease receipt);
}
