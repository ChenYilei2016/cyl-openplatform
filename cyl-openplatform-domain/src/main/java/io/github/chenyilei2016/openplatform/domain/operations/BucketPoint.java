package io.github.chenyilei2016.openplatform.domain.operations;

import java.time.Instant;

public record BucketPoint(Instant bucketStart, OperationsTotals totals) {}
