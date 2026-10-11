package io.github.chenyilei2016.openplatform.domain.operations;

import java.time.Instant;
public record AlertState(AlertMetric metric, AlertStatus status, String value, long sampleCount,
        Instant windowStart, Instant windowEnd, long policyVersion, Instant evaluatedAt) {}
