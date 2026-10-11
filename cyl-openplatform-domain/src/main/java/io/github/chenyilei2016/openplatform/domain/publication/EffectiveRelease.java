package io.github.chenyilei2016.openplatform.domain.publication;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;

import java.time.Instant;

public record EffectiveRelease(
        String apiId,
        String releaseId,
        long stateVersion,
        boolean enabled,
        Instant appliedAt,
        ApiDefinition snapshot) {}
