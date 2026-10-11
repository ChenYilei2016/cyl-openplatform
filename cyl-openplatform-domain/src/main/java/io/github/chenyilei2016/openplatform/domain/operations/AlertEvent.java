package io.github.chenyilei2016.openplatform.domain.operations;

import java.time.Instant;
public record AlertEvent(String id, AlertMetric metric, AlertStatus previousStatus, AlertStatus status, String value,
        long sampleCount, Instant windowStart, Instant windowEnd, long policyVersion, Instant occurredAt) {}
